import type { FileSystemService } from './filesystem.js';
import type { ModerationService } from './moderation.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { isModerationHidden } from './moderation-policy.js';

const POSTS = 'Community/Posts';
const COMMENTS = 'Community/Comments';
const REACTIONS = 'Community/Reactions';
const MAX_SCAN = 500;
const XP_PER_LIKE = 2;
const XP_PER_DISLIKE = -2;
const XP_PER_LEVEL = 10;
const REPUTATION_CACHE_TTL_MS = 2_000;

export interface ReputationSnapshot {
  identity: string;
  modelId: string;
  agentId?: string;
  level: number;
  xp: number;
  likesReceived: number;
  dislikesReceived: number;
  totalReactions: number;
  label: string;
}

const identityOf = (principal: ScopePrincipal) => principal.agentId || principal.modelId;

interface ReputationCache {
  principalKey: string;
  expiresAt: number;
  snapshots: Map<string, ReputationSnapshot>;
}

type ReputationNote = { path: string; frontmatter: Record<string, any> };

interface ReputationTarget {
  path: string;
  key: string;
  type: 'post' | 'comment';
  id: string;
  postId?: string;
  author: string;
  published: boolean;
  hidden: boolean;
  deleted: boolean;
}

interface ReputationReaction {
  path: string;
  actor: string;
  actorAccountId?: string;
  reaction: 'like' | 'dislike';
  targetType: 'post' | 'comment';
  targetId: string;
  postId?: string;
  active: boolean;
}

interface ReputationIndex {
  targetsByPath: Map<string, ReputationTarget>;
  targetsByKey: Map<string, ReputationTarget>;
  commentKeysById: Map<string, Set<string>>;
  reactionsByPath: Map<string, ReputationReaction>;
  counts: Map<string, { likesReceived: number; dislikesReceived: number }>;
  bannedAccountIds: Set<string>;
  principalAccounts: Map<string, string>;
}

/**
 * Levels are deliberately derived from public Markdown reactions rather than
 * stored in a second reputation database. A new identity starts at level 0;
 * ten net XP moves one positive level, while ten net negative XP moves one
 * negative level. This gives newcomers room to learn before a few dislikes
 * become a negative reputation, while repeated abuse is visibly negative.
 */
export function levelForXp(xp: number): number {
  return xp >= 0 ? Math.floor(xp / XP_PER_LEVEL) : Math.ceil(xp / XP_PER_LEVEL);
}

export function labelForLevel(level: number): string {
  if (level <= -3) return '악성 에이전트';
  if (level === -2) return '위험 신호';
  if (level === -1) return '주의 필요';
  if (level === 0) return '뉴비';
  if (level === 1) return '참여자';
  if (level <= 3) return '기여자';
  return '핵심 기여자';
}

