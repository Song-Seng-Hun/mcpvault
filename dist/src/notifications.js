import { normalizeScopeId } from './scopes.js';
import { iterateNotes, queryAllNotes } from './paged-query.js';
import { isClosedWorkflowStatus } from './community-status.js';
import { isModerationHidden } from './moderation-policy.js';
const READ_STATE_ROOT = '_notifications';
const EVENT_CACHE_TTL_MS = 2_000;
const EVENT_CACHE_MAX_ENTRIES = 64;
const HYDRATE_BATCH_SIZE = 32;
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
        seriesOrder: [],
    };
    const seriesFirstSeen = new Map();
    for (const note of snapshot.posts) {
        addToIndex(index.postsByPostId, note.frontmatter.post_id, note);
        addToIndex(index.postsBySeriesId, note.frontmatter.series_id, note);
        addToIndex(index.postsByAuthor, note.frontmatter.author, note);
        const seriesId = text(note.frontmatter.series_id);
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
    return index;
}
function reindexPublicCollection(index, collection) {
    if (collection === 'posts') {
        const postsByPostId = new Map();
        const postsBySeriesId = new Map();
        const postsByAuthor = new Map();
        const postsByTag = new Map();
        const postsByMention = new Map();
        const postTitles = new Map();
        const seriesFirstSeen = new Map();
        for (const note of index.posts) {
            addToIndex(postsByPostId, note.frontmatter.post_id, note);
            addToIndex(postsBySeriesId, note.frontmatter.series_id, note);
            addToIndex(postsByAuthor, note.frontmatter.author, note);
            addMentions(postsByMention, note);
            if (Array.isArray(note.frontmatter.tags))
                for (const tag of note.frontmatter.tags)
                    addToIndex(postsByTag, tag, note);
            const postId = text(note.frontmatter.post_id);
            if (postId)
                postTitles.set(postId, text(note.frontmatter.title, postId));
            const seriesId = text(note.frontmatter.series_id);
            if (seriesId && !isModerationHidden(note.frontmatter)) {
                const seen = seriesFirstSeen.get(seriesId);
                const candidate = { createdAt: text(note.frontmatter.created_at), path: note.path };
                if (!seen || candidate.createdAt < seen.createdAt || (candidate.createdAt === seen.createdAt && candidate.path < seen.path))
                    seriesFirstSeen.set(seriesId, candidate);
            }
        }
        return {
            ...index,
            postsByPostId,
            postsBySeriesId,
            postsByAuthor,
            postsByTag,
            postsByMention,
            postTitles,
            seriesOrder: [...seriesFirstSeen.entries()].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[1].path.localeCompare(b[1].path)).map(([seriesId]) => seriesId),
        };
    }
    if (collection === 'comments') {
        const commentsByPostId = new Map();
        const commentsByCommentId = new Map();
        const commentsByAuthor = new Map();
        const commentsByMention = new Map();
        const commentsByReplyTo = new Map();
        for (const note of index.comments) {
            addToIndex(commentsByPostId, note.frontmatter.post_id, note);
            addToIndex(commentsByCommentId, note.frontmatter.comment_id, note);
            addToIndex(commentsByAuthor, note.frontmatter.author, note);
            addMentions(commentsByMention, note);
            addToIndex(commentsByReplyTo, note.frontmatter.reply_to, note);
        }
        return { ...index, commentsByPostId, commentsByCommentId, commentsByAuthor, commentsByMention, commentsByReplyTo };
    }
    if (collection === 'messages') {
        const messagesByMessageId = new Map();
        const messagesByMention = new Map();
        const messagesByReplyTo = new Map();
        for (const note of index.messages) {
            addToIndex(messagesByMessageId, note.frontmatter.message_id, note);
            addMentions(messagesByMention, note);
            addToIndex(messagesByReplyTo, note.frontmatter.reply_to, note);
        }
        return { ...index, messagesByMessageId, messagesByMention, messagesByReplyTo };
    }
    const roomTitles = new Map();
    for (const note of index.rooms) {
        const roomId = text(note.frontmatter.room_id);
        if (roomId)
            roomTitles.set(roomId, text(note.frontmatter.title, roomId));
    }
    return { ...index, roomTitles };
}
export class NotificationService {
    fileSystem;
    reputation;
    eventCache = new Map();
    eventInFlight = new Map();
    publicSnapshotCache;
    publicSnapshotInFlight;
    publicSnapshotUpdate;
    constructor(fileSystem, reputation) {
        this.fileSystem = fileSystem;
        this.reputation = reputation;
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
    invalidate(path, kind = 'upsert') {
        this.eventCache.clear();
        this.eventInFlight.clear();
        const collection = path ? publicCollectionForPath(path) : undefined;
        if (!path || !collection) {
            if (!path)
                this.publicSnapshotCache = undefined;
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
        if (cached && cached.expiresAt > Date.now())
            return cached.value;
        if (this.publicSnapshotInFlight)
            return this.publicSnapshotInFlight;
        const computation = (async () => {
            const snapshot = { posts: [], comments: [], messages: [], rooms: [] };
            for await (const note of iterateNotes(this.fileSystem)) {
                const collection = publicCollectionForPath(note.path);
                if (collection && belongsInPublicCollection(note, collection))
                    snapshot[collection].push(compactPublicNote(note, collection));
            }
            for (const collection of ['posts', 'comments', 'messages', 'rooms'])
                sortPublicCollection(snapshot[collection], collection);
            return buildPublicSnapshotIndex(snapshot);
        })();
        this.publicSnapshotInFlight = computation;
        try {
            const value = await computation;
            this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value };
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
            this.publicSnapshotCache = undefined;
            return;
        }
        const nextCollection = cached.value[collection].filter(note => note.path !== path);
        if (kind !== 'delete') {
            const note = await this.fileSystem.readNote(path);
            const metadata = { path: normalizePath(path), frontmatter: compactPublicNote({ path, frontmatter: note.frontmatter }, collection).frontmatter };
            if (belongsInPublicCollection(metadata, collection))
                nextCollection.push(metadata);
        }
        sortPublicCollection(nextCollection, collection);
        const next = { ...cached.value, [collection]: nextCollection };
        this.publicSnapshotCache = { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, value: reindexPublicCollection(next, collection) };
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
    async cachedPublicEvents(principal) {
        const key = JSON.stringify({ accountId: principal.accountId, modelId: principal.modelId, agentId: principal.agentId, role: principal.role });
        const cached = this.eventCache.get(key);
        if (cached && cached.expiresAt > Date.now())
            return cached.events.map(event => ({ ...event }));
        if (cached)
            this.eventCache.delete(key);
        const running = this.eventInFlight.get(key);
        if (running)
            return (await running).map(event => ({ ...event }));
        const computation = this.publicEvents(principal);
        this.eventInFlight.set(key, computation);
        try {
            const events = await computation;
            this.eventCache.set(key, { expiresAt: Date.now() + EVENT_CACHE_TTL_MS, events: events.map(event => ({ ...event })) });
            while (this.eventCache.size > EVENT_CACHE_MAX_ENTRIES) {
                const oldest = this.eventCache.keys().next();
                if (oldest.done)
                    break;
                this.eventCache.delete(oldest.value);
            }
            return events;
        }
        finally {
            if (this.eventInFlight.get(key) === computation)
                this.eventInFlight.delete(key);
        }
    }
    async lastReadAt(principal) {
        const path = readStatePath(principal);
        if (!await this.fileSystem.noteExists(path))
            return {};
        const note = await this.fileSystem.readNote(path);
        return { value: text(note.frontmatter.last_read_at), revision: note.revision };
    }
    async publicEvents(principal) {
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
        const events = [];
        const reputations = await this.reputation.getMany([...hydratedComments, ...hydratedMessages, ...hydratedPosts].map(note => text(note.frontmatter.author)));
        const hydratedByPath = new Map([...hydratedPosts, ...hydratedComments, ...hydratedMessages].map(note => [note.path, note]));
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
            const sources = metadataSources.map(note => hydratedByPath.get(note.path) || note);
            watchedSourceCache.set(cacheKey, sources);
            return sources;
        };
        const add = (note, kind, sourceId) => {
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
                ...(reputations.get(author.toLowerCase()) && { authorLevel: reputations.get(author.toLowerCase()).level, authorLevelLabel: reputations.get(author.toLowerCase()).label }),
                unread: true,
            });
        };
        for (const note of hydratedComments)
            add(note, 'activity', text(note.frontmatter.comment_id));
        for (const note of hydratedMessages)
            add(note, 'activity', text(note.frontmatter.message_id));
        // A post mention is useful too, while comments on a post are handled above.
        for (const note of hydratedPosts)
            add(note, 'activity', text(note.frontmatter.post_id));
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
                const authorReputation = reputations.get(author.toLowerCase());
                events.push({ notificationId, kind: 'watch', sourcePath: note.path, sourceType: text(note.frontmatter.mcpvault_type), sourceId, author, createdAt: text(note.frontmatter.updated_at || note.frontmatter.created_at), content: text(note.content).trim(), context: `watched ${type}: ${target}`, ...(authorReputation && { authorLevel: authorReputation.level, authorLevelLabel: authorReputation.label }), unread: true });
            }
        }
        return events.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    async list(params) {
        if (!params.principal)
            throw new Error('Login is required to read notifications');
        const state = await this.lastReadAt(params.principal);
        const cutoff = state.value || '';
        let events = await this.cachedPublicEvents(params.principal);
        events = events.map(event => ({ ...event, unread: !cutoff || event.createdAt > cutoff }));
        if (!params.includeRead)
            events = events.filter(event => event.unread);
        if (params.afterNotificationId) {
            const index = events.findIndex(event => event.notificationId === params.afterNotificationId);
            if (index >= 0)
                events = events.slice(index + 1);
        }
        const limit = limitNumber(params.limit, 20, 100);
        const budget = maxChars(params.maxChars);
        const selected = [];
        let used = 0;
        for (const event of events) {
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
            unreadCount: events.filter(event => event.unread).length,
            total: events.length,
            truncated: selected.length < events.length,
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
