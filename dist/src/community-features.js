import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isModerationHidden, moderationStatus } from './moderation-policy.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems, boundedTopK } from './search-limits.js';
import { MAX_COMMUNITY_TEXT_LENGTH, extractMentions } from './social.js';
import { iterateNotes, queryAllNotes, queryWindow } from './paged-query.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
const POSTS = 'Community/Posts';
const COMMENTS = 'Community/Comments';
const REACTIONS = 'Community/Reactions';
const GUESTBOOKS = 'Community/Guestbooks';
const MAX_SCAN = 500;
const REACTION_CACHE_TTL_MS = 2_000;
const REACTION_SNAPSHOT_VERSION = 1;
const REACTION_SNAPSHOT_FILE = '.mcpvault/community-reactions.snapshot.bin';
const MAX_REACTION_SNAPSHOT_ENTRIES = 100_000;
const CATEGORIES = ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora'];
const now = () => new Date().toISOString();
const identity = (p) => p.agentId || p.modelId;
const shortText = (value, field = 'content', max = MAX_COMMUNITY_TEXT_LENGTH) => {
    const text = String(value ?? '').trim();
    if (!text)
        throw new Error(`${field} is required`);
    if (Array.from(text).length > max)
        throw new Error(`${field} must be ${max} Unicode characters or fewer`);
    return text;
};
const positive = (value, fallback, max) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('limit must be a positive integer');
    return Math.min(parsed, max);
};
const publicPostPath = (slug) => `${POSTS}/${normalizeScopeId(slug, 'slug')}.md`;
const publicCommentPath = (slug, id) => `${COMMENTS}/${normalizeScopeId(slug, 'slug')}/${normalizeScopeId(id, 'commentId')}.md`;
const actorPath = (value, field) => normalizeScopeId(value.replace(/[^a-z0-9._-]/gi, '-'), field);
const stableKey = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
function encodeSnapshotString(value) {
    const encoded = Buffer.from(value, 'utf8');
    const output = Buffer.allocUnsafe(4 + encoded.length);
    output.writeUInt32LE(encoded.length, 0);
    encoded.copy(output, 4);
    return output;
}
function decodeSnapshotString(buffer, offset) {
    if (offset + 4 > buffer.length)
        throw new Error('invalid reaction snapshot');
    const length = buffer.readUInt32LE(offset);
    const start = offset + 4;
    const end = start + length;
    if (end > buffer.length)
        throw new Error('invalid reaction snapshot');
    return { value: buffer.subarray(start, end).toString('utf8'), offset: end };
}
function encodeReactionSnapshot(snapshot) {
    const chunks = [];
    const header = Buffer.alloc(16);
    header.writeUInt32LE(0x4d435052, 0);
    header.writeUInt32LE(REACTION_SNAPSHOT_VERSION, 4);
    header.writeUInt32LE(snapshot.entries.length, 8);
    header.writeUInt32LE(snapshot.counts.length, 12);
    chunks.push(header);
    for (const entry of snapshot.entries) {
        chunks.push(encodeSnapshotString(entry.path));
        const metadata = Buffer.alloc(16);
        metadata.writeDoubleLE(entry.size, 0);
        metadata.writeDoubleLE(entry.mtimeMs, 8);
        chunks.push(metadata);
    }
    for (const [postId, likeCount, dislikeCount] of snapshot.counts) {
        chunks.push(encodeSnapshotString(postId));
        const counts = Buffer.alloc(8);
        counts.writeUInt32LE(likeCount, 0);
        counts.writeUInt32LE(dislikeCount, 4);
        chunks.push(counts);
    }
    return Buffer.concat(chunks);
}
function decodeReactionSnapshot(buffer) {
    if (buffer.length < 16 || buffer.readUInt32LE(0) !== 0x4d435052 || buffer.readUInt32LE(4) !== REACTION_SNAPSHOT_VERSION) {
        throw new Error('unsupported reaction snapshot');
    }
    const entryCount = buffer.readUInt32LE(8);
    const countCount = buffer.readUInt32LE(12);
    if (entryCount > MAX_REACTION_SNAPSHOT_ENTRIES || countCount > MAX_REACTION_SNAPSHOT_ENTRIES)
        throw new Error('reaction snapshot is too large');
    const entries = [];
    let offset = 16;
    for (let index = 0; index < entryCount; index += 1) {
        const path = decodeSnapshotString(buffer, offset);
        offset = path.offset;
        if (offset + 16 > buffer.length)
            throw new Error('invalid reaction snapshot');
        entries.push({ path: path.value, size: buffer.readDoubleLE(offset), mtimeMs: buffer.readDoubleLE(offset + 8) });
        offset += 16;
    }
    const counts = [];
    for (let index = 0; index < countCount; index += 1) {
        const postId = decodeSnapshotString(buffer, offset);
        offset = postId.offset;
        if (offset + 8 > buffer.length)
            throw new Error('invalid reaction snapshot');
        counts.push([postId.value, buffer.readUInt32LE(offset), buffer.readUInt32LE(offset + 4)]);
        offset += 8;
    }
    return { entries, counts };
}
export class CommunityFeaturesService {
    fileSystem;
    access;
    auth;
    reputation;
    vaultPath;
    notifications;
    reactionCacheOwner = createDerivedCacheOwner('community.reactions');
    reactionAggregateCache;
    reactionAggregateInFlight;
    reactionAggregateGeneration = 0;
    reactionRecords = new Map();
    reactionIndexReady = false;
    reactionIndexUpdate = Promise.resolve();
    reactionSnapshotWrite;
    constructor(fileSystem, access, auth, reputation, vaultPath, notifications) {
        this.fileSystem = fileSystem;
        this.access = access;
        this.auth = auth;
        this.reputation = reputation;
        this.vaultPath = vaultPath;
        this.notifications = notifications;
    }
    async close() {
        if (this.reactionSnapshotWrite)
            await this.reactionSnapshotWrite;
        derivedCacheBudget.clearOwner(this.reactionCacheOwner);
    }
    async assertKnownIdentity(value) {
        const identities = await this.auth.listPrincipals();
        if (!identities.some(principal => identity(principal) === value))
            throw new Error(`Unknown public identity: ${value}`);
    }
    async listSeries(params) {
        const groups = new Map();
        const filters = { mcpvault_type: 'blog_post', status: 'published' };
        if (params.seriesId)
            filters.series_id = normalizeScopeId(params.seriesId, 'seriesId');
        const addPost = (note) => {
            if (isModerationHidden(note.frontmatter))
                return;
            const id = String(note.frontmatter.series_id || '').trim();
            if (!id)
                return;
            const order = Number(note.frontmatter.series_order || 0);
            const chapter = { slug: note.frontmatter.post_id, title: note.frontmatter.title, author: note.frontmatter.author, order, path: note.path, moderationStatus: moderationStatus(note.frontmatter) };
            const current = groups.get(id) || { seriesId: id, title: note.frontmatter.series_title || id, chapters: [] };
            current.chapters.push(chapter);
            groups.set(id, current);
        };
        const snapshot = this.notifications ? await this.notifications.discoverySnapshot() : undefined;
        if (snapshot) {
            const seriesIds = params.seriesId
                ? [String(filters.series_id)]
                : snapshot.seriesOrder.slice(0, positive(params.limit, 50, 100));
            for (const seriesId of seriesIds) {
                for (const note of snapshot.postsBySeriesId.get(seriesId.toLowerCase()) || [])
                    addPost(note);
            }
        }
        else {
            for await (const note of iterateNotes(this.fileSystem, { pathPrefix: POSTS, filters, sortBy: 'created_at', sortOrder: 'asc' }))
                addPost(note);
        }
        const series = Array.from(groups.values()).map(group => ({ ...group, chapters: group.chapters.sort((a, b) => a.order - b.order || String(a.slug).localeCompare(String(b.slug))), count: group.chapters.length }));
        const limited = series.slice(0, positive(params.limit, 50, 100));
        const reputations = await this.reputation.getMany(limited.flatMap(group => group.chapters.map((chapter) => String(chapter.author || ''))));
        for (const group of limited)
            for (const chapter of group.chapters) {
                const authorReputation = reputations.get(String(chapter.author || '').toLowerCase());
                chapter.authorLevel = authorReputation?.level ?? 0;
                chapter.authorLevelLabel = authorReputation?.label ?? '뉴비';
            }
        if (params.includeExcerpts) {
            const excerptLength = Math.min(positive(params.excerptMaxChars, 280, 1000), 1000);
            await Promise.all(limited.flatMap(group => group.chapters.map(async (chapter) => {
                try {
                    const note = await this.fileSystem.readNote(chapter.path);
                    chapter.excerpt = note.content.slice(0, excerptLength);
                }
                catch {
                    chapter.excerpt = '';
                }
            })));
        }
        const bounded = boundItems(limited, positive(params.maxChars, 6000, 20000));
        const total = snapshot ? (params.seriesId ? series.length : snapshot.seriesOrder.length) : series.length;
        return { series: bounded.items, total, truncated: total > limited.length || bounded.truncated };
    }
    async authorActivity(params) {
        const author = normalizeScopeId(params.author, 'author');
        const limit = positive(params.limit, 30, 100);
        const maxChars = positive(params.maxChars, 6000, 20000);
        const snapshot = this.notifications ? await this.notifications.discoverySnapshot() : undefined;
        let postNotes = snapshot?.postsByAuthor.get(author) || [];
        let commentNotes = snapshot?.commentsByAuthor.get(author) || [];
        let postWindow;
        let commentWindow;
        let postCount = postNotes.filter(n => !isModerationHidden(n.frontmatter)).length;
        let commentCount = commentNotes.filter(n => !isModerationHidden(n.frontmatter)).length;
        if (!snapshot) {
            const [loadedPosts, loadedComments, loadedPostCount, loadedCommentCount] = await Promise.all([
                queryWindow(this.fileSystem, { pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', author }, sortBy: 'updated_at', sortOrder: 'desc', limit }, n => !isModerationHidden(n.frontmatter)),
                queryWindow(this.fileSystem, { pathPrefix: COMMENTS, filters: { mcpvault_type: 'blog_comment', author }, sortBy: 'created_at', sortOrder: 'desc', limit }, n => !isModerationHidden(n.frontmatter)),
                this.fileSystem.countNotes({ pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', author } }, undefined, n => !isModerationHidden(n.frontmatter)),
                this.fileSystem.countNotes({ pathPrefix: COMMENTS, filters: { mcpvault_type: 'blog_comment', author } }, undefined, n => !isModerationHidden(n.frontmatter)),
            ]);
            postWindow = loadedPosts;
            commentWindow = loadedComments;
            postNotes = loadedPosts.notes;
            commentNotes = loadedComments.notes;
            postCount = loadedPostCount;
            commentCount = loadedCommentCount;
        }
        const visiblePosts = snapshot ? postNotes.filter(n => !isModerationHidden(n.frontmatter)) : postWindow.notes;
        const visibleComments = snapshot ? commentNotes.filter(n => !isModerationHidden(n.frontmatter)) : commentWindow.notes;
        function* activityCandidates() {
            for (const note of visiblePosts)
                yield { type: 'post', note, id: note.frontmatter.post_id, path: note.path, title: note.frontmatter.title, createdAt: note.frontmatter.created_at, updatedAt: note.frontmatter.updated_at };
            for (const note of visibleComments)
                yield { type: 'comment', note, id: note.frontmatter.comment_id, path: note.path, postId: note.frontmatter.post_id, createdAt: note.frontmatter.created_at, updatedAt: note.frontmatter.updated_at };
        }
        const selected = boundedTopK(activityCandidates(), limit, (a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || a.path.localeCompare(b.path));
        const authorReputations = await this.reputation.getMany(selected.map(item => String(item.note.frontmatter.author || '')));
        const items = selected.map(item => ({ type: item.type, id: item.id, path: item.path, ...(item.title !== undefined && { title: item.title }), ...(item.postId !== undefined && { postId: item.postId }), authorLevel: authorReputations.get(String(item.note.frontmatter.author || '').toLowerCase())?.level ?? 0, authorLevelLabel: authorReputations.get(String(item.note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비', createdAt: item.createdAt, updatedAt: item.updatedAt }));
        const total = postCount + commentCount;
        return { author, items, postCount, commentCount, total, truncated: total > items.length || Boolean(postWindow?.truncated) || Boolean(commentWindow?.truncated), maxChars };
    }
    async targetPath(targetType, targetId, postId) {
        if (targetType === 'post') {
            const path = publicPostPath(targetId);
            const note = await this.fileSystem.readNote(path);
            if (note.frontmatter.mcpvault_type !== 'blog_post')
                throw new Error('target post was not found');
            if (isModerationHidden(note.frontmatter))
                throw new Error('This community item is unavailable because moderation has hidden it');
            return path;
        }
        if (!postId)
            throw new Error('postId is required for a comment target');
        const path = publicCommentPath(postId, targetId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'blog_comment')
            throw new Error('target comment was not found');
        if (isModerationHidden(note.frontmatter))
            throw new Error('This community item is unavailable because moderation has hidden it');
        return path;
    }
    reactionRoot(type, id) { return `${REACTIONS}/${type}/${actorPath(id, 'targetId')}`; }
    invalidateReactionAggregates() {
        this.reactionAggregateGeneration += 1;
        this.reactionAggregateCache = undefined;
        this.reactionIndexReady = false;
        this.reactionRecords.clear();
        derivedCacheBudget.clearOwner(this.reactionCacheOwner);
    }
    trackReactionAggregateCache(value) {
        const counts = [...value.counts.entries()];
        derivedCacheBudget.register(this.reactionCacheOwner, 'current', estimateCacheBytes(counts) + this.reactionRecords.size * 96 + 256, () => this.invalidateReactionAggregates());
    }
    invalidate(path) {
        const normalizedPath = path?.replace(/\\/g, '/');
        if (normalizedPath && !/^Community\/Reactions\//i.test(normalizedPath))
            return;
        if (!normalizedPath || !this.reactionIndexReady) {
            this.invalidateReactionAggregates();
            return;
        }
        this.reactionAggregateGeneration += 1;
        const previous = this.reactionIndexUpdate;
        const update = previous.then(() => this.refreshReactionRecord(normalizedPath)).catch(() => {
            this.invalidateReactionAggregates();
        });
        this.reactionIndexUpdate = update;
        void update.finally(() => {
            if (this.reactionIndexUpdate === update)
                this.reactionIndexUpdate = Promise.resolve();
        });
    }
    adjustReactionCount(counts, record, delta) {
        const current = counts.get(record.targetId) || { likeCount: 0, dislikeCount: 0 };
        if (record.reaction === 'like')
            current.likeCount = Math.max(0, current.likeCount + delta);
        else
            current.dislikeCount = Math.max(0, current.dislikeCount + delta);
        if (current.likeCount === 0 && current.dislikeCount === 0)
            counts.delete(record.targetId);
        else
            counts.set(record.targetId, current);
    }
    async refreshReactionRecord(path) {
        const previous = this.reactionRecords.get(path);
        const nextNote = await this.fileSystem.readNote(path).catch((error) => {
            if (error?.code === 'ENOENT')
                return undefined;
            throw error;
        });
        const nextFrontmatter = nextNote?.frontmatter;
        const nextReaction = nextFrontmatter?.mcpvault_type === 'reaction'
            && nextFrontmatter.target_type === 'post'
            && nextFrontmatter.active === true
            && (nextFrontmatter.reaction === 'like' || nextFrontmatter.reaction === 'dislike')
            && String(nextFrontmatter.target_id || '').trim().toLowerCase();
        const next = nextReaction ? { targetId: String(nextFrontmatter.target_id).trim().toLowerCase(), reaction: nextFrontmatter.reaction } : undefined;
        const cache = this.reactionAggregateCache;
        if (previous && cache)
            this.adjustReactionCount(cache.counts, previous, -1);
        if (next && cache)
            this.adjustReactionCount(cache.counts, next, 1);
        if (next)
            this.reactionRecords.set(path, next);
        else
            this.reactionRecords.delete(path);
        if (cache)
            this.reactionAggregateCache = { ...cache, expiresAt: Date.now() + REACTION_CACHE_TTL_MS };
    }
    async reactionFiles() {
        const root = join(this.vaultPath, REACTIONS, 'post');
        const entries = [];
        try {
            const targets = await readdir(root, { withFileTypes: true });
            for (const target of targets) {
                if (!target.isDirectory())
                    continue;
                const targetPath = join(root, target.name);
                const actors = await readdir(targetPath, { withFileTypes: true });
                for (const actor of actors) {
                    if (!actor.isFile() || !/\.md$/i.test(actor.name))
                        continue;
                    const relativePath = `${REACTIONS}/post/${target.name}/${actor.name}`.replace(/\\/g, '/');
                    try {
                        const info = await stat(join(targetPath, actor.name));
                        if (!info.isFile())
                            continue;
                        entries.push({ path: relativePath, size: info.size, mtimeMs: info.mtimeMs });
                    }
                    catch {
                        return undefined;
                    }
                    if (entries.length > MAX_REACTION_SNAPSHOT_ENTRIES)
                        return undefined;
                }
            }
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return [];
            return undefined;
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        return entries;
    }
    async loadReactionSnapshot() {
        try {
            const snapshot = decodeReactionSnapshot(await readFile(join(this.vaultPath, REACTION_SNAPSHOT_FILE)));
            const currentEntries = await this.reactionFiles();
            if (!currentEntries || currentEntries.length !== snapshot.entries.length)
                return undefined;
            for (let index = 0; index < currentEntries.length; index += 1) {
                const current = currentEntries[index];
                const saved = snapshot.entries[index];
                if (current.path !== saved.path || current.size !== saved.size || current.mtimeMs !== saved.mtimeMs)
                    return undefined;
            }
            const counts = new Map();
            for (const [postId, likeCount, dislikeCount] of snapshot.counts)
                counts.set(postId, { likeCount, dislikeCount });
            return { counts, incomplete: false };
        }
        catch {
            return undefined;
        }
    }
    async saveReactionSnapshot(counts) {
        const entries = await this.reactionFiles();
        if (!entries)
            return;
        const snapshot = {
            entries,
            counts: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([postId, value]) => [postId, value.likeCount, value.dislikeCount]),
        };
        const path = join(this.vaultPath, REACTION_SNAPSHOT_FILE);
        const temporaryPath = `${path}.${process.pid}.tmp`;
        try {
            await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
            await writeFile(temporaryPath, encodeReactionSnapshot(snapshot));
            await rename(temporaryPath, path);
        }
        catch {
            // Derived acceleration state is optional; Markdown and Git remain authoritative.
        }
    }
    queueReactionSnapshotSave(counts) {
        const previous = this.reactionSnapshotWrite || Promise.resolve();
        const write = previous.then(() => this.saveReactionSnapshot(counts)).catch(() => undefined);
        this.reactionSnapshotWrite = write;
        void write.finally(() => {
            if (this.reactionSnapshotWrite === write)
                this.reactionSnapshotWrite = undefined;
        });
    }
    async postReactionAggregates() {
        await this.reactionIndexUpdate;
        const cached = this.reactionAggregateCache;
        if (cached && cached.expiresAt > Date.now()) {
            derivedCacheBudget.touch(this.reactionCacheOwner, 'current');
            return cached;
        }
        if (cached)
            derivedCacheBudget.remove(this.reactionCacheOwner, 'current');
        if (this.reactionAggregateInFlight)
            return this.reactionAggregateInFlight;
        const generation = this.reactionAggregateGeneration;
        const computation = (async () => {
            if (generation === 0) {
                const snapshot = await this.loadReactionSnapshot();
                if (snapshot)
                    return snapshot;
            }
            const counts = new Map();
            const records = new Map();
            let after;
            let incomplete = false;
            while (true) {
                const page = await this.fileSystem.queryNotes({
                    pathPrefix: REACTIONS,
                    filters: { mcpvault_type: 'reaction', active: true, target_type: 'post' },
                    limit: MAX_SCAN,
                    includeTotal: false,
                    ...(after ? { after } : {}),
                });
                for (const reaction of page.notes) {
                    const postId = String(reaction.frontmatter.target_id || '').toLowerCase();
                    if (!postId)
                        continue;
                    if (reaction.frontmatter.reaction !== 'like' && reaction.frontmatter.reaction !== 'dislike')
                        continue;
                    records.set(reaction.path, { targetId: postId, reaction: reaction.frontmatter.reaction });
                    const current = counts.get(postId) || { likeCount: 0, dislikeCount: 0 };
                    if (reaction.frontmatter.reaction === 'like')
                        current.likeCount += 1;
                    else if (reaction.frontmatter.reaction === 'dislike')
                        current.dislikeCount += 1;
                    counts.set(postId, current);
                }
                if (!page.truncated || page.notes.length === 0 || !page.nextCursor) {
                    incomplete = page.truncated && !page.nextCursor;
                    break;
                }
                after = page.nextCursor;
            }
            if (this.reactionAggregateGeneration === generation) {
                this.reactionRecords.clear();
                for (const [path, record] of records)
                    this.reactionRecords.set(path, record);
                this.reactionIndexReady = true;
            }
            this.queueReactionSnapshotSave(counts);
            return { counts, incomplete };
        })();
        this.reactionAggregateInFlight = computation;
        try {
            const value = await computation;
            if (this.reactionAggregateGeneration === generation) {
                this.reactionAggregateCache = { expiresAt: Date.now() + REACTION_CACHE_TTL_MS, ...value };
                this.trackReactionAggregateCache(value);
            }
            return value;
        }
        finally {
            if (this.reactionAggregateInFlight === computation)
                this.reactionAggregateInFlight = undefined;
        }
    }
    async toggleReaction(params) {
        if (!params.principal)
            throw new Error('Login is required to react');
        const reaction = normalizeScopeId(params.reaction || 'like', 'reaction');
        if (reaction !== 'like' && reaction !== 'dislike')
            throw new Error("reaction must be 'like' or 'dislike'");
        await this.targetPath(params.targetType, params.targetId, params.postId);
        const actor = actorPath(identity(params.principal), 'actor');
        const path = `${this.reactionRoot(params.targetType, params.targetId)}/${actor}.md`;
        const exists = await this.fileSystem.noteExists(path);
        if (params.active === false && exists) {
            const old = await this.fileSystem.readNote(path);
            await this.fileSystem.writeNote({ path, content: '[removed]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
        }
        else if (params.active !== false) {
            const old = exists ? await this.fileSystem.readNote(path) : undefined;
            await this.fileSystem.writeNote({ path, content: `${reaction}\n`, frontmatter: { mcpvault_type: 'reaction', reaction, target_type: params.targetType, target_id: params.targetId, ...(params.targetType === 'comment' && params.postId && { post_id: normalizeScopeId(params.postId, 'postId') }), actor: identity(params.principal), actor_role: params.principal.role, active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
        }
        if (params.targetType === 'post')
            this.invalidate(path);
        return { success: true, active: params.active !== false, reaction, targetType: params.targetType, targetId: params.targetId, actor: identity(params.principal) };
    }
    async listReactions(params) {
        await this.targetPath(params.targetType, params.targetId, params.postId);
        const limit = positive(params.limit, 100, 500);
        const filters = { mcpvault_type: 'reaction', active: true };
        const [window, aggregate] = await Promise.all([
            queryWindow(this.fileSystem, { pathPrefix: this.reactionRoot(params.targetType, params.targetId), filters, sortBy: 'created_at', sortOrder: 'desc', limit }),
            params.targetType === 'post' ? this.postReactionAggregates() : Promise.resolve(undefined),
        ]);
        const aggregateCounts = aggregate && !aggregate.incomplete ? (aggregate.counts.get(normalizeScopeId(params.targetId, 'targetId').toLowerCase()) || { likeCount: 0, dislikeCount: 0 }) : undefined;
        const [total, likeCount, dislikeCount] = aggregateCounts
            ? [aggregateCounts.likeCount + aggregateCounts.dislikeCount, aggregateCounts.likeCount, aggregateCounts.dislikeCount]
            : await Promise.all([
                this.fileSystem.countNotes({ pathPrefix: this.reactionRoot(params.targetType, params.targetId), filters }),
                this.fileSystem.countNotes({ pathPrefix: this.reactionRoot(params.targetType, params.targetId), filters: { ...filters, reaction: 'like' } }),
                this.fileSystem.countNotes({ pathPrefix: this.reactionRoot(params.targetType, params.targetId), filters: { ...filters, reaction: 'dislike' } }),
            ]);
        const reactions = window.notes.map(n => ({ actor: n.frontmatter.actor, reaction: n.frontmatter.reaction, createdAt: n.frontmatter.created_at }));
        const bounded = boundItems(reactions, positive(params.maxChars, 6000, 20000));
        return { targetType: params.targetType, targetId: params.targetId, counts: { like: likeCount, dislike: dislikeCount }, reactions: bounded.items, total, truncated: window.truncated || total > reactions.length || bounded.truncated };
    }
    async listPopularPosts(params) {
        const snapshot = this.notifications ? await this.notifications.discoverySnapshot() : undefined;
        const result = snapshot ? undefined : await queryAllNotes(this.fileSystem, { pathPrefix: POSTS, filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'updated_at', sortOrder: 'desc' });
        const sourceNotes = snapshot?.posts || result.notes;
        const reactionAggregates = await this.postReactionAggregates();
        const reactionCounts = reactionAggregates.counts;
        const limit = positive(params.limit, 50, 500);
        let visibleCount = 0;
        function* visiblePosts() {
            for (const note of sourceNotes) {
                if (isModerationHidden(note.frontmatter))
                    continue;
                if (params.category && String(note.frontmatter.category || 'discussion').toLowerCase() !== String(params.category).toLowerCase())
                    continue;
                visibleCount += 1;
                const postId = String(note.frontmatter.post_id || '').toLowerCase();
                const counts = reactionCounts.get(postId) || { likeCount: 0, dislikeCount: 0 };
                yield { note, likeCount: counts.likeCount, dislikeCount: counts.dislikeCount };
            }
        }
        const selected = boundedTopK(visiblePosts(), limit, (a, b) => b.likeCount - a.likeCount || String(b.note.frontmatter.updated_at || '').localeCompare(String(a.note.frontmatter.updated_at || '')) || a.note.path.localeCompare(b.note.path));
        const reputations = await this.reputation.getMany(selected.map(item => String(item.note.frontmatter.author || '')));
        const posts = selected.map(item => {
            const note = item.note;
            const authorReputation = reputations.get(String(note.frontmatter.author || '').toLowerCase());
            return { path: note.path, slug: note.frontmatter.post_id, title: note.frontmatter.title, author: note.frontmatter.author, authorLevel: authorReputation?.level ?? 0, authorLevelLabel: authorReputation?.label ?? '뉴비', category: note.frontmatter.category || 'discussion', tags: note.frontmatter.tags || [], likeCount: item.likeCount, dislikeCount: item.dislikeCount, moderationStatus: moderationStatus(note.frontmatter), createdAt: note.frontmatter.created_at, updatedAt: note.frontmatter.updated_at };
        });
        const bounded = boundItems(posts, positive(params.maxChars, 6000, 20000));
        return { posts: bounded.items, total: visibleCount, truncated: Boolean(result?.truncated) || reactionAggregates.incomplete || visibleCount > limit || bounded.truncated };
    }
    async acceptComment(params) {
        if (!params.principal)
            throw new Error('Login is required');
        const postPath = publicPostPath(params.slug);
        const post = await this.fileSystem.readNote(postPath);
        if (post.frontmatter.author !== identity(params.principal))
            throw new Error('Only the post author can accept an answer');
        const commentPath = publicCommentPath(params.slug, params.commentId);
        const comment = await this.fileSystem.readNote(commentPath);
        if (comment.frontmatter.mcpvault_type !== 'blog_comment' || comment.frontmatter.post_id !== normalizeScopeId(params.slug, 'slug') || comment.frontmatter.content_status === 'deleted')
            throw new Error('comment was not found');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the post first');
        const accepted = params.accepted !== false;
        const fm = { ...post.frontmatter };
        if (accepted)
            Object.assign(fm, { accepted_comment_id: comment.frontmatter.comment_id, accepted_by: identity(params.principal), accepted_at: now() });
        else {
            delete fm.accepted_comment_id;
            delete fm.accepted_by;
            delete fm.accepted_at;
        }
        await this.fileSystem.writeNote({ path: postPath, content: post.content, frontmatter: fm, expectedRevision: params.expectedRevision });
        return { success: true, accepted, slug: params.slug, commentId: params.commentId, revision: (await this.fileSystem.readNote(postPath)).revision };
    }
    async guestbook(params) {
        const owner = normalizeScopeId(params.owner, 'owner');
        await this.assertKnownIdentity(owner);
        const pathRoot = `${GUESTBOOKS}/${owner}`;
        if (params.deleteEntry) {
            if (!params.principal)
                throw new Error('Login is required');
            const path = `${pathRoot}/${normalizeScopeId(params.entryId || '', 'entryId')}.md`;
            const note = await this.fileSystem.readNote(path);
            if (note.frontmatter.author !== identity(params.principal) && owner !== identity(params.principal))
                throw new Error('Only the entry author or guestbook owner can delete an entry');
            await this.fileSystem.writeNote({ path, content: '[deleted]\n', frontmatter: { ...note.frontmatter, content_status: 'deleted', updated_at: now() }, expectedRevision: params.expectedRevision || note.revision });
            return { success: true, deleted: true, entryId: params.entryId };
        }
        if (params.content !== undefined) {
            if (!params.principal)
                throw new Error('Login is required to write a guestbook entry');
            const content = shortText(params.content);
            const entryId = params.entryId ? normalizeScopeId(params.entryId, 'entryId') : `entry-${randomUUID().slice(0, 10)}`;
            const path = `${pathRoot}/${entryId}.md`;
            if (params.replyTo)
                await this.fileSystem.readNote(`${pathRoot}/${normalizeScopeId(params.replyTo, 'replyTo')}.md`);
            await this.fileSystem.writeNote({ path, content: `${content}\n`, frontmatter: { mcpvault_type: 'guestbook_entry', guestbook_owner: owner, entry_id: entryId, author: identity(params.principal), author_role: params.principal.role, mentions: extractMentions(content), ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }), content_status: 'published', created_at: now(), updated_at: now() }, expectedRevision: 'missing' });
            return { success: true, entryId, owner, path };
        }
        const result = await queryAllNotes(this.fileSystem, { pathPrefix: pathRoot, filters: { mcpvault_type: 'guestbook_entry', content_status: 'published' }, sortBy: 'created_at', sortOrder: 'asc' });
        const limit = positive(params.limit, 20, 100);
        const cursor = params.afterEntryId ? result.notes.findIndex(n => n.frontmatter.entry_id === normalizeScopeId(params.afterEntryId, 'afterEntryId')) : -1;
        if (params.afterEntryId && cursor < 0)
            throw new Error('afterEntryId was not found');
        const selected = result.notes.slice(cursor >= 0 ? cursor + 1 : Math.max(0, result.notes.length - limit), cursor >= 0 ? cursor + 1 + limit : undefined);
        const hydrated = await Promise.all(selected.map(async (n) => {
            try {
                const note = await this.fileSystem.readNote(n.path);
                return { path: n.path, entryId: n.frontmatter.entry_id, author: n.frontmatter.author, replyTo: n.frontmatter.reply_to, createdAt: n.frontmatter.created_at, content: note.content };
            }
            catch {
                return undefined;
            }
        }));
        const bounded = boundItems(hydrated.filter((entry) => entry !== undefined), positive(params.maxChars, 6000, 20000));
        return { owner, entries: bounded.items, total: result.total, truncated: result.truncated || selected.length < result.total || bounded.truncated, nextCursor: bounded.items.at(-1)?.entryId };
    }
    ownerRoot(principal, kind) {
        const scope = principal.agentId ? `agents/${normalizeScopeId(principal.agentId, 'agentId')}` : `models/${normalizeScopeId(principal.modelId, 'modelId')}`;
        return `_scopes/${scope}/_${kind}`;
    }
    async watch(params) {
        if (!params.principal)
            throw new Error('Login is required to manage watches');
        const targetId = params.targetType === 'tag' ? String(params.targetId).trim().toLowerCase() : normalizeScopeId(params.targetId, 'targetId');
        if (!targetId)
            throw new Error('targetId is required');
        if (params.targetType === 'post')
            await this.fileSystem.readNote(publicPostPath(targetId));
        const path = `${this.ownerRoot(params.principal, 'subscriptions')}/${params.targetType}-${stableKey(targetId)}.md`;
        const active = params.active !== false;
        if (!active && await this.fileSystem.noteExists(path)) {
            const old = await this.fileSystem.readNote(path);
            await this.fileSystem.writeNote({ path, content: '[unwatched]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
        }
        else if (active) {
            const exists = await this.fileSystem.noteExists(path);
            const old = exists ? await this.fileSystem.readNote(path) : undefined;
            await this.fileSystem.writeNote({ path, content: `${params.targetType}:${targetId}\n`, frontmatter: { mcpvault_type: 'subscription', target_type: params.targetType, target_id: targetId, owner: identity(params.principal), active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
        }
        return { success: true, active, targetType: params.targetType, targetId };
    }
    async listWatches(principal, maxChars) {
        if (!principal)
            throw new Error('Login is required');
        const result = await queryAllNotes(this.fileSystem, { pathPrefix: this.ownerRoot(principal, 'subscriptions'), filters: { mcpvault_type: 'subscription', active: true }, sortBy: 'updated_at', sortOrder: 'desc' });
        const bounded = boundItems(result.notes.map(n => ({ targetType: n.frontmatter.target_type, targetId: n.frontmatter.target_id, updatedAt: n.frontmatter.updated_at })), positive(maxChars, 6000, 20000));
        return { watches: bounded.items, total: result.total, truncated: result.truncated || bounded.truncated };
    }
    async save(params) {
        if (!params.principal)
            throw new Error('Login is required to manage saves');
        const target = this.access.resolveExternalPath(params.targetPath, params.principal);
        if (!await this.fileSystem.noteExists(target))
            throw new Error(`Saved target was not found: ${target}`);
        const key = stableKey(target);
        const path = `${this.ownerRoot(params.principal, 'saves')}/${key}.md`;
        const active = params.active !== false;
        const old = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
        if (!active && old) {
            await this.fileSystem.writeNote({ path, content: '[unsaved]\n', frontmatter: { ...old.frontmatter, active: false, updated_at: now() }, expectedRevision: old.revision });
        }
        else if (active) {
            const privateNote = params.note === undefined ? String(old?.frontmatter.note || '') : shortText(params.note, 'note', 500);
            await this.fileSystem.writeNote({ path, content: `${target}\n`, frontmatter: { mcpvault_type: 'saved_item', target_path: target, owner: identity(params.principal), note: privateNote, active: true, ...(old ? { created_at: old.frontmatter.created_at } : { created_at: now() }), updated_at: now() }, expectedRevision: old?.revision || 'missing' });
        }
        return { success: true, active, targetPath: target };
    }
    async listSaves(principal, maxChars) {
        if (!principal)
            throw new Error('Login is required');
        const result = await queryAllNotes(this.fileSystem, { pathPrefix: this.ownerRoot(principal, 'saves'), filters: { mcpvault_type: 'saved_item', active: true }, sortBy: 'updated_at', sortOrder: 'desc' });
        const bounded = boundItems(result.notes.map(n => ({ targetPath: n.frontmatter.target_path, note: n.frontmatter.note, savedAt: n.frontmatter.created_at, updatedAt: n.frontmatter.updated_at })), positive(maxChars, 6000, 20000));
        return { saves: bounded.items, total: result.total, truncated: result.truncated || bounded.truncated };
    }
}
export { CATEGORIES };
