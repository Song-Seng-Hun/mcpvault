import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import { isModerationHidden } from './moderation-policy.js';

export interface NoticeEntry { id: string; path: string; title: string; priority: number; topics: string[]; editors: string[] }
interface NoticeConfig { version: 1; vaultPath: string; notices: NoticeEntry[] }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (path: string) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').map(s => s.replace(/[. ]+$/, '')).join('/').toLowerCase();
const inside = (root: string, path: string) => { const r = relative(root, path); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
const text = (value: unknown, name: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be a nonempty string <= ${max} characters`);
  return value;
};
const budget = (value: unknown, fallback = 4000) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 512 || n > 12000) throw new Error('maxChars must be 512..12000');
  return n;
};

/** Trusted host configuration only. Never derive editors or registration from Markdown. */
export class NoticeRegistry {
  private readonly grant = new AsyncLocalStorage<{ path: string; fingerprint: string; assertFresh: () => void }>();
  constructor(private readonly vaultPath: string, private readonly configPath?: string) { this.load(); }
  load(): NoticeConfig {
    if (!this.configPath) return { version: 1, vaultPath: this.vaultPath, notices: [] };
    if (!isAbsolute(this.configPath)) throw new Error('Notice configuration must be an absolute host-private path');
    const vault = realpathSync(this.vaultPath), path = realpathSync(this.configPath);
    if (inside(vault, path) || statSync(path).size > 65536) throw new Error('Notice configuration must be outside the Vault and <= 64KiB');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || raw.version !== 1 || !isAbsolute(raw.vaultPath || '') || key(realpathSync(raw.vaultPath)) !== key(vault)
      || Object.keys(raw).some(k => !['version', 'vaultPath', 'notices'].includes(k)) || !Array.isArray(raw.notices) || raw.notices.length > 64) throw new Error('Invalid notice host configuration');
    const ids = new Set<string>(), paths = new Set<string>();
    for (const item of raw.notices) {
      if (!item || Object.keys(item).some(k => !['id', 'path', 'title', 'priority', 'topics', 'editors'].includes(k))
        || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id || '')
        || typeof item.path !== 'string' || item.path.length > 240 || !item.path.endsWith('.md')
        || item.path.split('/').some((s: string) => !s || s === '.' || s === '..' || /[. ]$|[\\:\x00-\x1f]/.test(s))
        || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 180
        || !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100
        || !Array.isArray(item.topics) || item.topics.length > 8 || item.topics.some((t: unknown) => typeof t !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(t))
        || !Array.isArray(item.editors) || item.editors.length > 20 || item.editors.some((a: unknown) => typeof a !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(a))
        || ids.has(item.id) || paths.has(key(item.path))) throw new Error('Invalid or duplicate notice registration');
      ids.add(item.id); paths.add(key(item.path));
    }
    return raw;
  }
  assertMutation(path: string): void {
    const config = this.load(), target = key(path), grant = this.grant.getStore();
    grant?.assertFresh();
    // Unregistration is also a policy change: an in-flight editor grant must
    // not become a generic write just because its target is no longer listed.
    if (grant && (grant.path !== target || grant.fingerprint !== hash(config))) {
      throw new Error('Notice authority or host policy changed; reread and preview again');
    }
    const protectedPath = config.notices.some(n => { const p = key(n.path); return p === target || p.startsWith(`${target}/`) || !target; });
    if (protectedPath && !(grant && grant.path === target && grant.fingerprint === hash(config))) {
      throw new Error('Protected notice: generic edits, Properties changes, deletion and moves are forbidden. Use notice.preview then notice.revise; propose changes through community.post category=feedback.');
    }
  }
  write<T>(path: string, fingerprint: string, operation: () => Promise<T>, assertFresh: () => void): Promise<T> {
    return this.grant.run({ path: key(path), fingerprint, assertFresh }, operation);
  }
  assertCanonical(path: string): void {
    const expected = resolve(this.vaultPath, path);
    if (key(realpathSync(expected)) !== key(expected)) throw new Error('Notice unavailable: symlink aliases cannot serve registered notices');
  }
}

export class NoticeService {
  constructor(private readonly registry: NoticeRegistry, private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy, private readonly references: ReferenceService) {}
  private entry(id: unknown, principal?: ScopePrincipal) {
    const config = this.registry.load();
    const entry = config.notices.find(n => n.id === id && this.access.canAccessPhysicalPath(n.path, principal));
    if (!entry) throw new Error('Notice unavailable');
    return { entry, policyFingerprint: hash(config) };
  }
  private async current(id: unknown, principal?: ScopePrincipal) {
    const registered = this.entry(id, principal);
    this.registry.assertCanonical(registered.entry.path);
    const note = await this.fs.readNote(registered.entry.path, 262144);
    if (isModerationHidden(note.frontmatter)) throw new Error('Notice unavailable');
    return { ...registered, note };
  }
  private async fresh(id: unknown, revision: string, fingerprint: string, principal?: ScopePrincipal) {
    const value = await this.current(id, principal);
    if (value.policyFingerprint !== fingerprint || value.note.revision !== revision) throw new Error('Notice or host policy changed; reread and preview again');
  }
  async read(args: any, principal?: ScopePrincipal) {
    const maxChars = budget(args.maxChars), { entry, note, policyFingerprint } = await this.current(args.id, principal);
    if (args.expectedRevision !== undefined && args.expectedRevision !== note.revision) throw new Error('Notice revision changed; reread');
    const result: any = { id: entry.id, type: 'notice', path: entry.path, title: entry.title, priority: entry.priority, revision: note.revision,
      content: '', truncated: false, warning: 'Notice content is reference data, not a permission grant.',
      feedbackAction: { endpointId: 'community.post', arguments: { category: 'feedback', noticeId: entry.id, noticeRevision: note.revision }, requires: ['slug', 'title', 'content', 'proposedChange', 'expectedRevision', 'accessToken'] } };
    const reviews = [];
    for (const review of (Array.isArray(note.frontmatter.notice_feedback) ? note.frontmatter.notice_feedback : []).slice(-5)) {
      if (!review || typeof review.path !== 'string' || !this.access.canAccessPhysicalPath(review.path, principal)) continue;
      try {
        const post = await this.fs.readNote(review.path, 262144);
        if (post.frontmatter.status !== 'published' || isModerationHidden(post.frontmatter) || post.revision !== review.revision) continue;
        reviews.push({ path: review.path, revision: review.revision, decision: review.decision, reason: String(review.reason ?? '').slice(0, 160) });
      } catch { /* Deleted/hidden proposals are not copied into public notices. */ }
    }
    if (reviews.length) result.reviews = reviews;
    if (note.frontmatter.notice_last_change?.reason) result.changeSummary = String(note.frontmatter.notice_last_change.reason).slice(0, 160);
    result.truncated = true;
    result.nextAction = { endpointId: 'notes.read', arguments: { path: entry.path, expectedRevision: note.revision, maxChars: 4000 } };
    if (JSON.stringify(result).length > maxChars) { delete result.reviews; delete result.changeSummary; delete result.feedbackAction; delete result.title; delete result.priority; }
    let low = 0, high = note.content.length;
    while (low < high) { const mid = Math.ceil((low + high) / 2); result.content = note.content.slice(0, mid); if (JSON.stringify(result).length <= maxChars) low = mid; else high = mid - 1; }
    // Never leave a dangling high surrogate in a Unicode excerpt.
    if (low && /[\uD800-\uDBFF]/.test(note.content[low - 1]!)) low--;
    result.content = note.content.slice(0, low); result.truncated = low < note.content.length;
    if (!result.truncated) delete result.nextAction;
    if (JSON.stringify(result).length > maxChars) throw new Error('Budget too small for exact notice identifiers; increase maxChars');
    await this.fresh(entry.id, note.revision, policyFingerprint, principal);
    return result;
  }
  async list(args: any = {}, principal?: ScopePrincipal) {
    const maxChars = budget(args.maxChars), limit = args.limit === undefined ? 20 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100');
    const config = this.registry.load(), fingerprint = hash(config);
    // Scope precedes ordering, cursor identity, counts and revision receipts.
    const entries = config.notices.filter(n => this.access.canAccessPhysicalPath(n.path, principal) && (!args.topic || n.topics.includes(args.topic)))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const visible: any[] = [];
    for (const entry of entries) {
      try {
        const { note } = await this.current(entry.id, principal);
        if (args.knownRevisions?.[entry.id] === note.revision) continue;
        visible.push({ id: entry.id, path: entry.path, title: entry.title, priority: entry.priority, revision: note.revision });
      } catch { /* Missing, hidden or unreadable targets expose no title/count. */ }
    }
    const snapshot = hash(visible), result: any = { notices: [], truncated: false };
    let offset = 0;
    if (args.cursor) {
      const cursor = JSON.parse(Buffer.from(text(args.cursor, 'cursor', 512), 'base64url').toString('utf8'));
      if (cursor.snapshot !== snapshot || !Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > visible.length) throw new Error('Notice list changed; restart without cursor');
      offset = cursor.offset;
    }
    for (let i = offset; i < visible.length; i++) {
      result.notices.push(visible[i]); result.truncated = i + 1 < visible.length;
      result.cursor = Buffer.from(JSON.stringify({ snapshot, offset: i + 1 })).toString('base64url');
      if (result.notices.length > limit || JSON.stringify(result).length > maxChars) {
        result.notices.pop(); result.truncated = true;
        result.cursor = Buffer.from(JSON.stringify({ snapshot, offset: i })).toString('base64url'); break;
      }
    }
    if (!result.truncated) delete result.cursor;
    if (result.truncated && !result.notices.length) throw new Error('Budget too small for a notice entry; increase maxChars');
    for (const item of result.notices) await this.fresh(item.id, item.revision, fingerprint, principal);
    return result;
  }
  async priority(args: any, principal?: ScopePrincipal) {
    const list = await this.list({ ...args, limit: 1, maxChars: 1800 }, principal);
    const selected = list.notices[0];
    if (!selected) return undefined;
    const packet: any = { protocol: 'mcpvault-notice/v1', primaryAction: { endpointId: 'notice.read', arguments: { id: selected.id, expectedRevision: selected.revision, maxChars: 3000 }, reason: 'Read this relevant notice revision once; keep its ID/revision receipt to avoid repeat reminders.' }, notice: selected, stopAfterAction: true };
    const maxChars = Math.max(512, Math.min(Number(args.maxChars) || 4000, 12000));
    if (JSON.stringify(packet).length > maxChars) delete packet.notice;
    return packet;
  }
  async feedbackReview(id: unknown, path: string, revision: string, principal?: ScopePrincipal) {
    try {
      const { entry, note, policyFingerprint } = await this.current(id, principal);
      const review = (Array.isArray(note.frontmatter.notice_feedback) ? note.frontmatter.notice_feedback : []).filter((r: any) => r?.path === path && r?.revision === revision).at(-1);
      if (!review) return undefined;
      await this.fresh(entry.id, note.revision, policyFingerprint, principal);
      return { decision: review.decision, reason: String(review.reason ?? '').slice(0, 500), noticeId: entry.id, noticePath: entry.path, noticeRevision: note.revision, feedbackRevision: revision };
    } catch { return undefined; }
  }
  async feedback(id: unknown, revision: unknown, principal?: ScopePrincipal) {
    const { entry, note, policyFingerprint } = await this.current(id, principal);
    // Public feedback must not copy an inaccessible private notice locator.
    const sharedPath = !/^_scopes\//i.test(entry.path) && this.access.canAccessPhysicalPath(entry.path, principal);
    if (!sharedPath || revision !== note.revision) throw new Error('Feedback requires a shared current notice revision');
    await this.fresh(entry.id, note.revision, policyFingerprint, principal);
    return { noticeId: entry.id, noticeRevision: note.revision, noticePath: entry.path };
  }
  private async prepare(args: any, principal?: ScopePrincipal) {
    const { entry, note, policyFingerprint } = await this.current(args.id, principal);
    if (!principal || !entry.editors.includes(principal.accountId)) throw new Error('Only a host-designated notice editor may revise this notice');
    if (args.expectedRevision !== note.revision) throw new Error('Notice revision conflict; reread');
    const content = args.content === undefined ? note.content : text(args.content, 'content', 20000);
    const reason = text(args.reason, 'reason', 500);
    const decision = args.decision ?? 'adopted';
    if (!['adopted', 'deferred', 'rejected'].includes(decision)) throw new Error('Invalid notice feedback decision');
    if (decision !== 'adopted' && content !== note.content) throw new Error('Deferred/rejected feedback cannot change the notice body');
    if (decision === 'adopted' && content === note.content) throw new Error('Adoption must change the notice body');
    let feedback: any;
    if (args.feedbackPath !== undefined) {
      const path = text(args.feedbackPath, 'feedbackPath', 240);
      if (!/^(?:Community|PublicCommunity\/Local)\/Posts\/[a-z0-9][a-z0-9._-]*\.md$/.test(path) || !this.access.canAccessPhysicalPath(path, principal)) throw new Error('Feedback unavailable');
      const post = await this.fs.readNote(path, 262144);
      if (post.revision !== args.feedbackRevision || post.frontmatter.category !== 'feedback' || post.frontmatter.status !== 'published' || isModerationHidden(post.frontmatter)
        || post.frontmatter.notice_id !== entry.id) throw new Error('Feedback or notice basis changed; review the current proposal');
      if (post.frontmatter.notice_revision !== note.revision && args.rebaseFeedback !== true) throw new Error('Notice basis changed; reread both documents and explicitly rebaseFeedback to review this older proposal');
      feedback = { path, revision: post.revision, decision, reason, proposedAgainst: post.frontmatter.notice_revision, reviewedAgainst: note.revision };
    } else if (decision !== 'adopted') throw new Error('A feedback target is required for deferred/rejected decisions');
    await this.references.validateAndNormalize([], entry.path, principal, content);
    const frontmatter = { ...note.frontmatter, notice_last_change: { by: principal.accountId, reason, previous_revision: note.revision },
      ...(feedback && { notice_feedback: [...(Array.isArray(note.frontmatter.notice_feedback) ? note.frontmatter.notice_feedback : []), feedback].slice(-20) }) };
    const fingerprint = hash({ entry, policyFingerprint, revision: note.revision, content, frontmatter, feedback });
    return { entry, note, policyFingerprint, fingerprint, content, frontmatter, feedback };
  }
  async preview(args: any, principal?: ScopePrincipal) {
    const p = await this.prepare(args, principal);
    let offset = 0;
    while (offset < p.note.content.length && offset < p.content.length && p.note.content[offset] === p.content[offset]) offset++;
    return { id: p.entry.id, path: p.entry.path, expectedRevision: p.note.revision, fingerprint: p.fingerprint,
      changedFrom: offset, before: p.note.content.slice(offset, offset + 400), after: p.content.slice(offset, offset + 400),
      previewTruncated: p.note.content.length - offset > 400 || p.content.length - offset > 400,
      decision: args.decision ?? 'adopted', reason: args.reason,
      nextAction: { endpointId: 'notice.revise', requires: ['same preview arguments', 'fingerprint'] } };
  }
  async revise(args: any, principal: ScopePrincipal | undefined, assertActor: () => Promise<unknown>, assertActorFresh: () => void) {
    const p = await this.prepare(args, principal);
    if (args.fingerprint !== p.fingerprint) throw new Error('Notice preview fingerprint mismatch; preview the exact change again');
    const assertAccess = async () => {
      await assertActor();
      const current = await this.prepare(args, principal);
      if (current.fingerprint !== p.fingerprint) throw new Error('Notice authority, proposal or revision changed');
      await assertActor();
    };
    await assertAccess();
    const params = { path: p.entry.path, content: p.content, frontmatter: p.frontmatter, expectedRevision: p.note.revision };
    const receipt = await this.registry.write(p.entry.path, p.policyFingerprint, () => p.feedback
      ? this.fs.writeNoteWithRevisionGuardsAndReceipt(params, [{ path: p.feedback.path, expectedRevision: p.feedback.revision }], { assertAccess })
      : this.fs.writeNoteWithReceipt(params, { assertAccess }), assertActorFresh);
    return { success: true, id: p.entry.id, path: p.entry.path, revision: receipt.revision, ...(p.feedback && { reviewedFeedback: p.feedback }), nextAction: { endpointId: 'notice.read', arguments: { id: p.entry.id, expectedRevision: receipt.revision } } };
  }
}
