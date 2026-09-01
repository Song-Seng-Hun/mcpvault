import { normalizeScopeId } from './scopes.js';
import { queryAllNotes } from './paged-query.js';
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
    };
    for (const note of snapshot.posts) {
        addToIndex(index.postsByPostId, note.frontmatter.post_id, note);
        addToIndex(index.postsBySeriesId, note.frontmatter.series_id, note);
        addToIndex(index.postsByAuthor, note.frontmatter.author, note);
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
    return index;
}
export class NotificationService {
    fileSystem;
    reputation;
    eventCache = new Map();
    eventInFlight = new Map();
    publicSnapshotCache;
    publicSnapshotInFlight;
    constructor(fileSystem, reputation) {
        this.fileSystem = fileSystem;
        this.reputation = reputation;
    }
    invalidate() {
        this.eventCache.clear();
        this.eventInFlight.clear();
        this.publicSnapshotCache = undefined;
        this.publicSnapshotInFlight = undefined;
    }
    async cachedPublicSnapshot() {
        const cached = this.publicSnapshotCache;
        if (cached && cached.expiresAt > Date.now())
            return cached.value;
        if (this.publicSnapshotInFlight)
            return this.publicSnapshotInFlight;
        const computation = Promise.all([
            queryAllNotes(this.fileSystem, { pathPrefix: 'Community/Posts', filters: { mcpvault_type: 'blog_post', status: 'published' }, sortBy: 'created_at', sortOrder: 'desc' }),
            queryAllNotes(this.fileSystem, { pathPrefix: 'Community/Comments', filters: { mcpvault_type: 'blog_comment' }, sortBy: 'created_at', sortOrder: 'desc' }),
            queryAllNotes(this.fileSystem, { pathPrefix: 'Community/ChatMessages', filters: { mcpvault_type: 'chat_message' }, sortBy: 'created_at', sortOrder: 'desc' }),
            queryAllNotes(this.fileSystem, { pathPrefix: 'Community/ChatRooms', filters: { mcpvault_type: 'chat_room' } }),
        ]).then(([posts, comments, messages, rooms]) => buildPublicSnapshotIndex({ posts: posts.notes, comments: comments.notes, messages: messages.notes, rooms: rooms.notes }));
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
