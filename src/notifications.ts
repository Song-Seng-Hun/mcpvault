import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import type { ReputationService } from './reputation.js';
import type { QueryNote } from './types.js';

const READ_STATE_ROOT = '_notifications';
const MAX_SCAN = 500;
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

interface PublicSnapshot {
  posts: QueryNote[];
  comments: QueryNote[];
  messages: QueryNote[];
  rooms: QueryNote[];
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

export class NotificationService {
  private readonly eventCache = new Map<string, { expiresAt: number; events: NotificationEvent[] }>();
  private readonly eventInFlight = new Map<string, Promise<NotificationEvent[]>>();
  private publicSnapshotCache: { expiresAt: number; value: PublicSnapshot } | undefined;
  private publicSnapshotInFlight: Promise<PublicSnapshot> | undefined;

  constructor(private readonly fileSystem: FileSystemService, private readonly reputation: ReputationService) {}

  invalidate(): void {
    this.eventCache.clear();
    this.eventInFlight.clear();
    this.publicSnapshotCache = undefined;
    this.publicSnapshotInFlight = undefined;
  }

  private async cachedPublicSnapshot(): Promise<PublicSnapshot> {
    const cached = this.publicSnapshotCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (this.publicSnapshotInFlight) return this.publicSnapshotInFlight;
    const computation = Promise.all([
      this.fileSystem.queryNotes({ pathPrefix: 'Community/Posts', filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/ChatRooms', filters: { mcpvault_type: 'chat_room' }, limit: MAX_SCAN }),
    ]).then(([posts, comments, messages, rooms]) => ({ posts: posts.notes, comments: comments.notes, messages: messages.notes, rooms: rooms.notes }));
    this.publicSnapshotInFlight = computation;
    try {
      const value = await computation;
      this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
      return value;
    } finally {
      if (this.publicSnapshotInFlight === computation) this.publicSnapshotInFlight = undefined;
    }
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
      this.fileSystem.queryNotes({ pathPrefix: ownerRoot, filters: { mcpvault_type: 'subscription', active: true }, limit: 500 }),
    ]);
    const { posts, comments, messages, rooms } = snapshot;

    const ownedPostIds = new Set(posts.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.post_id)));
    const ownedCommentIds = new Set(comments.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.comment_id)));
    const ownedMessageIds = new Set(messages.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.message_id)));
    const postTitles = new Map(posts.map(note => [text(note.frontmatter.post_id), text(note.frontmatter.title, text(note.frontmatter.post_id))]));
    const roomTitles = new Map(rooms.map(note => [text(note.frontmatter.room_id), text(note.frontmatter.title, text(note.frontmatter.room_id))]));

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
    const hasMention = (note: QueryNote): boolean => Array.isArray(note.frontmatter.mentions)
      && note.frontmatter.mentions.map(String).some(value => value.toLowerCase() === target.toLowerCase());
    const watchedPost = (note: QueryNote): boolean => {
      const postId = text(note.frontmatter.post_id).toLowerCase();
      const author = text(note.frontmatter.author).toLowerCase();
      const tags = Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags.map(String).map(value => value.toLowerCase()) : [];
      return watchedPostIds.has(postId)
        || watchedSeriesIds.has(text(note.frontmatter.series_id).toLowerCase())
        || watchedAuthors.has(author)
        || tags.some(tag => watchedTags.has(tag));
    };
    const relevantComment = (note: QueryNote): boolean => {
      const author = text(note.frontmatter.author);
      const replyTo = text(note.frontmatter.reply_to);
      const activity = ownedPostIds.has(text(note.frontmatter.post_id));
      const watched = watchedPostIds.has(text(note.frontmatter.post_id).toLowerCase())
        || watchedAuthors.has(author.toLowerCase());
      return author !== target && (hasMention(note) || ownedCommentIds.has(replyTo) || activity || watched);
    };
    const relevantMessage = (note: QueryNote): boolean => {
      const author = text(note.frontmatter.author);
      return author !== target && (hasMention(note) || ownedMessageIds.has(text(note.frontmatter.reply_to)));
    };
    const relevantPosts = posts.filter(note => text(note.frontmatter.author) !== target && (hasMention(note) || watchedPost(note)));
    const relevantComments = comments.filter(relevantComment);
    const relevantMessages = messages.filter(relevantMessage);
    const parentCommentIds = new Set(relevantComments.map(note => text(note.frontmatter.reply_to)).filter(Boolean));
    const parentMessageIds = new Set(relevantMessages.map(note => text(note.frontmatter.reply_to)).filter(Boolean));
    const hydratedPosts = await this.hydrateNotes(relevantPosts);
    const hydratedComments = await this.hydrateNotes([
      ...relevantComments,
      ...comments.filter(note => parentCommentIds.has(text(note.frontmatter.comment_id))),
    ]);
    const hydratedMessages = await this.hydrateNotes([
      ...relevantMessages,
      ...messages.filter(note => parentMessageIds.has(text(note.frontmatter.message_id))),
    ]);
    const commentBodies = new Map(hydratedComments.map(note => [text(note.frontmatter.comment_id), text(note.content).trim()]));
    const messageBodies = new Map(hydratedMessages.map(note => [text(note.frontmatter.message_id), text(note.content).trim()]));
    const events: NotificationEvent[] = [];
    const reputations = await this.reputation.getMany([...comments, ...messages, ...posts].map(note => text(note.frontmatter.author)));
    const postsByPostId = new Map<string, QueryNote[]>();
    const commentsByPostId = new Map<string, QueryNote[]>();
    const postsBySeriesId = new Map<string, QueryNote[]>();
    const postsByAuthor = new Map<string, QueryNote[]>();
    const commentsByAuthor = new Map<string, QueryNote[]>();
    const postsByTag = new Map<string, QueryNote[]>();
    const addToIndex = (index: Map<string, QueryNote[]>, key: unknown, note: QueryNote) => {
      const normalized = text(key).toLowerCase();
      if (!normalized) return;
      const existing = index.get(normalized);
      if (existing) existing.push(note);
      else index.set(normalized, [note]);
    };
    for (const note of hydratedPosts) {
      addToIndex(postsByPostId, note.frontmatter.post_id, note);
      addToIndex(postsBySeriesId, note.frontmatter.series_id, note);
      addToIndex(postsByAuthor, note.frontmatter.author, note);
      if (Array.isArray(note.frontmatter.tags)) {
        for (const tag of note.frontmatter.tags) addToIndex(postsByTag, tag, note);
      }
    }
    for (const note of hydratedComments) {
      addToIndex(commentsByPostId, note.frontmatter.post_id, note);
      addToIndex(commentsByAuthor, note.frontmatter.author, note);
    }
    const watchedSourceCache = new Map<string, QueryNote[]>();
    const watchedSources = (type: string, target: string): QueryNote[] => {
      const cacheKey = `${type}:${target}`;
      const cached = watchedSourceCache.get(cacheKey);
      if (cached) return cached;
      const sources = type === 'post'
        ? [...(postsByPostId.get(target) || []), ...(commentsByPostId.get(target) || [])]
        : type === 'series'
          ? (postsBySeriesId.get(target) || [])
          : type === 'author'
            ? [...(postsByAuthor.get(target) || []), ...(commentsByAuthor.get(target) || [])]
            : type === 'tag'
              ? (postsByTag.get(target) || [])
              : [];
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
