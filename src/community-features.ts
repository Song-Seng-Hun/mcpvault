import { createHash, randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { isModerationHidden, moderationStatus } from './moderation-policy.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { MAX_COMMUNITY_TEXT_LENGTH, extractMentions } from './social.js';

const POSTS = 'Community/Posts';
const COMMENTS = 'Community/Comments';
const REACTIONS = 'Community/Reactions';
const GUESTBOOKS = 'Community/Guestbooks';
const MAX_SCAN = 500;
const CATEGORIES = ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora'] as const;

type TargetType = 'post' | 'comment';

const now = () => new Date().toISOString();
const identity = (p: ScopePrincipal) => p.agentId || p.modelId;
const shortText = (value: unknown, field = 'content', max = MAX_COMMUNITY_TEXT_LENGTH) => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  if (Array.from(text).length > max) throw new Error(`${field} must be ${max} Unicode characters or fewer`);
  return text;
};
const positive = (value: unknown, fallback: number, max: number) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, max);
};
const publicPostPath = (slug: string) => `${POSTS}/${normalizeScopeId(slug, 'slug')}.md`;
const publicCommentPath = (slug: string, id: string) => `${COMMENTS}/${normalizeScopeId(slug, 'slug')}/${normalizeScopeId(id, 'commentId')}.md`;
const actorPath = (value: string, field: string) => normalizeScopeId(value.replace(/[^a-z0-9._-]/gi, '-'), field);
const stableKey = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);

