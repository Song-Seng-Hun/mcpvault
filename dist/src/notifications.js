import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { normalizeScopeId } from './scopes.js';
import { iterateNotes, queryAllNotes } from './paged-query.js';
import { isClosedWorkflowStatus } from './community-status.js';
import { isModerationHidden } from './moderation-policy.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const READ_STATE_ROOT = '_notifications';
const EVENT_CACHE_TTL_MS = 2_000;
const EVENT_CACHE_MAX_ENTRIES = 64;
const HYDRATE_BATCH_SIZE = 32;
const PUBLIC_SNAPSHOT_FILE = '.mcpvault/public-discovery.snapshot.bin';
const PUBLIC_SNAPSHOT_MAGIC = Buffer.from('MCPVPUB1', 'ascii');
const PUBLIC_SNAPSHOT_VERSION = 1;
const PUBLIC_SNAPSHOT_MAX_ENTRIES = 200_000;
const PUBLIC_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;
function identity(principal) {
    return principal.agentId || principal.modelId;
}
function readStatePath(principal) {
    const owner = principal.agentId
        ? `agents/${normalizeScopeId(principal.agentId, 'agentId')}`
        : `models/${normalizeScopeId(principal.modelId, 'modelId')}`;
    return `_scopes/${owner}/${READ_STATE_ROOT}/read-state.md`;
}
function limitNumber(value, fallback, maximum) {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('limit must be a positive integer');
    return Math.min(parsed, maximum);
}
function maxChars(value) {
    return limitNumber(value, 6000, 20000);
}
function eventId(kind, path, sourceId) {
    return `${kind}:${sourceId || path}`;
}
function text(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function encodeSnapshotString(value) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([length, bytes]);
}
function decodeSnapshotString(buffer, offset) {
    if (offset + 4 > buffer.length)
        throw new Error('invalid public discovery snapshot');
    const length = buffer.readUInt32LE(offset);
    const start = offset + 4;
    const end = start + length;
    if (end > buffer.length)
        throw new Error('invalid public discovery snapshot');
    return { value: buffer.subarray(start, end).toString('utf8'), offset: end };
}
const COLLECTION_CODES = { posts: 0, comments: 1, messages: 2, rooms: 3 };
const CODE_COLLECTIONS = ['posts', 'comments', 'messages', 'rooms'];
function encodePublicSnapshot(snapshot) {
    const chunks = [PUBLIC_SNAPSHOT_MAGIC];
    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(PUBLIC_SNAPSHOT_VERSION, 0);
    header.writeUInt32LE(snapshot.manifest.length, 4);
    header.writeUInt32LE(snapshot.notes.length, 8);
    chunks.push(header);
    for (const entry of snapshot.manifest) {
        chunks.push(encodeSnapshotString(entry.path));
        const metadata = Buffer.allocUnsafe(16);
        metadata.writeDoubleLE(entry.size, 0);
        metadata.writeDoubleLE(entry.mtimeMs, 8);
        chunks.push(metadata);
    }
    for (const note of snapshot.notes) {
        chunks.push(Buffer.from([COLLECTION_CODES[note.collection]]));
        chunks.push(encodeSnapshotString(note.path));
        chunks.push(encodeSnapshotString(JSON.stringify(note.frontmatter)));
    }
    return Buffer.concat(chunks);
}
function decodePublicSnapshot(buffer) {
    if (buffer.length < PUBLIC_SNAPSHOT_MAGIC.length + 12 || !buffer.subarray(0, PUBLIC_SNAPSHOT_MAGIC.length).equals(PUBLIC_SNAPSHOT_MAGIC)) {
        throw new Error('unsupported public discovery snapshot');
    }
    let offset = PUBLIC_SNAPSHOT_MAGIC.length;
    const version = buffer.readUInt32LE(offset);
    const manifestCount = buffer.readUInt32LE(offset + 4);
    const noteCount = buffer.readUInt32LE(offset + 8);
    offset += 12;
    if (version !== PUBLIC_SNAPSHOT_VERSION || manifestCount > PUBLIC_SNAPSHOT_MAX_ENTRIES || noteCount > PUBLIC_SNAPSHOT_MAX_ENTRIES) {
        throw new Error('unsupported public discovery snapshot');
    }
    const manifest = [];
    for (let index = 0; index < manifestCount; index += 1) {
        const path = decodeSnapshotString(buffer, offset);
        offset = path.offset;
        if (offset + 16 > buffer.length)
            throw new Error('invalid public discovery snapshot');
        manifest.push({ path: path.value, size: buffer.readDoubleLE(offset), mtimeMs: buffer.readDoubleLE(offset + 8) });
        offset += 16;
    }
    const notes = [];
    for (let index = 0; index < noteCount; index += 1) {
        if (offset + 1 > buffer.length)
            throw new Error('invalid public discovery snapshot');
        const collection = CODE_COLLECTIONS[buffer[offset]];
        if (!collection)
            throw new Error('invalid public discovery snapshot collection');
        offset += 1;
        const path = decodeSnapshotString(buffer, offset);
        offset = path.offset;
        const rawFrontmatter = decodeSnapshotString(buffer, offset);
        offset = rawFrontmatter.offset;
        const parsed = JSON.parse(rawFrontmatter.value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('invalid public discovery snapshot frontmatter');
        notes.push({ collection, path: path.value, frontmatter: parsed });
    }
    return { manifest, notes };
}
function addToIndex(index, key, note) {
    const normalized = text(key).toLowerCase();
    if (!normalized)
        return;
    const existing = index.get(normalized);
    if (existing)
        existing.push(note);
    else
        index.set(normalized, [note]);
}
function addMentions(index, note) {
    if (!Array.isArray(note.frontmatter.mentions))
        return;
    for (const mention of note.frontmatter.mentions)
        addToIndex(index, mention, note);
}
function normalizePath(path) {
    return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function publicCollectionForPath(path) {
    const normalized = normalizePath(path);
    if (normalized.startsWith('Community/Posts/'))
        return 'posts';
    if (normalized.startsWith('Community/Comments/'))
        return 'comments';
    if (normalized.startsWith('Community/ChatMessages/'))
        return 'messages';
    if (normalized.startsWith('Community/ChatRooms/'))
        return 'rooms';
    return undefined;
}
function isPublicRootNotePath(path) {
    const normalized = normalizePath(path);
    return normalized.startsWith('Community/Posts/')
        || normalized.startsWith('Community/Comments/')
        || normalized.startsWith('Community/ChatMessages/')
        || normalized.startsWith('Community/ChatRooms/');
}
function belongsInPublicCollection(note, collection) {
    const type = text(note.frontmatter.mcpvault_type).toLowerCase();
    if (collection === 'posts')
        return type === 'blog_post' && text(note.frontmatter.status).toLowerCase() === 'published';
    if (collection === 'comments')
        return type === 'blog_comment';
    if (collection === 'messages')
        return type === 'chat_message';
    return type === 'chat_room';
}
const PUBLIC_METADATA_FIELDS = {
    posts: ['mcpvault_type', 'status', 'post_id', 'title', 'author', 'category', 'tags', 'mentions', 'series_id', 'series_title', 'series_order', 'related_posts', 'duplicate_of', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at'],
    comments: ['mcpvault_type', 'post_id', 'comment_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
    messages: ['mcpvault_type', 'room_id', 'message_id', 'author', 'mentions', 'reply_to', 'created_at', 'updated_at', 'workflow_status', 'workflow_status_by', 'workflow_status_reason', 'workflow_status_updated_at', 'moderation_status', 'moderation_reason', 'moderated_by', 'moderated_at', 'content_status'],
    rooms: ['mcpvault_type', 'room_id', 'title', 'creator', 'created_at', 'updated_at', 'archived', 'workflow_status', 'moderation_status'],
};
function compactPublicNote(note, collection) {
    const frontmatter = Object.fromEntries(PUBLIC_METADATA_FIELDS[collection]
        .filter(field => Object.prototype.hasOwnProperty.call(note.frontmatter, field))
        .map(field => [field, note.frontmatter[field]]));
    return { path: note.path, frontmatter };
}
function sortPublicCollection(notes, collection) {
    if (collection === 'rooms')
        return notes.sort((a, b) => a.path.localeCompare(b.path));
    return notes.sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
}
function buildPublicSnapshotIndex(snapshot) {
    const index = {
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
    const seriesFirstSeen = new Map();
    for (const note of snapshot.posts) {
        addToIndex(index.postsByPostId, note.frontmatter.post_id, note);
        addToIndex(index.postsBySeriesId, note.frontmatter.series_id, note);
        addToIndex(index.postsByAuthor, note.frontmatter.author, note);
        const seriesId = text(note.frontmatter.series_id).toLowerCase();
        if (seriesId && !isModerationHidden(note.frontmatter)) {
            const seen = seriesFirstSeen.get(seriesId);
            const candidate = { createdAt: text(note.frontmatter.created_at), path: note.path };
            if (!seen || candidate.createdAt < seen.createdAt || (candidate.createdAt === seen.createdAt && candidate.path < seen.path))
                seriesFirstSeen.set(seriesId, candidate);
        }
        addMentions(index.postsByMention, note);
        if (Array.isArray(note.frontmatter.tags)) {
            for (const tag of note.frontmatter.tags)
                addToIndex(index.postsByTag, tag, note);
        }
        const postId = text(note.frontmatter.post_id);
        if (postId)
            index.postTitles.set(postId, text(note.frontmatter.title, postId));
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
        if (roomId)
            index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
    }
    index.seriesOrder = [...seriesFirstSeen.entries()]
        .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
        .map(([seriesId]) => seriesId);
    index.seriesFirstSeen = seriesFirstSeen;
    return index;
}
function cloneCollectionIndex(index, collection, notes) {
    const next = { ...index, [collection]: notes };
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
function removeIndexedValue(index, key, path) {
    const normalized = text(key).toLowerCase();
    if (!normalized)
        return;
    const bucket = index.get(normalized);
    if (!bucket)
        return;
    const next = bucket.filter(note => note.path !== path);
    if (next.length)
        index.set(normalized, next);
    else
        index.delete(normalized);
}
function addIndexedValue(index, key, note) {
    const normalized = text(key).toLowerCase();
    if (!normalized)
        return;
    const bucket = index.get(normalized);
    if (bucket)
        index.set(normalized, [...bucket, note]);
    else
        index.set(normalized, [note]);
}
function removeIndexedMentions(index, note) {
    if (!Array.isArray(note.frontmatter.mentions))
        return;
    for (const mention of note.frontmatter.mentions)
        removeIndexedValue(index, mention, note.path);
}
function addIndexedMentions(index, note) {
    if (!Array.isArray(note.frontmatter.mentions))
        return;
    for (const mention of note.frontmatter.mentions)
        addIndexedValue(index, mention, note);
}
function removeFromCollectionIndex(index, collection, note) {
    const affectedSeries = new Set();
    if (collection === 'posts') {
        removeIndexedValue(index.postsByPostId, note.frontmatter.post_id, note.path);
        removeIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note.path);
        removeIndexedValue(index.postsByAuthor, note.frontmatter.author, note.path);
        removeIndexedMentions(index.postsByMention, note);
        if (Array.isArray(note.frontmatter.tags))
            for (const tag of note.frontmatter.tags)
                removeIndexedValue(index.postsByTag, tag, note.path);
        const postId = text(note.frontmatter.post_id);
        if (postId)
            index.postTitles.delete(postId);
        const seriesId = text(note.frontmatter.series_id).toLowerCase();
        if (seriesId)
            affectedSeries.add(seriesId);
    }
    else if (collection === 'comments') {
        removeIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note.path);
        removeIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note.path);
        removeIndexedValue(index.commentsByAuthor, note.frontmatter.author, note.path);
        removeIndexedMentions(index.commentsByMention, note);
        removeIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note.path);
    }
    else if (collection === 'messages') {
        removeIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note.path);
        removeIndexedMentions(index.messagesByMention, note);
        removeIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note.path);
    }
    else {
        const roomId = text(note.frontmatter.room_id);
        if (roomId)
            index.roomTitles.delete(roomId);
    }
    return affectedSeries;
}
function addToCollectionIndex(index, collection, note) {
    const affectedSeries = new Set();
    if (collection === 'posts') {
        addIndexedValue(index.postsByPostId, note.frontmatter.post_id, note);
        addIndexedValue(index.postsBySeriesId, note.frontmatter.series_id, note);
        addIndexedValue(index.postsByAuthor, note.frontmatter.author, note);
        addIndexedMentions(index.postsByMention, note);
        if (Array.isArray(note.frontmatter.tags))
            for (const tag of note.frontmatter.tags)
                addIndexedValue(index.postsByTag, tag, note);
        const postId = text(note.frontmatter.post_id);
        if (postId)
            index.postTitles.set(postId, text(note.frontmatter.title, postId));
        const seriesId = text(note.frontmatter.series_id).toLowerCase();
        if (seriesId)
            affectedSeries.add(seriesId);
    }
    else if (collection === 'comments') {
        addIndexedValue(index.commentsByPostId, note.frontmatter.post_id, note);
        addIndexedValue(index.commentsByCommentId, note.frontmatter.comment_id, note);
        addIndexedValue(index.commentsByAuthor, note.frontmatter.author, note);
        addIndexedMentions(index.commentsByMention, note);
        addIndexedValue(index.commentsByReplyTo, note.frontmatter.reply_to, note);
    }
    else if (collection === 'messages') {
        addIndexedValue(index.messagesByMessageId, note.frontmatter.message_id, note);
        addIndexedMentions(index.messagesByMention, note);
        addIndexedValue(index.messagesByReplyTo, note.frontmatter.reply_to, note);
    }
    else {
        const roomId = text(note.frontmatter.room_id);
        if (roomId)
            index.roomTitles.set(roomId, text(note.frontmatter.title, roomId));
    }
    return affectedSeries;
}
function refreshSeriesOrder(index, seriesIds) {
    for (const seriesId of seriesIds) {
        const candidates = (index.postsBySeriesId.get(seriesId) || []).filter(note => !isModerationHidden(note.frontmatter));
        if (!candidates.length) {
            index.seriesFirstSeen.delete(seriesId);
            continue;
        }
        let first = candidates[0];
        for (const candidate of candidates.slice(1)) {
            const candidateCreatedAt = text(candidate.frontmatter.created_at);
            const firstCreatedAt = text(first.frontmatter.created_at);
            if (candidateCreatedAt < firstCreatedAt || (candidateCreatedAt === firstCreatedAt && candidate.path < first.path))
                first = candidate;
        }
        index.seriesFirstSeen.set(seriesId, { createdAt: text(first.frontmatter.created_at), path: first.path });
    }
    index.seriesOrder = [...index.seriesFirstSeen.entries()]
        .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path))
        .map(([seriesId]) => seriesId);
}
function patchPublicSnapshotIndex(index, collection, notes, previous, nextNote) {
    const next = cloneCollectionIndex(index, collection, notes);
    const affectedSeries = new Set();
    if (previous)
        for (const seriesId of removeFromCollectionIndex(next, collection, previous))
            affectedSeries.add(seriesId);
    if (nextNote)
        for (const seriesId of addToCollectionIndex(next, collection, nextNote))
            affectedSeries.add(seriesId);
    if (collection === 'posts')
        refreshSeriesOrder(next, affectedSeries);
    return next;
}
export class NotificationService {
    fileSystem;
    reputation;
    vaultPath;
    fileCatalog;
    candidateCacheOwner = createDerivedCacheOwner('notifications.candidates');
    publicSnapshotCacheOwner = createDerivedCacheOwner('notifications.public-snapshot');
    candidateCache = new Map();
    candidateInFlight = new Map();
    publicSnapshotCache;
    publicSnapshotInFlight;
    publicSnapshotUpdate;
    publicSnapshotWrite;
    publicSnapshotRestoreAttempted = false;
    constructor(fileSystem, reputation, vaultPath, fileCatalog) {
        this.fileSystem = fileSystem;
        this.reputation = reputation;
        this.vaultPath = vaultPath;
        this.fileCatalog = fileCatalog;
    }
    async close() {
        if (this.publicSnapshotUpdate)
            await this.publicSnapshotUpdate;
        if (this.publicSnapshotWrite)
            await this.publicSnapshotWrite;
        this.clearCandidateCache();
        this.clearPublicSnapshotCache();
    }
    async discoverySnapshot() {
        return this.cachedPublicSnapshot();
    }
    /** Return only indexed public items that mention one of the exact identities. */
    async mentionCandidates(targets, includeClosed = false) {
        const snapshot = await this.cachedPublicSnapshot();
        const unique = new Map();
        for (const target of targets) {
            const key = target.toLowerCase();
            for (const note of [...(snapshot.commentsByMention.get(key) || []), ...(snapshot.messagesByMention.get(key) || [])]) {
                if (isModerationHidden(note.frontmatter))
                    continue;
                if (!includeClosed && isClosedWorkflowStatus(note.frontmatter.workflow_status))
                    continue;
                unique.set(note.path, note);
            }
        }
        return [...unique.values()].sort((a, b) => String(b.frontmatter.created_at || '').localeCompare(String(a.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
    }
    async publicManifest() {
        if (!this.vaultPath || !this.fileCatalog)
            return undefined;
        const paths = (await this.fileCatalog.listNotePaths()).filter(isPublicRootNotePath).sort((a, b) => a.localeCompare(b));
        const entries = [];
        for (let start = 0; start < paths.length; start += HYDRATE_BATCH_SIZE) {
            const batch = paths.slice(start, start + HYDRATE_BATCH_SIZE);
            const stats = await Promise.all(batch.map(async (path) => {
                try {
                    const info = await stat(join(this.vaultPath, path));
                    return info.isFile() ? { path, size: info.size, mtimeMs: info.mtimeMs } : undefined;
                }
                catch {
                    return undefined;
                }
            }));
            if (stats.some(entry => !entry))
                return undefined;
            entries.push(...stats);
        }
        return entries;
    }
    async loadPublicSnapshot() {
        if (!this.vaultPath || !this.fileCatalog)
            return undefined;
        try {
            const compressed = await readFile(join(this.vaultPath, PUBLIC_SNAPSHOT_FILE));
            const raw = await gunzipAsync(compressed);
            if (raw.length > PUBLIC_SNAPSHOT_MAX_BYTES)
                return undefined;
            const disk = decodePublicSnapshot(raw);
            const currentManifest = await this.publicManifest();
            if (!currentManifest || currentManifest.length !== disk.manifest.length)
                return undefined;
            for (let index = 0; index < currentManifest.length; index += 1) {
                const current = currentManifest[index];
                const saved = disk.manifest[index];
                if (current.path !== saved.path || current.size !== saved.size || current.mtimeMs !== saved.mtimeMs)
                    return undefined;
            }
            const snapshot = { posts: [], comments: [], messages: [], rooms: [] };
            for (const note of disk.notes)
                snapshot[note.collection].push({ path: normalizePath(note.path), frontmatter: note.frontmatter });
            for (const collection of ['posts', 'comments', 'messages', 'rooms'])
                sortPublicCollection(snapshot[collection], collection);
            return buildPublicSnapshotIndex(snapshot);
        }
        catch {
            return undefined;
        }
    }
    async savePublicSnapshot(value) {
        if (!this.vaultPath || !this.fileCatalog)
            return;
        try {
            const manifest = await this.publicManifest();
            if (!manifest || manifest.length > PUBLIC_SNAPSHOT_MAX_ENTRIES)
                return;
            const notes = [];
            for (const collection of ['posts', 'comments', 'messages', 'rooms']) {
                for (const note of value[collection])
                    notes.push({ collection, path: note.path, frontmatter: note.frontmatter });
            }
            if (notes.length > PUBLIC_SNAPSHOT_MAX_ENTRIES)
                return;
            const compressed = await gzipAsync(encodePublicSnapshot({ manifest, notes }));
            const snapshotPath = join(this.vaultPath, PUBLIC_SNAPSHOT_FILE);
            const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
            await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
            await writeFile(temporaryPath, compressed);
            await rename(temporaryPath, snapshotPath);
        }
        catch {
            // Derived acceleration state is optional; Markdown remains authoritative.
        }
    }
    queuePublicSnapshotSave(value) {
        const previous = this.publicSnapshotWrite || Promise.resolve();
        const write = previous.then(() => this.savePublicSnapshot(value)).catch(() => undefined);
        this.publicSnapshotWrite = write;
        void write.finally(() => {
            if (this.publicSnapshotWrite === write)
                this.publicSnapshotWrite = undefined;
        });
    }
    clearCandidateCache() {
        this.candidateCache.clear();
        this.candidateInFlight.clear();
        derivedCacheBudget.clearOwner(this.candidateCacheOwner);
    }
    clearPublicSnapshotCache() {
        this.publicSnapshotCache = undefined;
        derivedCacheBudget.clearOwner(this.publicSnapshotCacheOwner);
    }
    trackPublicSnapshotCache(value) {
        const bytes = estimateCacheBytes({ posts: value.posts, comments: value.comments, messages: value.messages, rooms: value.rooms }) + 256;
        derivedCacheBudget.register(this.publicSnapshotCacheOwner, 'current', bytes, () => {
            this.publicSnapshotCache = undefined;
        });
    }
    invalidate(path, kind = 'upsert') {
        this.clearCandidateCache();
        const collection = path ? publicCollectionForPath(path) : undefined;
        if (!path || !collection) {
            if (!path)
                this.clearPublicSnapshotCache();
            return;
        }
        const previous = this.publicSnapshotUpdate || Promise.resolve();
        const update = previous.then(() => this.updatePublicSnapshot(path, kind, collection)).catch(() => {
            this.publicSnapshotCache = undefined;
        });
        this.publicSnapshotUpdate = update;
        void update.finally(() => {
            if (this.publicSnapshotUpdate === update)
                this.publicSnapshotUpdate = undefined;
        });
    }
    async cachedPublicSnapshot() {
        while (this.publicSnapshotUpdate)
            await this.publicSnapshotUpdate;
        const cached = this.publicSnapshotCache;
        if (cached && cached.expiresAt > Date.now()) {
            derivedCacheBudget.touch(this.publicSnapshotCacheOwner, 'current');
            return cached.value;
        }
        if (cached)
            this.clearPublicSnapshotCache();
        if (this.publicSnapshotInFlight)
            return this.publicSnapshotInFlight;
        const computation = (async () => {
            if (!this.publicSnapshotRestoreAttempted) {
                this.publicSnapshotRestoreAttempted = true;
                const restored = await this.loadPublicSnapshot();
                if (restored)
                    return restored;
            }
            const snapshot = { posts: [], comments: [], messages: [], rooms: [] };
            for await (const note of iterateNotes(this.fileSystem)) {
                const collection = publicCollectionForPath(note.path);
                if (collection && belongsInPublicCollection(note, collection))
                    snapshot[collection].push(compactPublicNote(note, collection));
            }
            for (const collection of ['posts', 'comments', 'messages', 'rooms'])
                sortPublicCollection(snapshot[collection], collection);
            const value = buildPublicSnapshotIndex(snapshot);
            this.queuePublicSnapshotSave(value);
            return value;
        })();
        this.publicSnapshotInFlight = computation;
        try {
            const value = await computation;
            this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
            this.trackPublicSnapshotCache(value);
            return value;
        }
        finally {
            if (this.publicSnapshotInFlight === computation)
                this.publicSnapshotInFlight = undefined;
        }
    }
    async updatePublicSnapshot(path, kind, collection) {
        if (this.publicSnapshotInFlight)
            await this.publicSnapshotInFlight;
        const cached = this.publicSnapshotCache;
        if (!cached || cached.expiresAt <= Date.now()) {
            this.clearPublicSnapshotCache();
            return;
        }
        const previous = cached.value[collection].find(note => note.path === path);
        const nextCollection = cached.value[collection].filter(note => note.path !== path);
        let nextNote;
        if (kind !== 'delete') {
            const note = await this.fileSystem.readNote(path);
            const metadata = { path: normalizePath(path), frontmatter: compactPublicNote({ path, frontmatter: note.frontmatter }, collection).frontmatter };
            if (belongsInPublicCollection(metadata, collection)) {
                nextNote = metadata;
                nextCollection.push(metadata);
            }
        }
        sortPublicCollection(nextCollection, collection);
        const value = patchPublicSnapshotIndex(cached.value, collection, nextCollection, previous, nextNote);
        this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
        this.trackPublicSnapshotCache(value);
    }
    async hydrateNotes(notes) {
        const unique = [...new Map(notes.map(note => [note.path, note])).values()];
        const hydrated = [];
        for (let start = 0; start < unique.length; start += HYDRATE_BATCH_SIZE) {
            const batch = unique.slice(start, start + HYDRATE_BATCH_SIZE);
            const results = await Promise.all(batch.map(async (note) => {
                try {
                    const parsed = await this.fileSystem.readNote(note.path);
                    return { ...note, frontmatter: parsed.frontmatter, content: parsed.content };
                }
                catch {
                    return undefined;
                }
            }));
            hydrated.push(...results.filter((note) => note !== undefined));
        }
        return hydrated;
    }
    async cachedPublicCandidates(principal) {
        const key = JSON.stringify({ accountId: principal.accountId, modelId: principal.modelId, agentId: principal.agentId, role: principal.role });
        const cached = this.candidateCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            derivedCacheBudget.touch(this.candidateCacheOwner, key);
            return cached.candidates.map(candidate => ({ ...candidate }));
        }
        if (cached) {
            this.candidateCache.delete(key);
            derivedCacheBudget.remove(this.candidateCacheOwner, key);
        }
        const running = this.candidateInFlight.get(key);
        if (running)
            return (await running).map(candidate => ({ ...candidate }));
        const computation = this.publicCandidates(principal);
        this.candidateInFlight.set(key, computation);
        try {
            const candidates = await computation;
            const cachedCandidates = candidates.map(candidate => ({ ...candidate }));
            this.candidateCache.set(key, { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, candidates: cachedCandidates });
            derivedCacheBudget.register(this.candidateCacheOwner, key, estimateCacheBytes(cachedCandidates) + Buffer.byteLength(key, 'utf8') + 128, () => this.candidateCache.delete(key));
            while (this.candidateCache.size > EVENT_CACHE_MAX_ENTRIES) {
                const oldest = this.candidateCache.keys().next();
                if (oldest.done)
                    break;
                this.candidateCache.delete(oldest.value);
                derivedCacheBudget.remove(this.candidateCacheOwner, oldest.value);
            }
            return candidates;
        }
        finally {
            if (this.candidateInFlight.get(key) === computation)
                this.candidateInFlight.delete(key);
        }
    }
    async lastReadAt(principal) {
        const path = readStatePath(principal);
        if (!await this.fileSystem.noteExists(path))
            return {};
        const note = await this.fileSystem.readNote(path);
        return { value: text(note.frontmatter.last_read_at), revision: note.revision };
    }
    async publicCandidates(principal) {
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
        const watchedPostIds = new Set();
        const watchedSeriesIds = new Set();
        const watchedAuthors = new Set();
        const watchedTags = new Set();
        for (const subscription of subscriptions.notes) {
            const type = text(subscription.frontmatter.target_type).toLowerCase();
            const value = text(subscription.frontmatter.target_id).toLowerCase();
            if (!value)
                continue;
            if (type === 'post')
                watchedPostIds.add(value);
            else if (type === 'series')
                watchedSeriesIds.add(value);
            else if (type === 'author')
                watchedAuthors.add(value);
            else if (type === 'tag')
                watchedTags.add(value);
        }
        const uniqueNotes = (notesToAdd) => {
            const unique = new Map();
            for (const notes of notesToAdd)
                for (const note of notes)
                    unique.set(note.path, note);
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
        const candidates = [];
        const candidateIds = new Set();
        const parentPathFor = (note, replyTo) => {
            if (!replyTo)
                return undefined;
            const type = text(note.frontmatter.mcpvault_type);
            return type === 'blog_comment'
                ? commentsByCommentId.get(replyTo.toLowerCase())?.[0]?.path
                : type === 'chat_message'
                    ? messagesByMessageId.get(replyTo.toLowerCase())?.[0]?.path
                    : undefined;
        };
        const addCandidate = (note, kind, sourceId) => {
            const author = text(note.frontmatter.author);
            if (!author || author === target)
                return;
            const mentions = Array.isArray(note.frontmatter.mentions) ? note.frontmatter.mentions.map(String).map(value => value.toLowerCase()) : [];
            const isMention = mentions.includes(target.toLowerCase());
            const replyTo = text(note.frontmatter.reply_to);
            const isReply = (note.frontmatter.mcpvault_type === 'blog_comment' && ownedCommentIds.has(replyTo))
                || (note.frontmatter.mcpvault_type === 'chat_message' && ownedMessageIds.has(replyTo));
            const postId = text(note.frontmatter.post_id);
            const roomId = text(note.frontmatter.room_id);
            const activity = note.frontmatter.mcpvault_type === 'blog_comment' && ownedPostIds.has(postId);
            if (!isMention && !isReply && !activity)
                return;
            const selectedKind = isMention ? 'mention' : isReply ? 'reply' : kind;
            const type = text(note.frontmatter.mcpvault_type);
            const contextPrefix = type === 'blog_comment'
                ? `post: ${postTitles.get(postId) || postId}`
                : `room: ${roomTitles.get(roomId) || roomId}`;
            const notificationId = eventId(selectedKind, note.path, sourceId);
            if (candidateIds.has(notificationId))
                return;
            candidateIds.add(notificationId);
            const parentPath = parentPathFor(note, replyTo);
            candidates.push({
                notificationId,
                kind: selectedKind,
                sourcePath: note.path,
                sourceType: type,
                sourceId,
                author,
                createdAt: text(note.frontmatter.created_at),
                note,
                contextPrefix,
                ...(parentPath ? { parentPath } : {}),
            });
        };
        const watchedSourceCache = new Map();
        const watchedSources = (type, target) => {
            const cacheKey = `${type}:${target}`;
            const cached = watchedSourceCache.get(cacheKey);
            if (cached)
                return cached;
            const metadataSources = type === 'post'
                ? [...(postsByPostId.get(target) || []), ...(commentsByPostId.get(target) || [])]
                : type === 'series'
                    ? (postsBySeriesId.get(target) || [])
                    : type === 'author'
                        ? [...(postsByAuthor.get(target) || []), ...(commentsByAuthor.get(target) || [])]
                        : type === 'tag'
                            ? (postsByTag.get(target) || [])
                            : [];
            watchedSourceCache.set(cacheKey, metadataSources);
            return metadataSources;
        };
        for (const note of relevantComments)
            addCandidate(note, 'activity', text(note.frontmatter.comment_id));
        for (const note of relevantMessages)
            addCandidate(note, 'activity', text(note.frontmatter.message_id));
        // A post mention is useful too, while comments on a post are handled above.
        for (const note of relevantPosts)
            addCandidate(note, 'activity', text(note.frontmatter.post_id));
        const watchedEvents = new Set();
        for (const subscription of subscriptions.notes) {
            const type = text(subscription.frontmatter.target_type);
            const target = text(subscription.frontmatter.target_id).toLowerCase();
            const sources = watchedSources(type, target);
            for (const note of sources) {
                const sourceId = text(note.frontmatter.post_id || note.frontmatter.comment_id);
                const notificationId = eventId('watch', note.path, `${type}:${target}:${sourceId}`);
                if (watchedEvents.has(notificationId) || text(note.frontmatter.author) === identity(principal))
                    continue;
                watchedEvents.add(notificationId);
                const author = text(note.frontmatter.author);
                if (!author || candidateIds.has(notificationId))
                    continue;
                candidateIds.add(notificationId);
                candidates.push({ notificationId, kind: 'watch', sourcePath: note.path, sourceType: text(note.frontmatter.mcpvault_type), sourceId, author, createdAt: text(note.frontmatter.updated_at || note.frontmatter.created_at), note, contextPrefix: `watched ${type}: ${target}` });
            }
        }
        return candidates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.notificationId.localeCompare(b.notificationId));
    }
    async hydrateCandidates(candidates, cutoff) {
        const parentNotes = candidates.flatMap(candidate => candidate.parentPath ? [candidate.note, { path: candidate.parentPath, frontmatter: {} }] : [candidate.note]);
        const hydrated = await this.hydrateNotes(parentNotes);
        const byPath = new Map(hydrated.map(note => [note.path, note]));
        const reputations = await this.reputation.getMany(candidates.map(candidate => candidate.author));
        return candidates.flatMap(candidate => {
            const note = byPath.get(candidate.note.path);
            if (!note)
                return [];
            const parent = candidate.parentPath ? byPath.get(candidate.parentPath) : undefined;
            const context = parent?.content ? `${candidate.contextPrefix} | replying to: ${text(parent.content).trim()}` : candidate.contextPrefix;
            const reputation = reputations.get(candidate.author.toLowerCase());
            return [{ notificationId: candidate.notificationId, kind: candidate.kind, sourcePath: candidate.sourcePath, sourceType: candidate.sourceType, sourceId: candidate.sourceId, author: candidate.author, createdAt: candidate.createdAt, content: text(note.content).trim(), context, ...(reputation && { authorLevel: reputation.level, authorLevelLabel: reputation.label }), unread: !cutoff || candidate.createdAt > cutoff }];
        });
    }
    async list(params) {
        if (!params.principal)
            throw new Error('Login is required to read notifications');
        const state = await this.lastReadAt(params.principal);
        const cutoff = state.value || '';
        const candidates = await this.cachedPublicCandidates(params.principal);
        let visible = candidates.map(candidate => ({ candidate, unread: !cutoff || candidate.createdAt > cutoff }));
        if (!params.includeRead)
            visible = visible.filter(item => item.unread);
        if (params.afterNotificationId) {
            const index = visible.findIndex(item => item.candidate.notificationId === params.afterNotificationId);
            if (index >= 0)
                visible = visible.slice(index + 1);
        }
        const limit = limitNumber(params.limit, 20, 100);
        const budget = maxChars(params.maxChars);
        const selectedCandidates = visible.slice(0, limit).map(item => item.candidate);
        const hydrated = await this.hydrateCandidates(selectedCandidates, cutoff);
        const selected = [];
        let used = 0;
        for (const event of hydrated) {
            if (selected.length >= limit)
                break;
            const size = Array.from(event.content).length + Array.from(event.context || '').length;
            if (selected.length > 0 && used + size > budget)
                break;
            selected.push(event);
            used += size;
        }
        return {
            notifications: selected,
            unreadCount: visible.filter(item => item.unread).length,
            total: visible.length,
            truncated: selected.length < visible.length,
            lastReadAt: cutoff || undefined,
            nextCursor: selected.at(-1)?.notificationId,
        };
    }
    async markRead(params) {
        if (!params.principal)
            throw new Error('Login is required to mark notifications read');
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
