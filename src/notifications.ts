import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import type { ReputationService } from './reputation.js';
import type { QueryNote } from './types.js';
import { iterateNotes, queryAllNotes } from './paged-query.js';
import { isClosedWorkflowStatus } from './community-status.js';
import { isModerationHidden } from './moderation-policy.js';

const READ_STATE_ROOT = '_notifications';
const EVENT_CACHE_TTL_MS = 2_000;
const EVENT_CACHE_MAX_ENTRIES = 64;
const HYDRATE_BATCH_SIZE = 32;

type NotificationKind = 'mention' | 'reply' | 'activity' | 'watch';

export interface NotificationEvent {
  notificationId: string;
  kind: NotificationKind;
  sourcePath: string;
  sourceType: string;
  sourceId: string;
  author: string;
  createdAt: string;
  content: string;
  context?: string;
  authorLevel?: number;
  authorLevelLabel?: string;
  unread: boolean;
}

export interface PublicSnapshot {
  posts: QueryNote[];
  comments: QueryNote[];
  messages: QueryNote[];
  rooms: QueryNote[];
}

export interface PublicSnapshotIndex extends PublicSnapshot {
  postsByPostId: Map<string, QueryNote[]>;
  postsBySeriesId: Map<string, QueryNote[]>;
  postsByAuthor: Map<string, QueryNote[]>;
  postsByTag: Map<string, QueryNote[]>;
  postsByMention: Map<string, QueryNote[]>;
  commentsByPostId: Map<string, QueryNote[]>;
  commentsByCommentId: Map<string, QueryNote[]>;
  commentsByAuthor: Map<string, QueryNote[]>;
  commentsByMention: Map<string, QueryNote[]>;
  commentsByReplyTo: Map<string, QueryNote[]>;
  messagesByMessageId: Map<string, QueryNote[]>;
  messagesByMention: Map<string, QueryNote[]>;
  messagesByReplyTo: Map<string, QueryNote[]>;
  postTitles: Map<string, string>;
  roomTitles: Map<string, string>;
  seriesFirstSeen: Map<string, { createdAt: string; path: string }>;
  seriesOrder: string[];
}

function identity(principal: ScopePrincipal): string {
  return principal.agentId || principal.modelId;
}

function readStatePath(principal: ScopePrincipal): string {
  const owner = principal.agentId
    ? `agents/${normalizeScopeId(principal.agentId, 'agentId')}`
    : `models/${normalizeScopeId(principal.modelId, 'modelId')}`;
  return `_scopes/${owner}/${READ_STATE_ROOT}/read-state.md`;
}

function limitNumber(value: unknown, fallback: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, maximum);
}

function maxChars(value: unknown): number {
  return limitNumber(value, 6000, 20000);
}

function eventId(kind: NotificationKind, path: string, sourceId: string): string {
  return `${kind}:${sourceId || path}`;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function addToIndex(index: Map<string, QueryNote[]>, key: unknown, note: QueryNote): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const existing = index.get(normalized);
  if (existing) existing.push(note);
  else index.set(normalized, [note]);
}

function addMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) addToIndex(index, mention, note);
}

type PublicCollection = keyof PublicSnapshot;

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function publicCollectionForPath(path: string): PublicCollection | undefined {
  const normalized = normalizePath(path);
  if (normalized.startsWith('Community/Posts/')) return 'posts';
  if (normalized.startsWith('Community/Comments/')) return 'comments';
  if (normalized.startsWith('Community/ChatMessages/')) return 'messages';
  if (normalized.startsWith('Community/ChatRooms/')) return 'rooms';
  return undefined;
}

function belongsInPublicCollection(note: QueryNote, collection: PublicCollection): boolean {
  const type = text(note.frontmatter.mcpvault_type).toLowerCase();
  if (collection === 'posts') return type === 'blog_post' && text(note.frontmatter.status).toLowerCase() === 'published';
  if (collection === 'comments') return type === 'blog_comment';
  if (collection === 'messages') return type === 'chat_message';
  return type === 'chat_room';
}

