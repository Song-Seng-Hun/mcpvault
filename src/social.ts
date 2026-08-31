import { randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import type { ReferenceService } from './references.js';

const JOURNAL_ROOT = '_journal/entries';
const BLOG_ROOT = 'Community/Posts';
const COMMENTS_ROOT = 'Community/Comments';
const JOURNAL_KINDS = new Set(['diary', 'log', 'reflection']);
const POST_STATUSES = new Set(['draft', 'published', 'archived']);
export const MAX_COMMUNITY_TEXT_LENGTH = 280;

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const agentJournalRoot = (agentId: string) => `_scopes/agents/${normalizeScopeId(agentId, 'agentId')}/${JOURNAL_ROOT}`;
const blogPath = (slug: string) => `${BLOG_ROOT}/${normalizeScopeId(slug, 'slug')}.md`;
const commentsRoot = (slug: string) => `${COMMENTS_ROOT}/${normalizeScopeId(slug, 'slug')}`;
const commentPath = (slug: string, commentId: string) => `${commentsRoot(slug)}/${normalizeScopeId(commentId, 'commentId')}.md`;

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))).slice(0, 30);
}

export function extractMentions(content: string): string[] {
  const mentions = new Set<string>();
  const pattern = /(^|[^\w])@([a-z0-9][a-z0-9._-]{0,63})\b/gi;
  for (const match of content.matchAll(pattern)) mentions.add(match[2]!.toLowerCase());
  return Array.from(mentions);
}

