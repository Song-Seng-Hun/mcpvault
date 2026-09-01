import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';

const READ_STATE_ROOT = '_notifications';
const MAX_SCAN = 500;

type NotificationKind = 'mention' | 'reply' | 'activity';

interface NotificationEvent {
  notificationId: string;
  kind: NotificationKind;
  sourcePath: string;
  sourceType: string;
  sourceId: string;
  author: string;
  createdAt: string;
  content: string;
  context?: string;
  unread: boolean;
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
  constructor(private readonly fileSystem: FileSystemService) {}

  private async lastReadAt(principal: ScopePrincipal): Promise<{ value?: string; revision?: string }> {
    const path = readStatePath(principal);
    if (!await this.fileSystem.noteExists(path)) return {};
    const note = await this.fileSystem.readNote(path);
    return { value: text(note.frontmatter.last_read_at), revision: note.revision };
  }

  private async publicEvents(principal: ScopePrincipal): Promise<NotificationEvent[]> {
    const target = identity(principal);
    const [posts, comments, messages, rooms] = await Promise.all([
      this.fileSystem.queryNotes({ pathPrefix: 'Community/Posts', filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN, includeContent: true }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN, includeContent: true }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN, includeContent: true }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/ChatRooms', filters: { mcpvault_type: 'chat_room' }, limit: MAX_SCAN }),
    ]);

    const ownedPostIds = new Set(posts.notes.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.post_id)));
    const ownedCommentIds = new Set(comments.notes.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.comment_id)));
    const ownedMessageIds = new Set(messages.notes.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.message_id)));
    const postTitles = new Map(posts.notes.map(note => [text(note.frontmatter.post_id), text(note.frontmatter.title, text(note.frontmatter.post_id))]));
    const roomTitles = new Map(rooms.notes.map(note => [text(note.frontmatter.room_id), text(note.frontmatter.title, text(note.frontmatter.room_id))]));
    const commentBodies = new Map(comments.notes.map(note => [text(note.frontmatter.comment_id), text(note.content).trim()]));
    const messageBodies = new Map(messages.notes.map(note => [text(note.frontmatter.message_id), text(note.content).trim()]));
    const events: NotificationEvent[] = [];

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
        unread: true,
      });
    };

    for (const note of comments.notes) add(note, 'activity', text(note.frontmatter.comment_id));
    for (const note of messages.notes) add(note, 'activity', text(note.frontmatter.message_id));
    // A post mention is useful too, while comments on a post are handled above.
    for (const note of posts.notes) add(note, 'activity', text(note.frontmatter.post_id));
    return events.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async list(params: { principal?: ScopePrincipal; includeRead?: boolean; limit?: number; maxChars?: number; afterNotificationId?: string }) {
    if (!params.principal) throw new Error('Login is required to read notifications');
    const state = await this.lastReadAt(params.principal);
    const cutoff = state.value || '';
    let events = await this.publicEvents(params.principal);
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