const PUBLIC_METADATA_FIELDS: Record<PublicCollection, readonly string[]> = {
  posts: ['mcpvault_type', 'status', 'post_id', 'title', 'author', 'category', 'tags', 'mentions', 'series_id', 'series_title', 'series_order', 'related_posts', 'duplicate_of', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at'],
  comments: ['mcpvault_type', 'post_id', 'comment_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
  messages: ['mcpvault_type', 'room_id', 'message_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
  rooms: ['mcpvault_type', 'room_id', 'title', 'creator', 'created_at', 'updated_at', 'archived', 'workflow_status', 'moderation_status'],
};

function compactPublicNote(note: QueryNote, collection: PublicCollection): QueryNote {
  const frontmatter = Object.fromEntries(PUBLIC_METADATA_FIELDS[collection]
    .filter(field => Object.prototype.hasOwnProperty.call(note.frontmatter, field))
    .map(field => [field, note.frontmatter[field]]));
  return { path: note.path, frontmatter };
}

function sortPublicCollection(notes: QueryNote[], collection: PublicCollection): QueryNote[] {
  if (collection === 'rooms') return notes.sort((a, b) => a.path.localeCompare(b.path));
  return notes.sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
}

function buildPublicSnapshotIndex(snapshot: PublicSnapshot): PublicSnapshotIndex {
  const index: PublicSnapshotIndex = {
    ...snapshot,
    postsByPostId: new Map(),
    postsBySeriesId: new Map(),
    postsByAuthor: new Map(),
    postsByTag: new Map(),
    postsByMention: new Map(),
    commentsByPostId: new Map(),
    commentsByCommentId: new Map(),
    commentsByAuthor: new Map(),
    commentsByMention: new Map(),
    commentsByReplyTo: new Map(),
    messagesByMessageId: new Map(),
    messagesByMention: new Map(),
    messagesByReplyTo: new Map(),
    postTitles: new Map(),
    roomTitles: new Map(),
    seriesFirstSeen: new Map(),
    seriesOrder: [],
  };
  const seriesFirstSeen = new Map<string, { createdAt: string; path: string }>();
  for (const note of snapshot.posts) {
    addToIndex(index.postsByPostId, note.frontmatter.post_id, note);
    addToIndex(index.postsBySeriesId, note.frontmatter.series_id, note);
    addToIndex(index.postsByAuthor, note.frontmatter.author, note);
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId && !isModerationHidden(note.frontmatter)) {
      const seen = seriesFirstSeen.get(seriesId);
      const candidate = { createdAt: text(note.frontmatter.created_at), path: note.path };
      if (!seen || candidate.createdAt < seen.createdAt || (candidate.createdAt === seen.createdAt && candidate.path < seen.path)) seriesFirstSeen.set(seriesId, candidate);
    }
    addMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) {
      for (const tag of note.frontmatter.tags) addToIndex(index.postsByTag, tag, note);
    }
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.set(postId, text(note.frontmatter.title, postId));
  }
  for (const note of snapshot.comments) {
    addToIndex(index.commentsByPostId, note.frontmatter.post_id, note);
    addToIndex(index.commentsByCommentId, note.frontmatter.comment_id, note);
    addToIndex(index.commentsByAuthor, note.frontmatter.author, note);
    addMentions(index.commentsByMention, note);
    addToIndex(index.commentsByReplyTo, note.frontmatter.reply_to, note);
  }
  for (const note of snapshot.messages) {
    addToIndex(index.messagesByMessageId, note.frontmatter.message_id, note);
    addMentions(index.messagesByMention, note);
    addToIndex(index.messagesByReplyTo, note.frontmatter.reply_to, note);
  }
  for (const note of snapshot.rooms) {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
  }
  index.seriesOrder = [...seriesFirstSeen.entries()]
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
    .map(([seriesId]) => seriesId);
  index.seriesFirstSeen = seriesFirstSeen;
  return index;
}

function cloneCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, notes: QueryNote[]): PublicSnapshotIndex {
  const next = { ...index, [collection]: notes } as PublicSnapshotIndex;
  if (collection === 'posts') {
    return {
      ...next,
      postsByPostId: new Map(index.postsByPostId),
      postsBySeriesId: new Map(index.postsBySeriesId),
      postsByAuthor: new Map(index.postsByAuthor),
      postsByTag: new Map(index.postsByTag),
      postsByMention: new Map(index.postsByMention),
      postTitles: new Map(index.postTitles),
      seriesFirstSeen: new Map(index.seriesFirstSeen),
      seriesOrder: index.seriesOrder.slice(),
    };
  }
  if (collection === 'comments') {
    return {
      ...next,
      commentsByPostId: new Map(index.commentsByPostId),
      commentsByCommentId: new Map(index.commentsByCommentId),
      commentsByAuthor: new Map(index.commentsByAuthor),
      commentsByMention: new Map(index.commentsByMention),
      commentsByReplyTo: new Map(index.commentsByReplyTo),
    };
  }
  if (collection === 'messages') {
    return {
      ...next,
      messagesByMessageId: new Map(index.messagesByMessageId),
      messagesByMention: new Map(index.messagesByMention),
      messagesByReplyTo: new Map(index.messagesByReplyTo),
    };
  }
  return { ...next, roomTitles: new Map(index.roomTitles) };
}