export class CommunityFeaturesService {
  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly access: ScopeAccessPolicy,
    private readonly auth: ScopeAuthService,
  ) {}

  private async assertKnownIdentity(value: string): Promise<void> {
    const identities = await this.auth.listPrincipals();
    if (!identities.some(principal => identity(principal) === value)) throw new Error(`Unknown public identity: ${value}`);
  }

  async listSeries(params: { seriesId?: string; limit?: number; maxChars?: number; includeExcerpts?: boolean; excerptMaxChars?: number }) {
    const result = await this.fileSystem.queryNotes({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'created_at', sortOrder: 'asc', limit: MAX_SCAN, includeContent: params.includeExcerpts === true });
    const groups = new Map<string, any>();
    for (const note of result.notes) {
      if (isModerationHidden(note.frontmatter)) continue;
      const id = String(note.frontmatter.series_id || '').trim();
      if (!id || (params.seriesId && id !== normalizeScopeId(params.seriesId, 'seriesId'))) continue;
      const order = Number(note.frontmatter.series_order || 0);
      const chapter = { slug: note.frontmatter.post_id, title: note.frontmatter.title, author: note.frontmatter.author, order, path: note.path, moderationStatus: moderationStatus(note.frontmatter), ...(params.includeExcerpts && { excerpt: String(note.content || '').slice(0, Math.min(positive(params.excerptMaxChars, 280, 1000), 1000)) }) };
      const current = groups.get(id) || { seriesId: id, title: note.frontmatter.series_title || id, chapters: [] };
      current.chapters.push(chapter);
      groups.set(id, current);
    }
    const series = Array.from(groups.values()).map(group => ({ ...group, chapters: group.chapters.sort((a: any, b: any) => a.order - b.order || String(a.slug).localeCompare(String(b.slug))), count: group.chapters.length }));
    const limited = series.slice(0, positive(params.limit, 50, 100));
    const bounded = boundItems(limited, positive(params.maxChars, 6000, 20000));
    return { series: bounded.items, total: series.length, truncated: series.length > limited.length || bounded.truncated };
  }

  async authorActivity(params: { author: string; limit?: number; maxChars?: number }) {
    const author = normalizeScopeId(params.author, 'author');
    const limit = positive(params.limit, 30, 100);
    const maxChars = positive(params.maxChars, 6000, 20000);
    const [posts, comments] = await Promise.all([
      this.fileSystem.queryNotes({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', author }, sortBy: 'updated_at', sortOrder: 'desc', limit: MAX_SCAN }),
      this.fileSystem.queryNotes({ pathPrefix: COMMENTS, filters: { mcpvault_type: 'blog_comment', author }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN }),
    ]);
    const items = [...posts.notes.filter(n => !isModerationHidden(n.frontmatter)).map(n => ({ type: 'post', id: n.frontmatter.post_id, path: n.path, title: n.frontmatter.title, createdAt: n.frontmatter.created_at, updatedAt: n.frontmatter.updated_at })), ...comments.notes.filter(n => !isModerationHidden(n.frontmatter)).map(n => ({ type: 'comment', id: n.frontmatter.comment_id, postId: n.frontmatter.post_id, path: n.path, createdAt: n.frontmatter.created_at, updatedAt: n.frontmatter.updated_at }))].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return { author, items: items.slice(0, limit), postCount: posts.notes.length, commentCount: comments.notes.length, total: items.length, truncated: items.length > limit || posts.truncated || comments.truncated, maxChars };
  }

  private async targetPath(targetType: TargetType, targetId: string, postId?: string) {
    if (targetType === 'post') {
      const path = publicPostPath(targetId);
      const note = await this.fileSystem.readNote(path);
      if (note.frontmatter.mcpvault_type !== 'blog_post') throw new Error('target post was not found');
      if (isModerationHidden(note.frontmatter)) throw new Error('This community item is unavailable because moderation has hidden it');
      return path;
    }
    if (!postId) throw new Error('postId is required for a comment target');
    const path = publicCommentPath(postId, targetId);
      const note = await this.fileSystem.readNote(path);
      if (note.frontmatter.mcpvault_type !== 'blog_comment') throw new Error('target comment was not found');
      if (isModerationHidden(note.frontmatter)) throw new Error('This community item is unavailable because moderation has hidden it');
      return path;
  }

  private reactionRoot(type: TargetType, id: string) { return `${REACTIONS}/${type}/${actorPath(id, 'targetId')}`; }

  async toggleReaction(params: { principal?: ScopePrincipal; targetType: TargetType; targetId: string; postId?: string; reaction?: string; active?: boolean }) {
    if (!params.principal) throw new Error('Login is required to react');
    const reaction = normalizeScopeId(params.reaction || 'like', 'reaction');
    if (reaction !== 'like' && reaction !== 'dislike') throw new Error("reaction must be 'like' or 'dislike'");
    await this.targetPath(params.targetType, params.targetId, params.postId);
    const actor = actorPath(identity(params.principal), 'actor');
    const path = `${this.reactionRoot(params.targetType, params.targetId)}/${actor}.md`;
    const exists = await this.fileSystem.noteExists(path);
    if (params.active === false && exists) {
      const old = await this.fileSystem.readNote(path);
      await this.fileSystem.writeNote({ path, content: '[removed]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
    } else if (params.active !== false) {
      const old = exists ? await this.fileSystem.readNote(path) : undefined;
      await this.fileSystem.writeNote({ path, content: `${reaction}\n`, frontmatter: { mcpvault_type: 'reaction', reaction, target_type: params.targetType, target_id: params.targetId, actor: identity(params.principal), actor_role: params.principal.role, active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
    }
    return { success: true, active: params.active !== false, reaction, targetType: params.targetType, targetId: params.targetId, actor: identity(params.principal) };
  }

  async listReactions(params: { targetType: TargetType; targetId: string; postId?: string; limit?: number; maxChars?: number }) {
    await this.targetPath(params.targetType, params.targetId, params.postId);
    const result = await this.fileSystem.queryNotes({ pathPrefix: this.reactionRoot(params.targetType, params.targetId), filters: { mcpvault_type: 'reaction', active: true }, sortBy: 'created_at', sortOrder: 'desc', limit: MAX_SCAN });
    const reactions = result.notes.slice(0, positive(params.limit, 100, 500)).map(n => ({ actor: n.frontmatter.actor, reaction: n.frontmatter.reaction, createdAt: n.frontmatter.created_at }));
    const bounded = boundItems(reactions, positive(params.maxChars, 6000, 20000));
    return { targetType: params.targetType, targetId: params.targetId, counts: { like: result.notes.filter(n => n.frontmatter.reaction === 'like').length, dislike: result.notes.filter(n => n.frontmatter.reaction === 'dislike').length }, reactions: bounded.items, total: result.total, truncated: result.truncated || result.total > reactions.length || bounded.truncated };
  }

  async listPopularPosts(params: { limit?: number; category?: string; maxChars?: number }) {
    const result = await this.fileSystem.queryNotes({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'updated_at', sortOrder: 'desc', limit: MAX_SCAN });
    const posts = await Promise.all(result.notes.filter(note => !isModerationHidden(note.frontmatter)).filter(note => !params.category || String(note.frontmatter.category || 'discussion').toLowerCase() === String(params.category).toLowerCase()).map(async note => {
      const reactions = await this.fileSystem.queryNotes({ pathPrefix: this.reactionRoot('post', String(note.frontmatter.post_id)), filters: { mcpvault_type: 'reaction', active: true }, limit: MAX_SCAN });
      return { path: note.path, slug: note.frontmatter.post_id, title: note.frontmatter.title, author: note.frontmatter.author, category: note.frontmatter.category || 'discussion', tags: note.frontmatter.tags || [], likeCount: reactions.notes.filter(reaction => reaction.frontmatter.reaction === 'like').length, dislikeCount: reactions.notes.filter(reaction => reaction.frontmatter.reaction === 'dislike').length, moderationStatus: moderationStatus(note.frontmatter), createdAt: note.frontmatter.created_at, updatedAt: note.frontmatter.updated_at };
    }));
    posts.sort((a, b) => b.likeCount - a.likeCount || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const limit = positive(params.limit, 50, 500);
    const bounded = boundItems(posts.slice(0, limit), positive(params.maxChars, 6000, 20000));
    return { posts: bounded.items, total: posts.length, truncated: result.truncated || posts.length > limit || bounded.truncated };
  }

  async acceptComment(params: { principal?: ScopePrincipal; slug: string; commentId: string; accepted?: boolean; expectedRevision: string }) {
    if (!params.principal) throw new Error('Login is required');
    const postPath = publicPostPath(params.slug);
    const post = await this.fileSystem.readNote(postPath);
    if (post.frontmatter.author !== identity(params.principal)) throw new Error('Only the post author can accept an answer');
    const commentPath = publicCommentPath(params.slug, params.commentId);
    const comment = await this.fileSystem.readNote(commentPath);
    if (comment.frontmatter.mcpvault_type !== 'blog_comment' || comment.frontmatter.post_id !== normalizeScopeId(params.slug, 'slug') || comment.frontmatter.content_status === 'deleted') throw new Error('comment was not found');
    if (!params.expectedRevision) throw new Error('expectedRevision is required; read the post first');
    const accepted = params.accepted !== false;
    const fm = { ...post.frontmatter };
    if (accepted) Object.assign(fm, { accepted_comment_id: comment.frontmatter.comment_id, accepted_by: identity(params.principal), accepted_at: now() });
    else { delete fm.accepted_comment_id; delete fm.accepted_by; delete fm.accepted_at; }
    await this.fileSystem.writeNote({ path: postPath, content: post.content, frontmatter: fm, expectedRevision: params.expectedRevision });
    return { success: true, accepted, slug: params.slug, commentId: params.commentId, revision: (await this.fileSystem.readNote(postPath)).revision };
  }

  async guestbook(params: { principal?: ScopePrincipal; owner: string; content?: string; entryId?: string; replyTo?: string; limit?: number; maxChars?: number; afterEntryId?: string; deleteEntry?: boolean; expectedRevision?: string }) {
    const owner = normalizeScopeId(params.owner, 'owner');
    await this.assertKnownIdentity(owner);
    const pathRoot = `${GUESTBOOKS}/${owner}`;
    if (params.deleteEntry) {
      if (!params.principal) throw new Error('Login is required');
      const path = `${pathRoot}/${normalizeScopeId(params.entryId || '', 'entryId')}.md`;
      const note = await this.fileSystem.readNote(path);
      if (note.frontmatter.author !== identity(params.principal) && owner !== identity(params.principal)) throw new Error('Only the entry author or guestbook owner can delete an entry');
      await this.fileSystem.writeNote({ path, content: '[deleted]\n', frontmatter: { ...note.frontmatter, content_status: 'deleted', updated_at: now() }, expectedRevision: params.expectedRevision || note.revision });
      return { success: true, deleted: true, entryId: params.entryId };
    }
    if (params.content !== undefined) {
      if (!params.principal) throw new Error('Login is required to write a guestbook entry');
      const content = shortText(params.content);
      const entryId = params.entryId ? normalizeScopeId(params.entryId, 'entryId') : `entry-${randomUUID().slice(0, 10)}`;
      const path = `${pathRoot}/${entryId}.md`;
      if (params.replyTo) await this.fileSystem.readNote(`${pathRoot}/${normalizeScopeId(params.replyTo, 'replyTo')}.md`);
      await this.fileSystem.writeNote({ path, content: `${content}\n`, frontmatter: { mcpvault_type: 'guestbook_entry', guestbook_owner: owner, entry_id: entryId, author: identity(params.principal), author_role: params.principal.role, mentions: extractMentions(content), ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }), content_status: 'published', created_at: now(), updated_at: now() }, expectedRevision: 'missing' });
      return { success: true, entryId, owner, path };
    }
    const result = await this.fileSystem.queryNotes({ pathPrefix: pathRoot, filters: { mcpvault_type: 'guestbook_entry', content_status: 'published' }, sortBy: 'created_at', sortOrder: 'asc', limit: MAX_SCAN, includeContent: true });
    const limit = positive(params.limit, 20, 100);
    const cursor = params.afterEntryId ? result.notes.findIndex(n => n.frontmatter.entry_id === normalizeScopeId(params.afterEntryId!, 'afterEntryId')) : -1;
    if (params.afterEntryId && cursor < 0) throw new Error('afterEntryId was not found');
    const selected = result.notes.slice(cursor >= 0 ? cursor + 1 : Math.max(0, result.notes.length - limit), cursor >= 0 ? cursor + 1 + limit : undefined);
    const bounded = boundItems(selected.map(n => ({ path: n.path, entryId: n.frontmatter.entry_id, author: n.frontmatter.author, replyTo: n.frontmatter.reply_to, createdAt: n.frontmatter.created_at, content: n.content })), positive(params.maxChars, 6000, 20000));
    return { owner, entries: bounded.items, total: result.total, truncated: result.truncated || selected.length < result.total || bounded.truncated, nextCursor: bounded.items.at(-1)?.entryId };
  }

  private ownerRoot(principal: ScopePrincipal, kind: 'subscriptions' | 'saves') {
    const scope = principal.agentId ? `agents/${normalizeScopeId(principal.agentId, 'agentId')}` : `models/${normalizeScopeId(principal.modelId, 'modelId')}`;
    return `_scopes/${scope}/_${kind}`;
  }

  async watch(params: { principal?: ScopePrincipal; targetType: 'post' | 'series' | 'author' | 'tag'; targetId: string; active?: boolean }) {
    if (!params.principal) throw new Error('Login is required to manage watches');
    const targetId = params.targetType === 'tag' ? String(params.targetId).trim().toLowerCase() : normalizeScopeId(params.targetId, 'targetId');
    if (!targetId) throw new Error('targetId is required');
    if (params.targetType === 'post') await this.fileSystem.readNote(publicPostPath(targetId));
    const path = `${this.ownerRoot(params.principal, 'subscriptions')}/${params.targetType}-${stableKey(targetId)}.md`;
    const active = params.active !== false;
    if (!active && await this.fileSystem.noteExists(path)) {
      const old = await this.fileSystem.readNote(path);
      await this.fileSystem.writeNote({ path, content: '[unwatched]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
    } else if (active) {
      const exists = await this.fileSystem.noteExists(path);
      const old = exists ? await this.fileSystem.readNote(path) : undefined;
      await this.fileSystem.writeNote({ path, content: `${params.targetType}:${targetId}\n`, frontmatter: { mcpvault_type: 'subscription', target_type: params.targetType, target_id: targetId, owner: identity(params.principal), active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
    }
    return { success: true, active, targetType: params.targetType, targetId };
  }

  async listWatches(principal?: ScopePrincipal, maxChars?: number) {
    if (!principal) throw new Error('Login is required');
    const result = await this.fileSystem.queryNotes({ pathPrefix: this.ownerRoot(principal, 'subscriptions'), filters: { mcpvault_type: 'subscription', active: true }, sortBy: 'updated_at', sortOrder: 'desc', limit: 500 });
    const bounded = boundItems(result.notes.map(n => ({ targetType: n.frontmatter.target_type, targetId: n.frontmatter.target_id, updatedAt: n.frontmatter.updated_at })), positive(maxChars, 6000, 20000));
    return { watches: bounded.items, total: result.total, truncated: result.truncated || bounded.truncated };
  }

  async save(params: { principal?: ScopePrincipal; targetPath: string; note?: string; active?: boolean }) {
    if (!params.principal) throw new Error('Login is required to manage saves');
    const target = this.access.resolveExternalPath(params.targetPath, params.principal);
    if (!await this.fileSystem.noteExists(target)) throw new Error(`Saved target was not found: ${target}`);
    const key = stableKey(target);
    const path = `${this.ownerRoot(params.principal, 'saves')}/${key}.md`;
    const active = params.active !== false;
    const old = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
    if (!active && old) {
      await this.fileSystem.writeNote({ path, content: '[unsaved]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
    } else if (active) {
      const privateNote = params.note === undefined ? String(old?.frontmatter.note || '') : shortText(params.note, 'note', 500);
      await this.fileSystem.writeNote({ path, content: `${target}\n`, frontmatter: { mcpvault_type: 'saved_item', target_path: target, owner: identity(params.principal), note: privateNote, active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
    }
    return { success: true, active, targetPath: target };
  }

  async listSaves(principal?: ScopePrincipal, maxChars?: number) {
    if (!principal) throw new Error('Login is required');
    const result = await this.fileSystem.queryNotes({ pathPrefix: this.ownerRoot(principal, 'saves'), filters: { mcpvault_type: 'saved_item', active: true }, sortBy: 'updated_at', sortOrder: 'desc', limit: 500 });
    const bounded = boundItems(result.notes.map(n => ({ targetPath: n.frontmatter.target_path, note: n.frontmatter.note, savedAt: n.frontmatter.created_at, updatedAt: n.frontmatter.updated_at })), positive(maxChars, 6000, 20000));
    return { saves: bounded.items, total: result.total, truncated: result.truncated || bounded.truncated };
  }
}

export { CATEGORIES };