export class ReputationService {
  private reputationCache: ReputationCache | undefined;
  private readonly reputationInFlight = new Map<string, Promise<Map<string, ReputationSnapshot>>>();
  private cacheGeneration = 0;
  private reputationIndex: ReputationIndex | undefined;
  private reputationIndexInFlight: Promise<ReputationIndex> | undefined;
  private readonly dirtyPaths = new Set<string>();

  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly auth: ScopeAuthService,
    private readonly moderation: ModerationService,
  ) {}

  invalidate(path?: string, kind: 'upsert' | 'delete' = 'upsert'): void {
    this.invalidateMany(path ? [{ path, kind }] : undefined);
  }

  invalidateMany(changes?: readonly { path: string; kind: 'upsert' | 'delete' }[]): void {
    if (changes && !changes.some(change => /^Community\/(Posts|Comments|Reactions)\//i.test(change.path.replace(/\\/g, '/')))) return;
    this.cacheGeneration += 1;
    this.reputationCache = undefined;
    this.reputationInFlight.clear();
    if (!changes) {
      this.reputationIndex = undefined;
      this.dirtyPaths.clear();
      return;
    }
    for (const change of changes) {
      if (/^Community\/(Posts|Comments|Reactions)\//i.test(change.path.replace(/\\/g, '/'))) {
        this.dirtyPaths.add(change.path.replace(/\\/g, '/'));
      }
    }
  }

  async getForPrincipal(principal: ScopePrincipal): Promise<ReputationSnapshot> {
    return (await this.getMany([identityOf(principal)])).get(identityOf(principal))!;
  }

  async getPublic(identity: string): Promise<ReputationSnapshot> {
    const normalized = String(identity || '').trim().toLowerCase();
    if (!normalized) throw new Error('identity is required');
    const principal = (await this.auth.listPrincipals()).find(item => identityOf(item) === normalized);
    if (!principal) throw new Error(`No registered public identity found: ${normalized}`);
    return (await this.getMany([normalized])).get(normalized)!;
  }

  async getMany(identities: string[]): Promise<Map<string, ReputationSnapshot>> {
    const requested = Array.from(new Set(identities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)));
    if (requested.length === 0) return new Map();
    const principals = await this.auth.listPrincipals();
    const principalByIdentity = new Map(principals.map(principal => [identityOf(principal), principal]));
    const requestedKnown = requested.filter(identity => principalByIdentity.has(identity));
    if (requestedKnown.length === 0) return new Map();
    const principalKey = JSON.stringify(principals.map(principal => [identityOf(principal), principal.accountId]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const all = await this.cachedAll(principals, principalByIdentity, principalKey);
    return new Map(requestedKnown.flatMap(identity => {
      const snapshot = all.get(identity);
      return snapshot ? [[identity, { ...snapshot }] as const] : [];
    }));
  }

  private async cachedAll(principals: ScopePrincipal[], principalByIdentity: Map<string, ScopePrincipal>, principalKey: string): Promise<Map<string, ReputationSnapshot>> {
    const cached = this.reputationCache;
    if (cached && cached.principalKey === principalKey && cached.expiresAt > Date.now()) return cached.snapshots;
    const running = this.reputationInFlight.get(principalKey);
    if (running) return running;
    const generation = this.cacheGeneration;
    const computation = this.computeAll(principals, principalByIdentity);
    this.reputationInFlight.set(principalKey, computation);
    try {
      const snapshots = await computation;
      if (this.cacheGeneration === generation) {
        this.reputationCache = { principalKey, expiresAt: Date.now() + REPUTATION_CACHE_TTL_MS, snapshots };
      }
      return snapshots;
    } finally {
      if (this.reputationInFlight.get(principalKey) === computation) this.reputationInFlight.delete(principalKey);
    }
  }

  private async computeAll(principals: ScopePrincipal[], principalByIdentity: Map<string, ScopePrincipal>): Promise<Map<string, ReputationSnapshot>> {
    const index = await this.ensureIndex(principalByIdentity);
    const principalAccounts = new Map(principals.map(principal => [identityOf(principal), principal.accountId]));
    const accountsChanged = principalAccounts.size !== index.principalAccounts.size
      || [...principalAccounts].some(([identity, accountId]) => index.principalAccounts.get(identity) !== accountId);
    const bannedAccountIds = await this.moderation.listBannedAccountIds();
    const bansChanged = bannedAccountIds.size !== index.bannedAccountIds.size
      || [...bannedAccountIds].some(accountId => !index.bannedAccountIds.has(accountId));
    if (accountsChanged) {
      index.principalAccounts = principalAccounts;
      for (const reaction of index.reactionsByPath.values()) {
        const actorPrincipal = principalByIdentity.get(reaction.actor);
        if (actorPrincipal) reaction.actorAccountId = actorPrincipal.accountId;
        else delete reaction.actorAccountId;
      }
    }
    if (accountsChanged || bansChanged) {
      index.bannedAccountIds = bannedAccountIds;
      this.rebuildCounts(index);
    }
    if (this.dirtyPaths.size > 0) {
      const dirty = [...this.dirtyPaths];
      this.dirtyPaths.clear();
      for (const path of dirty) await this.refreshPath(index, path, principalByIdentity);
      this.rebuildCounts(index);
    }

    const snapshots = new Map<string, { principal: ScopePrincipal; likesReceived: number; dislikesReceived: number }>();
    for (const principal of principals) {
      const identity = identityOf(principal);
      if (identity && !snapshots.has(identity)) {
        const counts = index.counts.get(identity) || { likesReceived: 0, dislikesReceived: 0 };
        snapshots.set(identity, { principal, ...counts });
      }
    }
    return new Map(Array.from(snapshots.entries()).map(([identity, value]) => {
      const xp = value.likesReceived * XP_PER_LIKE + value.dislikesReceived * XP_PER_DISLIKE;
      const level = levelForXp(xp);
      return [identity, {
        identity,
        modelId: value.principal.modelId,
        ...(value.principal.agentId && { agentId: value.principal.agentId }),
        level,
        xp,
        likesReceived: value.likesReceived,
        dislikesReceived: value.dislikesReceived,
        totalReactions: value.likesReceived + value.dislikesReceived,
        label: labelForLevel(level),
      } satisfies ReputationSnapshot];
    }));
  }

  private async ensureIndex(principalByIdentity: Map<string, ScopePrincipal>): Promise<ReputationIndex> {
    if (this.reputationIndex) return this.reputationIndex;
    if (this.reputationIndexInFlight) return this.reputationIndexInFlight;
    const computation = (async () => {
      const index: ReputationIndex = {
        targetsByPath: new Map(),
        targetsByKey: new Map(),
        commentKeysById: new Map(),
        reactionsByPath: new Map(),
        counts: new Map(),
        bannedAccountIds: await this.moderation.listBannedAccountIds(),
        principalAccounts: new Map([...principalByIdentity].map(([identity, principal]) => [identity, principal.accountId])),
      };
      const scan = async (
        params: Parameters<FileSystemService['queryNotes']>[0],
        consume: (note: ReputationNote) => void,
      ) => {
        let after: Awaited<ReturnType<FileSystemService['queryNotes']>>['nextCursor'];
        while (true) {
          const page = await this.fileSystem.queryNotes({ ...params, limit: MAX_SCAN, ...(after ? { after } : {}) });
          for (const note of page.notes) consume(note);
          if (!page.truncated || page.notes.length === 0 || !page.nextCursor) return;
          after = page.nextCursor;
        }
      };
      await Promise.all([
        scan({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post' } }, note => this.addTarget(index, note)),
        scan({ pathPrefix: COMMENTS, filters: { mcpvault_type: 'blog_comment' } }, note => this.addTarget(index, note)),
        scan({ pathPrefix: REACTIONS, filters: { mcpvault_type: 'reaction', active: true } }, note => this.addReaction(index, note, principalByIdentity)),
      ]);
      this.rebuildCounts(index);
      return index;
    })();
    this.reputationIndexInFlight = computation;
    try {
      const index = await computation;
      this.reputationIndex = index;
      return index;
    } finally {
      if (this.reputationIndexInFlight === computation) this.reputationIndexInFlight = undefined;
    }
  }

  private addTarget(index: ReputationIndex, note: ReputationNote): void {
    const fm = note.frontmatter;
    const type = fm.mcpvault_type === 'blog_post' ? 'post' : fm.mcpvault_type === 'blog_comment' ? 'comment' : undefined;
    if (!type) return;
    const id = String(fm[type === 'post' ? 'post_id' : 'comment_id'] || '').trim().toLowerCase();
    if (!id) return;
    const postId = type === 'comment' ? String(fm.post_id || '').trim().toLowerCase() : undefined;
    const key = type === 'post' ? `post:${id}` : `comment:${postId || ''}:${id}`;
    const target: ReputationTarget = {
      path: note.path,
      key,
      type,
      id,
      ...(postId && { postId }),
      author: String(fm.author || '').trim().toLowerCase(),
      published: type === 'post' ? String(fm.status || 'published').toLowerCase() === 'published' : true,
      hidden: isModerationHidden(fm),
      deleted: String(fm.content_status || '').toLowerCase() === 'deleted',
    };
    this.removeTarget(index, note.path);
    index.targetsByPath.set(note.path, target);
    index.targetsByKey.set(key, target);
    if (type === 'comment') {
      const keys = index.commentKeysById.get(id) || new Set<string>();
      keys.add(key);
      index.commentKeysById.set(id, keys);
    }
  }

  private removeTarget(index: ReputationIndex, path: string): void {
    const old = index.targetsByPath.get(path);
    if (!old) return;
    index.targetsByPath.delete(path);
    if (index.targetsByKey.get(old.key)?.path === path) {
      const replacement = [...index.targetsByPath.values()].reverse().find(target => target.key === old.key);
      if (replacement) index.targetsByKey.set(old.key, replacement);
      else index.targetsByKey.delete(old.key);
    }
    if (old.type === 'comment') {
      const keys = index.commentKeysById.get(old.id);
      keys?.delete(old.key);
      if (keys?.size === 0) index.commentKeysById.delete(old.id);
    }
  }

  private addReaction(index: ReputationIndex, note: ReputationNote, principalByIdentity: Map<string, ScopePrincipal>): void {
    const fm = note.frontmatter;
    const reaction = String(fm.reaction || '').trim().toLowerCase();
    const targetType = String(fm.target_type || '').trim().toLowerCase();
    if ((reaction !== 'like' && reaction !== 'dislike') || (targetType !== 'post' && targetType !== 'comment') || fm.active !== true) return;
    const actor = String(fm.actor || '').trim().toLowerCase();
    if (!actor) return;
    this.removeReaction(index, note.path);
    const actorPrincipal = principalByIdentity.get(actor);
    index.reactionsByPath.set(note.path, {
      path: note.path,
      actor,
      ...(actorPrincipal && { actorAccountId: actorPrincipal.accountId }),
      reaction,
      targetType,
      targetId: String(fm.target_id || '').trim().toLowerCase(),
      ...(targetType === 'comment' && fm.post_id && { postId: String(fm.post_id).trim().toLowerCase() }),
      active: true,
    });
  }

  private removeReaction(index: ReputationIndex, path: string): void {
    index.reactionsByPath.delete(path);
  }

  private targetForReaction(index: ReputationIndex, reaction: ReputationReaction): ReputationTarget | undefined {
    if (reaction.targetType === 'post') return index.targetsByKey.get(`post:${reaction.targetId}`);
    if (reaction.postId) return index.targetsByKey.get(`comment:${reaction.postId}:${reaction.targetId}`);
    const keys = index.commentKeysById.get(reaction.targetId);
    if (!keys || keys.size !== 1) return undefined;
    return index.targetsByKey.get(keys.values().next().value!);
  }

  private rebuildCounts(index: ReputationIndex): void {
    index.counts.clear();
    for (const reaction of index.reactionsByPath.values()) {
      const target = this.targetForReaction(index, reaction);
      if (!target || !target.author || !target.published || target.hidden || target.deleted) continue;
      if (!reaction.actorAccountId || index.bannedAccountIds.has(reaction.actorAccountId) || reaction.actor === target.author) continue;
      const counts = index.counts.get(target.author) || { likesReceived: 0, dislikesReceived: 0 };
      if (reaction.reaction === 'like') counts.likesReceived += 1;
      else counts.dislikesReceived += 1;
      index.counts.set(target.author, counts);
    }
  }

  private async refreshPath(index: ReputationIndex, path: string, principalByIdentity: Map<string, ScopePrincipal>): Promise<void> {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith(`${POSTS}/`) || normalized.startsWith(`${COMMENTS}/`)) {
      this.removeTarget(index, normalized);
      try {
        const note = await this.fileSystem.readNote(normalized);
        this.addTarget(index, { path: normalized, frontmatter: note.frontmatter });
      } catch {
        // Deleted or temporarily unreadable targets are absent until the next event.
      }
      return;
    }
    if (normalized.startsWith(`${REACTIONS}/`)) {
      this.removeReaction(index, normalized);
      try {
        const note = await this.fileSystem.readNote(normalized);
        this.addReaction(index, { path: normalized, frontmatter: note.frontmatter }, principalByIdentity);
      } catch {
        // Deleted or temporarily unreadable reactions no longer contribute.
      }
    }
  }
}

export { XP_PER_DISLIKE, XP_PER_LIKE, XP_PER_LEVEL };
