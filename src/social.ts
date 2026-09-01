import { randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import type { ReferenceService } from './references.js';
import { isClosedWorkflowStatus, matchesWorkflowFilter, workflowStatus } from './community-status.js';
import { isModerationHidden, moderationStatus } from './moderation-policy.js';
import { boundItems } from './search-limits.js';
import { queryAllNotes, queryWindow } from './paged-query.js';
import type { ReputationService } from './reputation.js';
import { readNotesInBatches } from './batch-read.js';

const JOURNAL_ROOT = '_journal/entries';
const BLOG_ROOT = 'Community/Posts';
const COMMENTS_ROOT = 'Community/Comments';
const JOURNAL_KINDS = new Set(['diary', 'log', 'reflection']);
const POST_STATUSES = new Set(['draft', 'published', 'archived']);
export const COMMUNITY_POST_CATEGORIES = ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora'] as const;
export const AGORA_STANCES = ['for', 'against', 'neutral'] as const;
export const MAX_COMMUNITY_TEXT_LENGTH = 280;

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const agentJournalRoot = (agentId: string) => `_scopes/agents/${normalizeScopeId(agentId, 'agentId')}/${JOURNAL_ROOT}`;
const blogPath = (slug: string) => `${BLOG_ROOT}/${normalizeScopeId(slug, 'slug')}.md`;
function publicPostReference(value: string): string {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const match = new RegExp(`^${BLOG_ROOT}/([^/]+)\\.md$`, 'i').exec(raw);
  return match ? blogPath(match[1]!) : blogPath(raw);
}
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

function debateStance(value: unknown, isAgora: boolean): typeof AGORA_STANCES[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (isAgora) throw new Error("Agora comments require stance='for', 'against', or 'neutral'");
    return undefined;
  }
  const stance = String(value).trim().toLowerCase();
  if (!(AGORA_STANCES as readonly string[]).includes(stance)) throw new Error("stance must be for, against, or neutral");
  if (!isAgora) throw new Error("stance is only available on Agora topics");
  return stance as typeof AGORA_STANCES[number];
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
    private readonly reputation: ReputationService,
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
    const references = await this.references.validateAndNormalize(params.references ?? existingFrontmatter.references, path, principal, content);
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
        references,
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

  async listJournalEntries(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; date?: string }) {
    const principal = requireAgent(params.principal);
    const filters: Record<string, unknown> = { mcpvault_type: 'journal_entry' };
    if (params.date !== undefined) filters.date = validateDate(params.date);
    const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 500);
    const window = await queryWindow(this.fileSystem, {
      pathPrefix: agentJournalRoot(principal.agentId), filters,
      sortBy: 'date', sortOrder: 'desc',
      limit,
    }, () => true, path => this.access.canAccessPhysicalPath(path, principal));
    const total = await this.fileSystem.countNotes({ pathPrefix: agentJournalRoot(principal.agentId), filters }, path => this.access.canAccessPhysicalPath(path, principal));
    const bounded = boundItems(window.notes.map(note => ({
        path: this.access.toPublicPath(note.path),
        entryId: note.frontmatter.entry_id,
        date: note.frontmatter.date,
        kind: note.frontmatter.kind,
        title: note.frontmatter.title,
        mood: note.frontmatter.mood,
        tags: note.frontmatter.tags || [],
        updatedAt: note.frontmatter.updated_at,
      })), Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000));
    return {
      entries: bounded.items,
      total,
      truncated: window.truncated || total > window.notes.length || bounded.truncated,
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
    if (isModerationHidden(note.frontmatter)) throw new Error('This community post is unavailable because it was hidden by moderation');
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
    category?: string;
    seriesId?: string;
    seriesTitle?: string;
    seriesOrder?: number;
    relatedPosts?: unknown;
    duplicateOf?: string;
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
    const category = String(params.category ?? existing?.note.frontmatter.category ?? 'discussion').trim().toLowerCase();
    if (!(COMMUNITY_POST_CATEGORIES as readonly string[]).includes(category)) throw new Error(`category must be one of: ${COMMUNITY_POST_CATEGORIES.join(', ')}`);
    const seriesId = params.seriesId === undefined ? existing?.note.frontmatter.series_id : (params.seriesId ? normalizeScopeId(params.seriesId, 'seriesId') : undefined);
    const seriesOrder = params.seriesOrder === undefined ? existing?.note.frontmatter.series_order : Number(params.seriesOrder);
    if (seriesId && (!Number.isInteger(seriesOrder) || Number(seriesOrder) < 1)) throw new Error('seriesOrder must be a positive integer when seriesId is set');
    const relatedPosts = params.relatedPosts === undefined ? (existing?.note.frontmatter.related_posts || []) : (Array.isArray(params.relatedPosts) ? params.relatedPosts.map(value => publicPostReference(String(value))) : []);
    const duplicateOf = params.duplicateOf === undefined ? existing?.note.frontmatter.duplicate_of : (params.duplicateOf ? publicPostReference(params.duplicateOf) : undefined);
    for (const related of relatedPosts) {
      const relatedNote = await this.fileSystem.readNote(String(related));
      if (relatedNote.frontmatter.mcpvault_type !== 'blog_post') throw new Error(`related post is not a community post: ${related}`);
    }
    if (duplicateOf) {
      const duplicateNote = await this.fileSystem.readNote(String(duplicateOf));
      if (duplicateNote.frontmatter.mcpvault_type !== 'blog_post') throw new Error(`duplicateOf is not a community post: ${duplicateOf}`);
    }
    const timestamp = now();
    await this.fileSystem.writeNote({
      path,
      content: `${content}\n`,
      frontmatter: {
        ...(existing?.note.frontmatter || {}), mcpvault_type: 'blog_post', post_id: slug, title,
        author: existing?.note.frontmatter.author || identity(principal), author_role: existing?.note.frontmatter.author_role || principal.role,
        status, tags: cleanTags(params.tags ?? existing?.note.frontmatter.tags),
        category,
        ...(seriesId && { series_id: seriesId, ...(params.seriesTitle || existing?.note.frontmatter.series_title ? { series_title: String(params.seriesTitle || existing?.note.frontmatter.series_title).trim().slice(0, 180) } : {}), series_order: Number(seriesOrder) }),
        ...(!seriesId && existing?.note.frontmatter.series_id && { series_id: null, series_title: null, series_order: null }),
        related_posts: relatedPosts,
        ...(duplicateOf ? { duplicate_of: duplicateOf } : {}),
        references: await this.references.validateAndNormalize(params.references ?? existing?.note.frontmatter.references, path, principal, content),
        ...(existing ? { updated_at: timestamp } : { created_at: timestamp, updated_at: timestamp }),
        ...(!existing && { workflow_status: 'open' }),
      },
      expectedRevision: params.expectedRevision,
    });
    const written = await this.fileSystem.readNote(path);
    return { success: true, created: !existing, slug, path, status, revision: written.revision };
  }

  async listBlogPosts(params: { principal?: ScopePrincipal; status?: string; workflowStatus?: string; author?: string; category?: string; seriesId?: string; limit?: number; maxChars?: number; includeExcerpt?: boolean; excerptMaxChars?: number }) {
    const requestedStatus = String(params.status || 'published').trim().toLowerCase();
    if (requestedStatus !== 'all' && !POST_STATUSES.has(requestedStatus)) throw new Error('status must be published, draft, archived, or all');
    const filters: Record<string, unknown> = {
      mcpvault_type: 'blog_post',
      ...(requestedStatus !== 'all' && { status: requestedStatus }),
      ...(params.author && { author: String(params.author).trim().toLowerCase() }),
      ...(params.category && { category: String(params.category).trim().toLowerCase() }),
      ...(params.seriesId && { series_id: normalizeScopeId(params.seriesId, 'seriesId') }),
    };
    const caller = params.principal ? identity(params.principal) : undefined;
    const visible = (note: { frontmatter: Record<string, any> }) => {
      if (isModerationHidden(note.frontmatter)) return false;
      const status = String(note.frontmatter.status || 'published');
      if (requestedStatus !== 'all' && status !== requestedStatus) return false;
      if (status === 'draft' && caller !== note.frontmatter.author) return false;
      return matchesWorkflowFilter(note.frontmatter, params.workflowStatus || 'active');
    };
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
    const window = await queryWindow(this.fileSystem, {
      pathPrefix: BLOG_ROOT, filters,
      sortBy: 'updated_at', sortOrder: 'desc',
      limit,
    }, visible);
    const total = await this.fileSystem.countNotes({ pathPrefix: BLOG_ROOT, filters }, undefined, visible);
    return this.formatBlogPosts(window.notes, params, window.truncated || total > window.notes.length, total);
  }

  /** Read the published post set once for pulse's own-post and active-post signals. */
  async pulsePosts(params: { principal: ScopePrincipal; author: string; limit: number; maxChars: number }) {
    const result = await queryAllNotes(this.fileSystem, {
      pathPrefix: BLOG_ROOT, filters: { mcpvault_type: 'blog_post', status: 'published' },
      sortBy: 'updated_at', sortOrder: 'desc',
    });
    const visibleNotes = result.notes.filter(note => !isModerationHidden(note.frontmatter) && String(note.frontmatter.status || 'published') === 'published');
    const ownNotes = visibleNotes.filter(note => String(note.frontmatter.author || '').toLowerCase() === params.author.toLowerCase());
    const activeNotes = visibleNotes.filter(note => matchesWorkflowFilter(note.frontmatter, 'active'));
    const active = await this.formatBlogPosts(activeNotes, {
      principal: params.principal,
      limit: params.limit,
      maxChars: Math.min(params.maxChars, 6000),
      includeExcerpt: true,
      excerptMaxChars: 240,
    }, result.truncated);
    return { ownPublishedPosts: ownNotes.length, activePosts: active.posts, activeTotal: active.total, activeTruncated: active.truncated };
  }

  private async formatBlogPosts(
    visibleNotes: Array<{ path: string; frontmatter: Record<string, any> }>,
    params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; includeExcerpt?: boolean; excerptMaxChars?: number },
    queryTruncated: boolean,
    total = visibleNotes.length,
  ) {
    const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
    const selectedNotes = visibleNotes.slice(0, limit);
    const excerptByPath = new Map<string, string>();
    if (params.includeExcerpt) {
      const excerptLength = Math.min(Math.max(Number(params.excerptMaxChars ?? 280), 1), 1000);
      const excerpts = await Promise.all(selectedNotes.map(async note => {
        try {
          const full = await this.fileSystem.readNote(note.path);
          return [note.path, full.content.slice(0, excerptLength)] as const;
        } catch {
          return [note.path, ''] as const;
        }
      }));
      for (const [path, excerpt] of excerpts) excerptByPath.set(path, excerpt);
    }
    const reputations = await this.reputation.getMany(selectedNotes.map(note => String(note.frontmatter.author || '')));
    const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
    const entries = selectedNotes.map(note => ({
      path: note.path,
      slug: note.frontmatter.post_id,
      title: note.frontmatter.title,
      author: note.frontmatter.author,
      status: note.frontmatter.status,
      tags: note.frontmatter.tags || [],
      category: note.frontmatter.category || 'discussion',
      seriesId: note.frontmatter.series_id,
      seriesTitle: note.frontmatter.series_title,
      seriesOrder: note.frontmatter.series_order,
      relatedPosts: note.frontmatter.related_posts || [],
      duplicateOf: note.frontmatter.duplicate_of,
      createdAt: note.frontmatter.created_at,
      updatedAt: note.frontmatter.updated_at,
      workflowStatus: workflowStatus(note.frontmatter),
      workflowStatusBy: note.frontmatter.workflow_status_by,
      workflowStatusReason: note.frontmatter.workflow_status_reason,
      workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
      moderationStatus: moderationStatus(note.frontmatter),
      authorLevel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.level ?? 0,
      authorLevelLabel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비',
      ...(params.includeExcerpt && { excerpt: excerptByPath.get(note.path) || '' }),
    }));
    const bounded = boundItems(entries, Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000));
    return { posts: bounded.items, ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }), total, truncated: queryTruncated || total > visibleNotes.length || bounded.truncated };
  }

  async getBlogPost(params: { principal?: ScopePrincipal; slug: string; includeComments?: boolean; commentLimit?: number; commentMaxChars?: number; includeThreadContext?: boolean }) {
    const { path, note } = await this.readBlogPost(params.slug);
    const caller = params.principal ? identity(params.principal) : undefined;
    if (note.frontmatter.status === 'draft' && caller !== note.frontmatter.author) {
      throw new Error('This draft is private to its author');
    }
    const comments = await this.listBlogComments({ slug: params.slug, ...(params.principal && { principal: params.principal }), limit: params.includeComments ? (params.commentLimit ?? 10) : 1, maxChars: params.commentMaxChars ?? 4000, includeThreadContext: params.includeThreadContext !== false });
    const authorReputation = (await this.reputation.getMany([String(note.frontmatter.author || '')])).get(String(note.frontmatter.author || '').toLowerCase());
    const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
    return { path, fm: note.frontmatter, content: note.content, revision: note.revision, commentCount: comments.total,
      authorLevel: authorReputation?.level ?? 0,
      authorLevelLabel: authorReputation?.label ?? '뉴비',
      ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }),
      workflowStatus: workflowStatus(note.frontmatter),
      ...(params.includeComments && { comments: comments.comments, commentsTruncated: comments.truncated }),
      resolvedReferences: await this.references.resolve(note.frontmatter.references, params.principal), };
  }

  /** Read one comment directly so context-oriented callers do not need to scan a timeline. */
  async getBlogComment(params: { principal?: ScopePrincipal; slug: string; commentId: string; includeReferences?: boolean }) {
    const slug = normalizeScopeId(params.slug, 'slug');
    const commentId = normalizeScopeId(params.commentId, 'commentId');
    const post = await this.readBlogPost(slug);
    const caller = params.principal ? identity(params.principal) : undefined;
    if (post.note.frontmatter.status === 'draft' && caller !== post.note.frontmatter.author) {
      throw new Error('This draft is private to its author');
    }
    const path = commentPath(slug, commentId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'blog_comment') throw new Error(`Not a blog comment: ${commentId}`);
    if (isModerationHidden(note.frontmatter)) throw new Error('This community comment is unavailable because it was hidden by moderation');
    const authorReputation = (await this.reputation.getMany([String(note.frontmatter.author || '')])).get(String(note.frontmatter.author || '').toLowerCase());
    return {
      path,
      fm: note.frontmatter,
      commentId,
      postId: slug,
      content: note.content,
      revision: note.revision,
      authorLevel: authorReputation?.level ?? 0,
      authorLevelLabel: authorReputation?.label ?? '뉴비',
      ...(params.includeReferences !== false && { resolvedReferences: await this.references.resolve(note.frontmatter.references, params.principal) }),
    };
  }

  async commentOnBlogPost(params: { principal?: ScopePrincipal; slug: string; content: string; replyTo?: string; commentId?: string; references?: unknown; stance?: string }) {
    const principal = requirePublisher(params.principal);
    const slug = normalizeScopeId(params.slug, 'slug');
    const post = await this.readBlogPost(slug);
    if (post.note.frontmatter.status !== 'published') throw new Error('Comments are available only on published posts');
    const content = requireShortCommunityText(params.content);
    const stance = debateStance(params.stance, post.note.frontmatter.category === 'agora');
    const commentId = params.commentId ? normalizeScopeId(params.commentId, 'commentId') : `comment-${randomUUID().slice(0, 10)}`;
    if (params.replyTo) {
      await this.fileSystem.readNote(commentPath(slug, params.replyTo));
    }
    const timestamp = now();
    const path = commentPath(slug, commentId);
    const references = await this.references.validateAndNormalize(params.references, path, principal, content);
    await this.fileSystem.writeNote({
      path,
      content: `${content}\n`,
      frontmatter: {
        mcpvault_type: 'blog_comment', comment_id: commentId, post_id: slug,
        author: identity(principal), author_role: principal.role, created_at: timestamp, updated_at: timestamp,
        mentions: extractMentions(content),
        references,
        workflow_status: 'open',
        ...(stance && { stance }),
        ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }),
      },
      expectedRevision: 'missing',
    });
    const written = await this.fileSystem.readNote(path);
    return { success: true, commentId, postId: slug, path, revision: written.revision };
  }

  async editBlogComment(params: { principal?: ScopePrincipal; slug: string; commentId: string; content: string; references?: unknown; stance?: string; expectedRevision: string }) {
    const principal = requirePublisher(params.principal);
    const slug = normalizeScopeId(params.slug, 'slug');
    const commentId = normalizeScopeId(params.commentId, 'commentId');
    const path = commentPath(slug, commentId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'blog_comment') throw new Error(`Not a blog comment: ${commentId}`);
    if (note.frontmatter.author !== identity(principal)) throw new Error('Only the original comment author can edit this comment');
    if (!params.expectedRevision) throw new Error('expectedRevision is required; read the comment first');
    const text = requireShortCommunityText(params.content);
    const post = await this.readBlogPost(slug);
    const stance = debateStance(params.stance ?? note.frontmatter.stance, post.note.frontmatter.category === 'agora');
    const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, path, principal, text);
    await this.fileSystem.writeNote({ path, content: `${text}\n`, frontmatter: { ...note.frontmatter, content_status: 'published', mentions: extractMentions(text), references, ...(stance ? { stance } : {}), updated_at: now() }, expectedRevision: params.expectedRevision });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, commentId, postId: slug, revision: updated.revision };
  }

  async deleteBlogComment(params: { principal?: ScopePrincipal; slug: string; commentId: string; expectedRevision: string }) {
    const principal = requirePublisher(params.principal);
    const slug = normalizeScopeId(params.slug, 'slug');
    const commentId = normalizeScopeId(params.commentId, 'commentId');
    const path = commentPath(slug, commentId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'blog_comment') throw new Error(`Not a blog comment: ${commentId}`);
    if (note.frontmatter.author !== identity(principal)) throw new Error('Only the original comment author can delete this comment');
    if (!params.expectedRevision) throw new Error('expectedRevision is required; read the comment first');
    await this.fileSystem.writeNote({ path, content: '[deleted]\n', frontmatter: { ...note.frontmatter, content_status: 'deleted', deleted_at: now(), updated_at: now() }, expectedRevision: params.expectedRevision });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, commentId, postId: slug, deleted: true, revision: updated.revision };
  }

  async listBlogComments(params: { principal?: ScopePrincipal; slug: string; limit?: number; afterCommentId?: string; contextBefore?: number; maxChars?: number; includeThreadContext?: boolean; workflowStatus?: string }) {
    const slug = normalizeScopeId(params.slug, 'slug');
    const limit = windowNumber(params.limit, 20, 100);
    const maxChars = windowNumber(params.maxChars, 6000, 20000);
    const contextBefore = windowNumber(params.contextBefore, 2, 20) - 1;
    const filters = { mcpvault_type: 'blog_comment' };
    const visible = (note: { frontmatter: Record<string, any> }) => !isModerationHidden(note.frontmatter) && matchesWorkflowFilter(note.frontmatter, params.workflowStatus || 'all');
    let notes: Array<{ path: string; frontmatter: Record<string, any> }>;
    let total: number;
    let queryTruncated: boolean;
    if (params.afterCommentId) {
      const commentId = normalizeScopeId(params.afterCommentId, 'afterCommentId');
      const cursorResult = await this.fileSystem.queryNotes({
        pathPrefix: commentsRoot(slug), filters: { ...filters, comment_id: commentId },
        sortBy: 'created_at', sortOrder: 'asc', limit: 1, includeTotal: false,
      });
      const cursorNote = cursorResult.notes[0];
      if (!cursorNote || !visible(cursorNote)) throw new Error(`afterCommentId was not found in post: ${params.afterCommentId}`);
      const cursor = cursorNote.frontmatter.created_at === undefined
        ? { path: cursorNote.path, missing: true }
        : { path: cursorNote.path, value: cursorNote.frontmatter.created_at };
      const before = contextBefore > 0
        ? await queryWindow(this.fileSystem, { pathPrefix: commentsRoot(slug), filters, sortBy: 'created_at', sortOrder: 'desc', limit: contextBefore, after: cursor }, visible)
        : { notes: [], truncated: false };
      const forwardLimit = Math.max(1, limit - before.notes.length - 1);
      const forward = await queryWindow(this.fileSystem, { pathPrefix: commentsRoot(slug), filters, sortBy: 'created_at', sortOrder: 'asc', limit: forwardLimit, after: cursor }, visible);
      notes = [...before.notes].reverse();
      notes.push(cursorNote, ...forward.notes);
      total = await this.fileSystem.countNotes({ pathPrefix: commentsRoot(slug), filters }, undefined, visible);
      queryTruncated = before.truncated || forward.truncated;
    } else {
      const window = await queryWindow(this.fileSystem, {
        pathPrefix: commentsRoot(slug), filters,
        sortBy: 'created_at', sortOrder: 'asc', limit,
      }, visible);
      notes = window.notes;
      total = await this.fileSystem.countNotes({ pathPrefix: commentsRoot(slug), filters }, undefined, visible);
      queryTruncated = window.truncated;
    }
    const reputations = await this.reputation.getMany(notes.map(note => String(note.frontmatter.author || '')));
    const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
    const cursorIndex = params.afterCommentId
      ? notes.findIndex(note => note.frontmatter.comment_id === normalizeScopeId(params.afterCommentId!, 'afterCommentId'))
      : -1;
    if (params.afterCommentId && cursorIndex < 0) throw new Error(`afterCommentId was not found in post: ${params.afterCommentId}`);
    const start = cursorIndex >= 0 ? Math.max(0, cursorIndex - contextBefore) : Math.max(0, notes.length - limit);
    const selected: Array<{ note: typeof notes[number]; content: string; revision: string }> = [];
    let usedChars = 0;
    const candidates = notes.slice(start);
    let stop = false;
    for (let batchStart = 0; batchStart < candidates.length && selected.length < limit && !stop; batchStart += 10) {
      const batchNotes = candidates.slice(batchStart, batchStart + 10);
      const fullByPath = await readNotesInBatches(this.fileSystem, batchNotes.map(note => note.path));
      for (const note of batchNotes) {
        if (selected.length >= limit) break;
        const full = fullByPath.get(note.path);
        if (!full) continue;
        const contentLength = Array.from(full.content).length;
        if (selected.length > 0 && usedChars + contentLength > maxChars) {
          stop = true;
          break;
        }
        selected.push({ note, content: full.content, revision: full.revision });
        usedChars += contentLength;
      }
    }
    const last = selected.at(-1)?.note.frontmatter.comment_id;
    const selectedByPath = new Map(selected.map(item => [item.note.path, {
      path: item.note.path,
      frontmatter: item.note.frontmatter,
      content: item.content,
      revision: item.revision,
    }]));
    const parentPaths = params.includeThreadContext === false
      ? []
      : Array.from(new Set(selected
        .map(({ note }) => note.frontmatter.reply_to ? commentPath(slug, String(note.frontmatter.reply_to)) : undefined)
        .filter((path): path is string => Boolean(path))))
        .filter(path => !selectedByPath.has(path));
    const parentByPath = new Map(selectedByPath);
    for (const [path, parent] of await readNotesInBatches(this.fileSystem, parentPaths)) parentByPath.set(path, parent);
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
        stance: note.frontmatter.stance,
        workflowStatus: workflowStatus(note.frontmatter),
        workflowStatusBy: note.frontmatter.workflow_status_by,
        workflowStatusReason: note.frontmatter.workflow_status_reason,
        workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
        moderationStatus: moderationStatus(note.frontmatter),
        authorLevel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.level ?? 0,
        authorLevelLabel: reputations.get(String(note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비',
        ...(params.includeThreadContext !== false && note.frontmatter.reply_to && { parent: this.commentContextFromNote(slug, String(note.frontmatter.reply_to), parentByPath.get(commentPath(slug, String(note.frontmatter.reply_to)))) }),
      })),
      ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }),
      total,
      truncated: start > 0 || queryTruncated || start + selected.length < notes.length || total > notes.length,
      nextCursor: last,
      contextBefore: cursorIndex >= 0 ? contextBefore + 1 : 0,
    };
  }

  private commentContextFromNote(slug: string, commentId: string, parent: { path: string; frontmatter: Record<string, any>; content?: string } | undefined) {
    const path = commentPath(slug, commentId);
    if (!parent) throw new Error(`Reply target was not readable: ${commentId}`);
    if (parent.frontmatter.mcpvault_type !== 'blog_comment') throw new Error(`Reply target is not a blog comment: ${commentId}`);
    if (isModerationHidden(parent.frontmatter)) return { path, commentId: parent.frontmatter.comment_id, postId: parent.frontmatter.post_id, author: parent.frontmatter.author, createdAt: parent.frontmatter.created_at, content: '[moderated]', replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter), moderated: true };
    return { path, commentId: parent.frontmatter.comment_id, postId: parent.frontmatter.post_id, author: parent.frontmatter.author, createdAt: parent.frontmatter.created_at, content: parent.content, replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter) };
  }

  async listMentions(params: { principal?: ScopePrincipal; limit?: number; maxChars?: number; contextBefore?: number; contextAfter?: number; afterMentionId?: string; includeClosed?: boolean }) {
    const principal = requirePublisher(params.principal);
    const targets = new Set([identity(principal), principal.modelId, ...(principal.agentId ? [principal.agentId] : [])]);
    const [comments, messages] = await Promise.all([
      queryAllNotes(this.fileSystem, { pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc' }),
      queryAllNotes(this.fileSystem, { pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc' }),
    ]);
    const notes = [...comments.notes, ...messages.notes]
      .filter(note => !isModerationHidden(note.frontmatter)
        && (params.includeClosed === true || !isClosedWorkflowStatus(note.frontmatter.workflow_status))
        && Array.isArray(note.frontmatter.mentions) && note.frontmatter.mentions.some((mention: unknown) => targets.has(String(mention).toLowerCase())))
      .sort((a, b) => String(b.frontmatter.created_at).localeCompare(String(a.frontmatter.created_at)));
    const limit = windowNumber(params.limit, 20, 100);
    const maxChars = windowNumber(params.maxChars, 6000, 20000);
    const cursor = params.afterMentionId
      ? notes.findIndex(note => (note.frontmatter.message_id || note.frontmatter.comment_id) === params.afterMentionId)
      : -1;
    if (params.afterMentionId && cursor < 0) throw new Error(`afterMentionId was not found in mention results: ${params.afterMentionId}`);
    const mentions: Array<Record<string, unknown>> = [];
    let usedChars = 0;
    const contextBefore = Math.min(Math.max(Number(params.contextBefore ?? 1), 0), 3);
    const contextAfter = Math.min(Math.max(Number(params.contextAfter ?? 1), 0), 3);
    const hydrated = new Map<string, any>();
    const timelines = new Map<string, { key: 'comment_id' | 'message_id'; notes: typeof comments.notes }>();
    const hydrate = async (paths: string[]): Promise<void> => {
      const missing = Array.from(new Set(paths)).filter(path => !hydrated.has(path));
      for (const [path, note] of await readNotesInBatches(this.fileSystem, missing)) hydrated.set(path, note);
    };
    const timelineFor = async (note: any) => {
      const isChat = note.frontmatter.mcpvault_type === 'chat_message';
      const root = isChat
        ? `Community/ChatMessages/${note.frontmatter.room_id}`
        : `Community/Comments/${note.frontmatter.post_id}`;
      const key: 'comment_id' | 'message_id' = isChat ? 'message_id' : 'comment_id';
      const cacheKey = `${root}|${key}`;
      const cached = timelines.get(cacheKey);
      if (cached) return cached;
      const result = await queryAllNotes(this.fileSystem, { pathPrefix: root, filters: { mcpvault_type: isChat ? 'chat_message' : 'blog_comment' }, sortBy: 'created_at', sortOrder: 'asc' });
      const timeline = { key, notes: result.notes };
      timelines.set(cacheKey, timeline);
      return timeline;
    };
    for (const note of notes.slice(cursor >= 0 ? cursor + 1 : 0)) {
      if (mentions.length >= limit) break;
      const full = hydrated.get(note.path) || await this.fileSystem.readNote(note.path);
      hydrated.set(note.path, full);
      const length = Array.from(full.content).length;
      const item: Record<string, unknown> = {
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
        workflowStatus: workflowStatus(note.frontmatter),
        workflowStatusBy: note.frontmatter.workflow_status_by,
        workflowStatusReason: note.frontmatter.workflow_status_reason,
        workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
      };
      if (contextBefore || contextAfter) {
        const timeline = await timelineFor(note);
        const id = note.frontmatter[timeline.key];
        const at = timeline.notes.findIndex(item => item.frontmatter[timeline.key] === id);
        const neighborPaths: string[] = [];
        for (let index = Math.max(0, at - contextBefore); index <= Math.min(timeline.notes.length - 1, at + contextAfter); index += 1) {
          if (index !== at) neighborPaths.push(timeline.notes[index]!.path);
        }
        await hydrate(neighborPaths);
        const context: Array<Record<string, unknown>> = [];
        for (let index = Math.max(0, at - contextBefore); index <= Math.min(timeline.notes.length - 1, at + contextAfter); index += 1) {
          if (index === at || context.length >= contextBefore + contextAfter) continue;
          const neighbor = hydrated.get(timeline.notes[index]!.path);
          if (!neighbor) continue;
          context.push({ path: timeline.notes[index]!.path, id: neighbor.frontmatter[timeline.key], author: neighbor.frontmatter.author, createdAt: neighbor.frontmatter.created_at, content: neighbor.content });
        }
        item.context = context;
      }
      const itemLength = length + (Array.isArray(item.context) ? item.context.reduce((sum, entry) => sum + Array.from(String(entry.content || '')).length, 0) : 0);
      if (mentions.length > 0 && usedChars + itemLength > maxChars) break;
      mentions.push(item);
      usedChars += itemLength;
    }
    const nextCursor = mentions.at(-1)?.messageId || mentions.at(-1)?.commentId;
    return { mentions, total: notes.length, truncated: cursor >= 0 || notes.length > mentions.length, nextCursor, targets: Array.from(targets) };
  }
}