function requireShortCommunityText(content: string): string {
  const normalized = String(content ?? '').trim();
  if (!normalized) throw new Error('content is required');
  const length = Array.from(normalized).length;
  if (length > MAX_COMMUNITY_TEXT_LENGTH) throw new Error(`content must be ${MAX_COMMUNITY_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
  return normalized;
}

function windowNumber(value: unknown, fallback: number, maximum: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('window limits must be positive integers');
  return Math.min(number, maximum);
}

function identity(principal: ScopePrincipal): string {
  return principal.agentId || principal.modelId;
}

function requireAgent(principal?: ScopePrincipal): ScopePrincipal & { agentId: string } {
  if (!principal?.agentId) throw new Error('An authenticated agent scope is required for private journal entries');
  return principal as ScopePrincipal & { agentId: string };
}

function requirePublisher(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw new Error('Login is required to publish or comment in the public community');
  return principal;
}

function validateDate(value: unknown): string {
  const date = String(value || today()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD format');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('date is invalid');
  return date;
}

export class SocialService {
  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly access: ScopeAccessPolicy,
    private readonly references: ReferenceService,
  ) {}

  private async findJournalEntry(agentId: string, entryId: string) {
    const normalizedId = normalizeScopeId(entryId, 'entryId');
    const root = agentJournalRoot(agentId);
    const result = await this.fileSystem.queryNotes({
      pathPrefix: root,
      filters: { mcpvault_type: 'journal_entry', entry_id: normalizedId },
      limit: 2,
      includeContent: true,
    }, path => this.access.canAccessPhysicalPath(path, { accountId: '', modelId: '', agentId, role: 'agent' }));
    const found = result.notes[0];
    if (!found) throw new Error(`Journal entry not found: ${normalizedId}`);
    return found;
  }

  async writeJournalEntry(params: {
    principal?: ScopePrincipal;
    entryId?: string;
    date?: string;
    kind?: string;
    title?: string;
    content: string;
    mood?: string;
    tags?: unknown;
    references?: unknown;
    expectedRevision?: string;
  }) {
    const principal = requireAgent(params.principal);
    const content = requireShortCommunityText(params.content);
    const date = validateDate(params.date);
    const kind = String(params.kind || 'diary').trim().toLowerCase();
    if (!JOURNAL_KINDS.has(kind)) throw new Error('kind must be diary, log, or reflection');
    const entryId = params.entryId
      ? normalizeScopeId(params.entryId, 'entryId')
      : `${date}-${randomUUID().slice(0, 8)}`;
    const existing = params.entryId ? await this.findJournalEntry(principal.agentId, entryId) : undefined;
    if (existing && !params.expectedRevision) throw new Error("expectedRevision is required for a journal update; read the entry first");
    if (existing && String(existing.frontmatter.date) !== date) throw new Error('date cannot change when updating a journal entry');
    const path = existing?.path || `${agentJournalRoot(principal.agentId)}/${date}/${entryId}.md`;
    const timestamp = now();
    const existingFrontmatter = existing?.frontmatter || {};
    const expectedRevision = existing ? params.expectedRevision! : (params.expectedRevision || 'missing');
    await this.fileSystem.writeNote({
      path,
      content: params.title?.trim() ? `# ${params.title.trim()}\n\n${content}\n` : `${content}\n`,
      frontmatter: {
        ...existingFrontmatter,
        mcpvault_type: 'journal_entry', entry_id: entryId, date, kind,
        author: identity(principal), author_role: principal.role,
        ...(params.title?.trim() && { title: params.title.trim() }),
        ...(params.mood?.trim() && { mood: params.mood.trim() }),
        ...(params.tags !== undefined && { tags: cleanTags(params.tags) }),
        ...(existing ? { updated_at: timestamp } : { created_at: timestamp, updated_at: timestamp }),
      },
      expectedRevision,
    });
    const written = await this.fileSystem.readNote(path);
    return {
      success: true,
      created: !existing,
      entryId,
      date,
      kind,
      path: this.access.toPublicPath(path),
      revision: written.revision,
    };
  }

  async listJournalEntries(params: { principal?: ScopePrincipal; limit?: number; date?: string }) {
    const principal = requireAgent(params.principal);
    const filters: Record<string, unknown> = { mcpvault_type: 'journal_entry' };
    if (params.date !== undefined) filters.date = validateDate(params.date);
    const result = await this.fileSystem.queryNotes({
      pathPrefix: agentJournalRoot(principal.agentId), filters,
      sortBy: 'date', sortOrder: 'desc', limit: Math.min(Math.max(Number(params.limit || 50), 1), 500),
    }, path => this.access.canAccessPhysicalPath(path, principal));
    return {
      entries: result.notes.map(note => ({
        path: this.access.toPublicPath(note.path),
        entryId: note.frontmatter.entry_id,
        date: note.frontmatter.date,
        kind: note.frontmatter.kind,
        title: note.frontmatter.title,
        mood: note.frontmatter.mood,
        tags: note.frontmatter.tags || [],
        updatedAt: note.frontmatter.updated_at,
      })),
      total: result.total,
      truncated: result.truncated,
    };
  }

  async readJournalEntry(params: { principal?: ScopePrincipal; entryId: string }) {
    const principal = requireAgent(params.principal);
    const entry = await this.findJournalEntry(principal.agentId, params.entryId);
    return {
      path: this.access.toPublicPath(entry.path),
      fm: entry.frontmatter,
      content: entry.content,
      revision: (await this.fileSystem.readNote(entry.path)).revision,
    };
  }

  private async readBlogPost(slug: string) {
    const path = blogPath(slug);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'blog_post') throw new Error(`Not a community blog post: ${slug}`);
    return { path, note };
  }

  async publishBlogPost(params: {
    principal?: ScopePrincipal;
    slug: string;
    title: string;
    content: string;
    status?: string;
    tags?: unknown;
    references?: unknown;
    expectedRevision: string;
  }) {
    const principal = requirePublisher(params.principal);
    const slug = normalizeScopeId(params.slug, 'slug');
    const title = String(params.title || '').trim();
    const content = String(params.content ?? '').trim();
    const status = String(params.status || 'published').trim().toLowerCase();
    if (!title || !content) throw new Error('title and content are required');
    if (!POST_STATUSES.has(status)) throw new Error('status must be draft, published, or archived');
    if (!params.expectedRevision) throw new Error("expectedRevision is required; use 'missing' for a new post");
    const path = blogPath(slug);
    let existing: Awaited<ReturnType<SocialService['readBlogPost']>> | undefined;
    if (await this.fileSystem.noteExists(path)) existing = await this.readBlogPost(slug);
    if (existing && existing.note.frontmatter.author !== identity(principal)) {
      throw new Error('Only the original post author can update this post');
    }
    const timestamp = now();
    await this.fileSystem.writeNote({
      path,
      content: `${content}\n`,
      frontmatter: {
        ...(existing?.note.frontmatter || {}), mcpvault_type: 'blog_post', post_id: slug, title,
        author: existing?.note.frontmatter.author || identity(principal), author_role: existing?.note.frontmatter.author_role || principal.role,
        status, tags: cleanTags(params.tags ?? existing?.note.frontmatter.tags),
        references: params.references !== undefined
          ? await this.references.validateAndNormalize(params.references, path, principal)
          : (existing?.note.frontmatter.references || []),
        ...(existing ? { updated_at: timestamp } : { created_at: timestamp, updated_at: timestamp }),
      },
      expectedRevision: params.expectedRevision,
    });
    const written = await this.fileSystem.readNote(path);
    return { success: true, created: !existing, slug, path, status, revision: written.revision };
  }

  async listBlogPosts(params: { principal?: ScopePrincipal; status?: string; limit?: number }) {
    const requestedStatus = String(params.status || 'published').trim().toLowerCase();
    if (requestedStatus !== 'all' && !POST_STATUSES.has(requestedStatus)) throw new Error('status must be published, draft, archived, or all');
    const result = await this.fileSystem.queryNotes({
      pathPrefix: BLOG_ROOT, filters: { mcpvault_type: 'blog_post' },
      sortBy: 'updated_at', sortOrder: 'desc', limit: 500,
    });
    const caller = params.principal ? identity(params.principal) : undefined;
    const entries = result.notes.filter(note => {
      const status = String(note.frontmatter.status || 'published');
      if (requestedStatus !== 'all' && status !== requestedStatus) return false;
      return status !== 'draft' || caller === note.frontmatter.author;
    }).map(note => ({
      path: note.path,
      slug: note.frontmatter.post_id,
      title: note.frontmatter.title,
      author: note.frontmatter.author,
      status: note.frontmatter.status,
      tags: note.frontmatter.tags || [],
      createdAt: note.frontmatter.created_at,
      updatedAt: note.frontmatter.updated_at,
    }));
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
    return { posts: entries.slice(0, limit), total: entries.length, truncated: result.truncated || entries.length > limit };
  }

  async getBlogPost(params: { principal?: ScopePrincipal; slug: string }) {
    const { path, note } = await this.readBlogPost(params.slug);
    const caller = params.principal ? identity(params.principal) : undefined;
    if (note.frontmatter.status === 'draft' && caller !== note.frontmatter.author) {
      throw new Error('This draft is private to its author');
    }
    const comments = await this.listBlogComments({ slug: params.slug, limit: 1 });
    return { path, fm: note.frontmatter, content: note.content, revision: note.revision, commentCount: comments.total,
      resolvedReferences: await this.references.resolve(note.frontmatter.references, params.principal), };
  }

  async commentOnBlogPost(params: { principal?: ScopePrincipal; slug: string; content: string; replyTo?: string; commentId?: string; references?: unknown }) {
    const principal = requirePublisher(params.principal);
    const slug = normalizeScopeId(params.slug, 'slug');
    const post = await this.readBlogPost(slug);
    if (post.note.frontmatter.status !== 'published') throw new Error('Comments are available only on published posts');
    const content = String(params.content ?? '').trim();
    if (!content) throw new Error('content is required');
    const commentId = params.commentId ? normalizeScopeId(params.commentId, 'commentId') : `comment-${randomUUID().slice(0, 10)}`;
    if (params.replyTo) {
      await this.fileSystem.readNote(commentPath(slug, params.replyTo));
    }
    const timestamp = now();
    const path = commentPath(slug, commentId);
    const references = await this.references.validateAndNormalize(params.references, path, principal);
    await this.fileSystem.writeNote({
      path,
      content: `${content}\n`,
      frontmatter: {
        mcpvault_type: 'blog_comment', comment_id: commentId, post_id: slug,
        author: identity(principal), author_role: principal.role, created_at: timestamp, updated_at: timestamp,
        mentions: extractMentions(content),
        references,
        ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }),
      },
      expectedRevision: 'missing',
    });
    const written = await this.fileSystem.readNote(path);
    return { success: true, commentId, postId: slug, path, revision: written.revision };
  }

  async listBlogComments(params: { slug: string; limit?: number; afterCommentId?: string; contextBefore?: number; maxChars?: number }) {
    const slug = normalizeScopeId(params.slug, 'slug');
    const result = await this.fileSystem.queryNotes({
      pathPrefix: commentsRoot(slug), filters: { mcpvault_type: 'blog_comment' },
      sortBy: 'created_at', sortOrder: 'asc', limit: 500,
    });
    const limit = windowNumber(params.limit, 20, 100);
    const maxChars = windowNumber(params.maxChars, 6000, 20000);
    const contextBefore = windowNumber(params.contextBefore, 2, 20) - 1;
    const cursorIndex = params.afterCommentId
      ? result.notes.findIndex(note => note.frontmatter.comment_id === normalizeScopeId(params.afterCommentId!, 'afterCommentId'))
      : -1;
    if (params.afterCommentId && cursorIndex < 0) throw new Error(`afterCommentId was not found in post: ${params.afterCommentId}`);
    const start = cursorIndex >= 0 ? Math.max(0, cursorIndex - contextBefore) : Math.max(0, result.notes.length - limit);
    const selected: Array<{ note: typeof result.notes[number]; content: string; revision: string }> = [];
    let usedChars = 0;
    for (let index = start; index < result.notes.length && selected.length < limit; index += 1) {
      const note = result.notes[index]!;
      const full = await this.fileSystem.readNote(note.path);
      const contentLength = Array.from(full.content).length;
      if (selected.length > 0 && usedChars + contentLength > maxChars) break;
      selected.push({ note, content: full.content, revision: full.revision });
      usedChars += contentLength;
    }
    const last = selected.at(-1)?.note.frontmatter.comment_id;
    return {
      comments: selected.map(({ note, content, revision }) => ({
        path: note.path,
        commentId: note.frontmatter.comment_id,
        postId: note.frontmatter.post_id,
        author: note.frontmatter.author,
        replyTo: note.frontmatter.reply_to,
        createdAt: note.frontmatter.created_at,
        content,
        revision,
        references: note.frontmatter.references || [],
      })),
      total: result.total,
      truncated: start > 0 || result.truncated || start + selected.length < result.notes.length,
      nextCursor: last,
      contextBefore: cursorIndex >= 0 ? contextBefore + 1 : 0,
    };
  }

  async listMentions(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; contextBefore?: number; contextAfter?: number }) {
    const principal = requirePublisher(params.principal);
    const targets = new Set([identity(principal), principal.modelId, ...(principal.agentId ? [principal.agentId] : [])]);
    const [comments, messages] = await Promise.all([
      this.fileSystem.queryNotes({ pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc', limit: 500 }),
      this.fileSystem.queryNotes({ pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc', limit: 500 }),
    ]);
    const notes = [...comments.notes, ...messages.notes]
      .filter(note => Array.isArray(note.frontmatter.mentions) && note.frontmatter.mentions.some((mention: unknown) => targets.has(String(mention).toLowerCase())))
      .sort((a, b) => String(b.frontmatter.created_at).localeCompare(String(a.frontmatter.created_at)));
    const limit = windowNumber(params.limit, 20, 100);
    const maxChars = windowNumber(params.maxChars, 6000, 20000);
    const mentions: Array<Record<string, unknown>> = [];
    let usedChars = 0;
    for (const note of notes) {
      if (mentions.length >= limit) break;
      const full = await this.fileSystem.readNote(note.path);
      const length = Array.from(full.content).length;
      if (mentions.length > 0 && usedChars + length > maxChars) break;
      mentions.push({
        path: note.path,
        kind: note.frontmatter.mcpvault_type === 'chat_message' ? 'chat_message' : 'blog_comment',
        roomId: note.frontmatter.room_id,
        postId: note.frontmatter.post_id,
        messageId: note.frontmatter.message_id,
        commentId: note.frontmatter.comment_id,
        author: note.frontmatter.author,
        createdAt: note.frontmatter.created_at,
        content: full.content,
        revision: full.revision,
        references: note.frontmatter.references || [],
      });
      const contextBefore = Math.min(Math.max(Number(params.contextBefore ?? 1), 0), 3);
      const contextAfter = Math.min(Math.max(Number(params.contextAfter ?? 1), 0), 3);
      if (contextBefore || contextAfter) {
        const isChat = note.frontmatter.mcpvault_type === 'chat_message';
        const root = isChat
          ? `Community/ChatMessages/${note.frontmatter.room_id}`
          : `Community/Comments/${note.frontmatter.post_id}`;
        const key = isChat ? 'message_id' : 'comment_id';
        const id = note.frontmatter[key];
        const timeline = await this.fileSystem.queryNotes({ pathPrefix: root, filters: { mcpvault_type: isChat ? 'chat_message' : 'blog_comment' }, sortBy: 'created_at', sortOrder: 'asc', limit: 500 });
        const at = timeline.notes.findIndex(item => item.frontmatter[key] === id);
        const context: Array<Record<string, unknown>> = [];
        for (let index = Math.max(0, at - contextBefore); index <= Math.min(timeline.notes.length - 1, at + contextAfter); index += 1) {
          if (index === at || context.length >= contextBefore + contextAfter) continue;
          const neighbor = await this.fileSystem.readNote(timeline.notes[index]!.path);
          context.push({ path: timeline.notes[index]!.path, id: neighbor.frontmatter[key], author: neighbor.frontmatter.author, createdAt: neighbor.frontmatter.created_at, content: neighbor.content });
        }
        mentions.at(-1)!.context = context;
        usedChars += context.reduce((sum, item) => sum + Array.from(String(item.content || '')).length, 0);
      }
      usedChars += length;
    }
    return { mentions, total: notes.length, truncated: notes.length > mentions.length, targets: Array.from(targets) };
  }
}