function removeIndexedValue(index: Map<string, QueryNote[]>, key: unknown, path: string): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const bucket = index.get(normalized);
  if (!bucket) return;
  const next = bucket.filter(note => note.path !== path);
  if (next.length) index.set(normalized, next);
  else index.delete(normalized);
}

function addIndexedValue(index: Map<string, QueryNote[]>, key: unknown, note: QueryNote): void {
  const normalized = text(key).toLowerCase();
  if (!normalized) return;
  const bucket = index.get(normalized);
  if (bucket) index.set(normalized, [...bucket, note]);
  else index.set(normalized, [note]);
}

function removeIndexedMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) removeIndexedValue(index, mention, note.path);
}

function addIndexedMentions(index: Map<string, QueryNote[]>, note: QueryNote): void {
  if (!Array.isArray(note.frontmatter.mentions)) return;
  for (const mention of note.frontmatter.mentions) addIndexedValue(index, mention, note);
}

function removeFromCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, note: QueryNote): Set<string> {
  const affectedSeries = new Set<string>();
  if (collection === 'posts') {
    removeIndexedValue(index.postsByPostId, note.frontmatter.post_id, note.path);
    removeIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note.path);
    removeIndexedValue(index.postsByAuthor, note.frontmatter.author, note.path);
    removeIndexedMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) for (const tag of note.frontmatter.tags) removeIndexedValue(index.postsByTag, tag, note.path);
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.delete(postId);
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId) affectedSeries.add(seriesId);
  } else if (collection === 'comments') {
    removeIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note.path);
    removeIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note.path);
    removeIndexedValue(index.commentsByAuthor, note.frontmatter.author, note.path);
    removeIndexedMentions(index.commentsByMention, note);
    removeIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note.path);
  } else if (collection === 'messages') {
    removeIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note.path);
    removeIndexedMentions(index.messagesByMention, note);
    removeIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note.path);
  } else {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.delete(roomId);
  }
  return affectedSeries;
}

function addToCollectionIndex(index: PublicSnapshotIndex, collection: PublicCollection, note: QueryNote): Set<string> {
  const affectedSeries = new Set<string>();
  if (collection === 'posts') {
    addIndexedValue(index.postsByPostId, note.frontmatter.post_id, note);
    addIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note);
    addIndexedValue(index.postsByAuthor, note.frontmatter.author, note);
    addIndexedMentions(index.postsByMention, note);
    if (Array.isArray(note.frontmatter.tags)) for (const tag of note.frontmatter.tags) addIndexedValue(index.postsByTag, tag, note);
    const postId = text(note.frontmatter.post_id);
    if (postId) index.postTitles.set(postId, text(note.frontmatter.title, postId));
    const seriesId = text(note.frontmatter.series_id).toLowerCase();
    if (seriesId) affectedSeries.add(seriesId);
  } else if (collection === 'comments') {
    addIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note);
    addIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note);
    addIndexedValue(index.commentsByAuthor, note.frontmatter.author, note);
    addIndexedMentions(index.commentsByMention, note);
    addIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note);
  } else if (collection === 'messages') {
    addIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note);
    addIndexedMentions(index.messagesByMention, note);
    addIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note);
  } else {
    const roomId = text(note.frontmatter.room_id);
    if (roomId) index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
  }
  return affectedSeries;
}

