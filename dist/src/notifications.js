import { normalizeScopeId } from './scopes.js';
const READ_STATE_ROOT = '_notifications';
const MAX_SCAN = 500;
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
            this.fileSystem.queryNotes({ pathPrefix: ownerRoot, filters: { mcpvault_type: 'subscription', active: true }, limit: 500 }),
        ]);
        const { posts, comments, messages, rooms } = snapshot;
        const ownedPostIds = new Set(posts.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.post_id)));
        const ownedCommentIds = new Set(comments.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.comment_id)));
        const ownedMessageIds = new Set(messages.filter(note => note.frontmatter.author === target).map(note => text(note.frontmatter.message_id)));
        const postTitles = new Map(posts.map(note => [text(note.frontmatter.post_id), text(note.frontmatter.title, text(note.frontmatter.post_id))]));
        const roomTitles = new Map(rooms.map(note => [text(note.frontmatter.room_id), text(note.frontmatter.title, text(note.frontmatter.room_id))]));
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
        const hasMention = (note) => Array.isArray(note.frontmatter.mentions)
            && note.frontmatter.mentions.map(String).some(value => value.toLowerCase() === target.toLowerCase());
        const watchedPost = (note) => {
            const postId = text(note.frontmatter.post_id).toLowerCase();
            const author = text(note.frontmatter.author).toLowerCase();
            const tags = Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags.map(String).map(value => value.toLowerCase()) : [];
            return watchedPostIds.has(postId)
                || watchedSeriesIds.has(text(note.frontmatter.series_id).toLowerCase())
                || watchedAuthors.has(author)
                || tags.some(tag => watchedTags.has(tag));
        };
        const relevantComment = (note) => {
            const author = text(note.frontmatter.author);
            const replyTo = text(note.frontmatter.reply_to);
            const activity = ownedPostIds.has(text(note.frontmatter.post_id));
            const watched = watchedPostIds.has(text(note.frontmatter.post_id).toLowerCase())
                || watchedAuthors.has(author.toLowerCase());
            return author !== target && (hasMention(note) || ownedCommentIds.has(replyTo) || activity || watched);
        };
        const relevantMessage = (note) => {
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
        const events = [];
        const reputations = await this.reputation.getMany([...comments, ...messages, ...posts].map(note => text(note.frontmatter.author)));
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
            const sources = type === 'post'
                ? [...hydratedPosts.filter(note => text(note.frontmatter.post_id).toLowerCase() === target), ...hydratedComments.filter(note => text(note.frontmatter.post_id).toLowerCase() === target)]
                : type === 'series'
                    ? hydratedPosts.filter(note => text(note.frontmatter.series_id).toLowerCase() === target)
                    : type === 'author'
                        ? [...hydratedPosts, ...hydratedComments].filter(note => text(note.frontmatter.author).toLowerCase() === target)
                        : type === 'tag'
                            ? hydratedPosts.filter(note => Array.isArray(note.frontmatter.tags) && note.frontmatter.tags.some((tag) => String(tag).toLowerCase() === target))
                            : [];
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