function refreshSeriesOrder(index: PublicSnapshotIndex, seriesIds: Set<string>): void {
  for (const seriesId of seriesIds) {
    const candidates = (index.postsBySeriesId.get(seriesId) || []).filter(note => !isModerationHidden(note.frontmatter));
    if (!candidates.length) {
      index.seriesFirstSeen.delete(seriesId);
      continue;
    }
    let first = candidates[0]!;
    for (const candidate of candidates.slice(1)) {
      const candidateCreatedAt = text(candidate.frontmatter.created_at);
      const firstCreatedAt = text(first.frontmatter.created_at);
      if (candidateCreatedAt < firstCreatedAt || (candidateCreatedAt === firstCreatedAt && candidate.path < first.path)) first = candidate;
    }
    index.seriesFirstSeen.set(seriesId, { createdAt: text(first.frontmatter.created_at), path: first.path });
  }
  index.seriesOrder = [...index.seriesFirstSeen.entries()]
    .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
    .map(([seriesId]) => seriesId);
}

function patchPublicSnapshotIndex(index: PublicSnapshotIndex, collection: PublicCollection, notes: QueryNote[], previous: QueryNote | undefined, nextNote: QueryNote | undefined): PublicSnapshotIndex {
  const next = cloneCollectionIndex(index, collection, notes);
  const affectedSeries = new Set<string>();
  if (previous) for (const seriesId of removeFromCollectionIndex(next, collection, previous)) affectedSeries.add(seriesId);
  if (nextNote) for (const seriesId of addToCollectionIndex(next, collection, nextNote)) affectedSeries.add(seriesId);
  if (collection === 'posts') refreshSeriesOrder(next, affectedSeries);
  return next;
}

export class NotificationService {
  private readonly eventCache = new Map<string, { expiresAt: number; events: NotificationEvent[] }>();
  private readonly eventInFlight = new Map<string, Promise<NotificationEvent[]>>();
  private publicSnapshotCache: { expiresAt: number; value: PublicSnapshotIndex } | undefined;
  private publicSnapshotInFlight: Promise<PublicSnapshotIndex> | undefined;
  private publicSnapshotUpdate: Promise<void> | undefined;

  constructor(private readonly fileSystem: FileSystemService, private readonly reputation: ReputationService) {}

  async discoverySnapshot(): Promise<PublicSnapshotIndex> {
    return this.cachedPublicSnapshot();
  }

  /** Return only indexed public items that mention one of the exact identities. */
  async mentionCandidates(targets: ReadonlySet<string>, includeClosed = false): Promise<QueryNote[]> {
    const snapshot = await this.cachedPublicSnapshot();
    const unique = new Map<string, QueryNote>();
    for (const target of targets) {
      const key = target.toLowerCase();
      for (const note of [...(snapshot.commentsByMention.get(key) || []), ...(snapshot.messagesByMention.get(key) || [])]) {
        if (isModerationHidden(note.frontmatter)) continue;
        if (!includeClosed && isClosedWorkflowStatus(note.frontmatter.workflow_status)) continue;
        unique.set(note.path, note);
      }
    }
    return [...unique.values()].sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
  }

  invalidate(path?: string, kind: 'upsert' | 'delete' = 'upsert'): void {
    this.eventCache.clear();
    this.eventInFlight.clear();
    const collection = path ? publicCollectionForPath(path) : undefined;
    if (!path || !collection) {
      if (!path) this.publicSnapshotCache = undefined;
      return;
    }
    const previous = this.publicSnapshotUpdate || Promise.resolve();
    const update = previous.then(() => this.updatePublicSnapshot(path, kind, collection)).catch(() => {
      this.publicSnapshotCache = undefined;
    });
    this.publicSnapshotUpdate = update;
    void update.finally(() => {
      if (this.publicSnapshotUpdate === update) this.publicSnapshotUpdate = undefined;
    });
  }

  private async cachedPublicSnapshot(): Promise<PublicSnapshotIndex> {
    while (this.publicSnapshotUpdate) await this.publicSnapshotUpdate;
    const cached = this.publicSnapshotCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (this.publicSnapshotInFlight) return this.publicSnapshotInFlight;
    const computation = (async () => {
      const snapshot: PublicSnapshot = { posts: [], comments: [], messages: [], rooms: [] };
      for await (const note of iterateNotes(this.fileSystem)) {
        const collection = publicCollectionForPath(note.path);
        if (collection && belongsInPublicCollection(note, collection)) snapshot[collection].push(compactPublicNote(note, collection));
      }
      for (const collection of ['posts', 'comments', 'messages', 'rooms'] as const) sortPublicCollection(snapshot[collection], collection);
      return buildPublicSnapshotIndex(snapshot);
    })();
    this.publicSnapshotInFlight = computation;
    try {
      const value = await computation;
      this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
      return value;
    } finally {
      if (this.publicSnapshotInFlight === computation) this.publicSnapshotInFlight = undefined;
    }
  }

  private async updatePublicSnapshot(path: string, kind: 'upsert' | 'delete', collection: PublicCollection): Promise<void> {
    if (this.publicSnapshotInFlight) await this.publicSnapshotInFlight;
    const cached = this.publicSnapshotCache;
    if (!cached || cached.expiresAt <= Date.now()) {
      this.publicSnapshotCache = undefined;
      return;
    }
    const previous = cached.value[collection].find(note => note.path === path);
    const nextCollection = cached.value[collection].filter(note => note.path !== path);
    let nextNote: QueryNote | undefined;
    if (kind !== 'delete') {
      const note = await this.fileSystem.readNote(path);
      const metadata: QueryNote = { path: normalizePath(path), frontmatter: compactPublicNote({ path, frontmatter: note.frontmatter }, collection).frontmatter };
      if (belongsInPublicCollection(metadata, collection)) {
        nextNote = metadata;
        nextCollection.push(metadata);
      }
    }
    sortPublicCollection(nextCollection, collection);
    this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value: patchPublicSnapshotIndex(cached.value, collection, nextCollection, previous, nextNote) };
  }

  private async hydrateNotes(notes: QueryNote[]): Promise<QueryNote[]> {
    const unique = [...new Map(notes.map(note => [note.path, note])).values()];
    const hydrated: QueryNote[] = [];
    for (let start = 0; start < unique.length; start += HYDRATE_BATCH_SIZE) {
      const batch = unique.slice(start, start + HYDRATE_BATCH_SIZE);
      const results = await Promise.all(batch.map(async note => {
        try {
          const parsed = await this.fileSystem.readNote(note.path);
          return { ...note, frontmatter: parsed.frontmatter, content: parsed.content };
        } catch {
          return undefined;
        }
      }));
      hydrated.push(...results.filter((note): note is QueryNote & { content: string } => note !== undefined));
    }
    return hydrated;
  }

  private async cachedPublicEvents(principal: ScopePrincipal): Promise<NotificationEvent[]> {
    const key = JSON.stringify({ accountId: principal.accountId, modelId: principal.modelId, agentId: principal.agentId, role: principal.role });
    const cached = this.eventCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.events.map(event => ({ ...event }));
    if (cached) this.eventCache.delete(key);
    const running = this.eventInFlight.get(key);
    if (running) return (await running).map(event => ({ ...event }));
    const computation = this.publicEvents(principal);
    this.eventInFlight.set(key, computation);
    try {
      const events = await computation;
      this.eventCache.set(key, { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, events: events.map(event => ({ ...event })) });
      while (this.eventCache.size > EVENT_CACHE_MAX_ENTRIES) {
        const oldest = this.eventCache.keys().next();
        if (oldest.done) break;
        this.eventCache.delete(oldest.value);
      }
      return events;
    } finally {
      if (this.eventInFlight.get(key) === computation) this.eventInFlight.delete(key);
    }
  }

  private async lastReadAt(principal: ScopePrincipal): Promise<{ value?: string; revision?: string }> {
    const path = readStatePath(principal);
    if (!await this.fileSystem.noteExists(path)) return {};
    const note = await this.fileSystem.readNote(path);
    return { value: text(note.frontmatter.last_read_at), revision: note.revision };
  }

  private async publicEvents(principal: ScopePrincipal): Promise<NotificationEvent[]> {
    const target = identity(principal);
    const ownerRoot = principal.agentId
      ? `_scopes/agents/${normalizeScopeId(principal.agentId, 'agentId')}/_subscriptions`
      : `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_subscriptions`;
    const [snapshot, subscriptions] = await Promise.all([
      this.cachedPublicSnapshot(),
      queryAllNotes(this.fileSystem, { pathPrefix: ownerRoot, filters: { mcpvault_type: 'subscription', active: true } }),
    ]);
    const { messages, postsByPostId, postsBySeriesId, postsByAuthor, postsByTag, postsByMention, commentsByPostId, commentsByCommentId, commentsByAuthor, commentsByMention, commentsByReplyTo, messagesByMessageId, messagesByMention, messagesByReplyTo, postTitles, roomTitles } = snapshot;
    const targetKey = target.toLowerCase();
    const ownedPostIds = new Set((postsByAuthor.get(targetKey) || []).map(note => text(note.frontmatter.post_id)));
    const ownedCommentIds = new Set((commentsByAuthor.get(targetKey) || []).map(note => text(note.frontmatter.comment_id)));
    const ownedMessageIds = new Set(messages.filter(note => text(note.frontmatter.author).toLowerCase() === targetKey).map(note => text(note.frontmatter.message_id)));

    const watchedPostIds = new Set<string>();
    const watchedSeriesIds = new Set<string>();
    const watchedAuthors = new Set<string>();
    const watchedTags = new Set<string>();
    for (const subscription of subscriptions.notes) {
      const type = text(subscription.frontmatter.target_type).toLowerCase();
      const value = text(subscription.frontmatter.target_id).toLowerCase();
      if (!value) continue;
      if (type === 'post') watchedPostIds.add(value);
      else if (type === 'series') watchedSeriesIds.add(value);
      else if (type === 'author') watchedAuthors.add(value);
      else if (type === 'tag') watchedTags.add(value);
    }
    const uniqueNotes = (notesToAdd: QueryNote[][]): QueryNote[] => {
      const unique = new Map<string, QueryNote>();
      for (const notes of notesToAdd) for (const note of notes) unique.set(note.path, note);
      return [...unique.values()];
    };
    const relevantPosts = uniqueNotes([
      postsByMention.get(targetKey) || [],
      ...[...watchedPostIds].map(id => postsByPostId.get(id) || []),
      ...[...watchedSeriesIds].map(id => postsBySeriesId.get(id) || []),
      ...[...watchedAuthors].map(id => postsByAuthor.get(id) || []),
      ...[...watchedTags].map(id => postsByTag.get(id) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const relevantComments = uniqueNotes([
      commentsByMention.get(targetKey) || [],
      ...[...ownedCommentIds].map(id => commentsByReplyTo.get(id.toLowerCase()) || []),
      ...[...ownedPostIds].map(id => commentsByPostId.get(id.toLowerCase()) || []),
      ...[...watchedPostIds].map(id => commentsByPostId.get(id) || []),
      ...[...watchedAuthors].map(id => commentsByAuthor.get(id) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const relevantMessages = uniqueNotes([
      messagesByMention.get(targetKey) || [],
      ...[...ownedMessageIds].map(id => messagesByReplyTo.get(id.toLowerCase()) || []),
    ]).filter(note => text(note.frontmatter.author).toLowerCase() !== targetKey);
    const parentCommentIds = new Set(relevantComments.map(note => text(note.frontmatter.reply_to)).filter(Boolean));
    const parentMessageIds = new Set(relevantMessages.map(note => text(note.frontmatter.reply_to)).filter(Boolean));
    const hydratedPosts = await this.hydrateNotes(relevantPosts);
    const hydratedComments = await this.hydrateNotes([
      ...relevantComments,
      ...[...parentCommentIds].flatMap(id => commentsByCommentId.get(id.toLowerCase()) || []),
    ]);
    const hydratedMessages = await this.hydrateNotes([
      ...relevantMessages,
      ...[...parentMessageIds].flatMap(id => messagesByMessageId.get(id.toLowerCase()) || []),
    ]);
    const commentBodies = new Map(hydratedComments.map(note => [text(note.frontmatter.comment_id), text(note.content).trim()]));
    const messageBodies = new Map(hydratedMessages.map(note => [text(note.frontmatter.message_id), text(note.content).trim()]));
    const events: NotificationEvent[] = [];
    const reputations = await this.reputation.getMany([...hydratedComments, ...hydratedMessages, ...hydratedPosts].map(note => text(note.frontmatter.author)));
    const hydratedByPath = new Map([...hydratedPosts, ...hydratedComments, ...hydratedMessages].map(note => [note.path, note]));
    const watchedSourceCache = new Map<string, QueryNote[]>();
    const watchedSources = (type: string, target: string): QueryNote[] => {
      const cacheKey = `${type}:${target}`;
      const cached = watchedSourceCache.get(cacheKey);
      if (cached) return cached;
      const metadataSources = type === 'post'
        ? [...(postsByPostId.get(target) || []), ...(commentsByPostId.get(target) || [])]
        : type === 'series'
          ? (postsBySeriesId.get(target) || [])
          : type === 'author'
            ? [...(postsByAuthor.get(target) || []), ...(commentsByAuthor.get(target) || [])]
            : type === 'tag'
            ? (postsByTag.get(target) || [])
            : [];
      const sources = metadataSources.map(note => hydratedByPath.get(note.path) || note);
      watchedSourceCache.set(cacheKey, sources);
      return sources;
    };

    const add = (note: { path: string; frontmatter: Record<string, any>; content?: string }, kind: NotificationKind, sourceId: string) => {
      const author = text(note.frontmatter.author);
      if (!author || author === target) return;
      const mentions = Array.isArray(note.frontmatter.mentions) ? note.frontmatter.mentions.map(String).map(value => value.toLowerCase()) : [];
      const isMention = mentions.includes(target.toLowerCase());
      const replyTo = text(note.frontmatter.reply_to);
      const isReply = (note.frontmatter.mcpvault_type === 'blog_comment' && ownedCommentIds.has(replyTo))
        || (note.frontmatter.mcpvault_type === 'chat_message' && ownedMessageIds.has(replyTo));
      const postId = text(note.frontmatter.post_id);
      const roomId = text(note.frontmatter.room_id);
      const activity = note.frontmatter.mcpvault_type === 'blog_comment' && ownedPostIds.has(postId);
      if (!isMention && !isReply && !activity) return;
      const selectedKind: NotificationKind = isMention ? 'mention' : isReply ? 'reply' : kind;
      const parentBody = note.frontmatter.mcpvault_type === 'blog_comment' ? commentBodies.get(replyTo) : messageBodies.get(replyTo);
      const contextParts = note.frontmatter.mcpvault_type === 'blog_comment'
        ? [`post: ${postTitles.get(postId) || postId}`, ...(parentBody ? [`replying to: ${parentBody}`] : [])]
        : [`room: ${roomTitles.get(roomId) || roomId}`, ...(parentBody ? [`replying to: ${parentBody}`] : [])];
      events.push({
        notificationId: eventId(selectedKind, note.path, sourceId),
        kind: selectedKind,
        sourcePath: note.path,
        sourceType: text(note.frontmatter.mcpvault_type),
        sourceId,
        author,
        createdAt: text(note.frontmatter.created_at),
        content: text(note.content).trim(),
        context: contextParts.join(' | '),
        ...(reputations.get(author.toLowerCase()) && { authorLevel: reputations.get(author.toLowerCase())!.level, authorLevelLabel: reputations.get(author.toLowerCase())!.label }),
        unread: true,
      });
    };

    for (const note of hydratedComments) add(note, 'activity', text(note.frontmatter.comment_id));
    for (const note of hydratedMessages) add(note, 'activity', text(note.frontmatter.message_id));
    // A post mention is useful too, while comments on a post are handled above.
    for (const note of hydratedPosts) add(note, 'activity', text(note.frontmatter.post_id));
    const watchedEvents = new Set<string>();
    for (const subscription of subscriptions.notes) {
      const type = text(subscription.frontmatter.target_type);
      const target = text(subscription.frontmatter.target_id).toLowerCase();
      const sources = watchedSources(type, target);
      for (const note of sources) {
        const sourceId = text(note.frontmatter.post_id || note.frontmatter.comment_id);
        const notificationId = eventId('watch', note.path, `${type}:${target}:${sourceId}`);
        if (watchedEvents.has(notificationId) || text(note.frontmatter.author) === identity(principal)) continue;
        watchedEvents.add(notificationId);
        const author = text(note.frontmatter.author);
        const authorReputation = reputations.get(author.toLowerCase());
        events.push({ notificationId, kind: 'watch', sourcePath: note.path, sourceType: text(note.frontmatter.mcpvault_type), sourceId, author, createdAt: text(note.frontmatter.updated_at || note.frontmatter.created_at), content: text(note.content).trim(), context: `watched ${type}: ${target}`, ...(authorReputation && { authorLevel: authorReputation.level, authorLevelLabel: authorReputation.label }), unread: true });
      }
    }
    return events.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async list(params: { principal?: ScopePrincipal; includeRead?: boolean; limit?: number; maxChars?: number; afterNotificationId?: string }) {
    if (!params.principal) throw new Error('Login is required to read notifications');
    const state = await this.lastReadAt(params.principal);
    const cutoff = state.value || '';
    let events = await this.cachedPublicEvents(params.principal);
    events = events.map(event => ({ ...event, unread: !cutoff || event.createdAt > cutoff }));
    if (!params.includeRead) events = events.filter(event => event.unread);
    if (params.afterNotificationId) {
      const index = events.findIndex(event => event.notificationId === params.afterNotificationId);
      if (index >= 0) events = events.slice(index + 1);
    }
    const limit = limitNumber(params.limit, 20, 100);
    const budget = maxChars(params.maxChars);
    const selected: NotificationEvent[] = [];
    let used = 0;
    for (const event of events) {
      if (selected.length >= limit) break;
      const size = Array.from(event.content).length + Array.from(event.context || '').length;
      if (selected.length > 0 && used + size > budget) break;
      selected.push(event);
      used += size;
    }
    return {
      notifications: selected,
      unreadCount: events.filter(event => event.unread).length,
      total: events.length,
      truncated: selected.length < events.length,
      lastReadAt: cutoff || undefined,
      nextCursor: selected.at(-1)?.notificationId,
    };
  }

  async markRead(params: { principal?: ScopePrincipal; through?: string; expectedRevision?: string }) {
    if (!params.principal) throw new Error('Login is required to mark notifications read');
    const path = readStatePath(params.principal);
    const existing = await this.lastReadAt(params.principal);
    const timestamp = new Date().toISOString();
    await this.fileSystem.writeNote({
      path,
      content: `Notifications read through ${params.through || 'now'}\n`,
      frontmatter: {
        mcpvault_type: 'notification_read_state',
        owner: identity(params.principal),
        last_read_at: timestamp,
        ...(params.through && { through_notification_id: params.through }),
        updated_at: timestamp,
      },
      expectedRevision: params.expectedRevision || (existing.revision ? existing.revision : 'missing'),
    });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, lastReadAt: timestamp, through: params.through, revision: updated.revision };
  }
}
