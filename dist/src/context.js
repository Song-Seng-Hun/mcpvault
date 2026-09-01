function integer(value, fallback, maximum, allowZero = false) {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1))
        throw new Error('context limits must be integers in range');
    return Math.min(parsed, maximum);
}
function compactNote(note, maxContent) {
    const result = {
        path: note.path,
        fm: note.fm || note.frontmatter || {},
        content: String(note.content || '').slice(0, maxContent),
        revision: note.revision,
    };
    if (note.commentId)
        result.commentId = note.commentId;
    if (note.messageId)
        result.messageId = note.messageId;
    if (note.postId)
        result.postId = note.postId;
    if (note.roomId)
        result.roomId = note.roomId;
    if (note.resolvedReferences)
        result.resolvedReferences = note.resolvedReferences;
    return result;
}
/**
 * Builds a bounded, navigable context packet from the existing Markdown
 * services. It is deliberately a read model, not a second content database.
 */
export class ContextService {
    social;
    chat;
    constructor(social, chat) {
        this.social = social;
        this.chat = chat;
    }
    async read(params) {
        const targetType = String(params.targetType || '').trim().toLowerCase();
        if (!['post', 'comment', 'room', 'message'].includes(targetType))
            throw new Error('targetType must be post, comment, room, or message');
        const before = integer(params.contextBefore, 2, 5, true);
        const after = integer(params.contextAfter, 2, 5, true);
        const maxChars = integer(params.maxChars, 8000, 20000);
        const includeReferences = params.includeReferences !== false;
        let root;
        let target;
        let neighbors = [];
        let parentChain = [];
        if (targetType === 'post') {
            if (!params.slug)
                throw new Error('slug is required for a post context');
            root = await this.social.getBlogPost({ ...(params.principal && { principal: params.principal }), slug: params.slug, includeComments: false });
            target = root;
        }
        else if (targetType === 'comment') {
            if (!params.slug || !params.commentId)
                throw new Error('slug and commentId are required for a comment context');
            root = await this.social.getBlogPost({ ...(params.principal && { principal: params.principal }), slug: params.slug, includeComments: false });
            target = await this.social.getBlogComment({ ...(params.principal && { principal: params.principal }), slug: params.slug, commentId: params.commentId, includeReferences });
            const window = await this.social.listBlogComments({ slug: params.slug, afterCommentId: params.commentId, contextBefore: Math.max(1, before + 1), limit: Math.max(1, before + after + 1), maxChars: Math.min(maxChars, 12000), includeThreadContext: true, workflowStatus: 'all' });
            neighbors = window.comments.filter((item) => item.commentId !== params.commentId).slice(0, before + after);
            let parent = target.fm?.reply_to;
            const seen = new Set();
            while (parent && parentChain.length < 5 && !seen.has(String(parent))) {
                seen.add(String(parent));
                const item = await this.social.getBlogComment({ ...(params.principal && { principal: params.principal }), slug: params.slug, commentId: String(parent), includeReferences: false });
                parentChain.push(compactNote(item, Math.min(1000, Math.floor(maxChars / 5))));
                parent = item.fm?.reply_to;
            }
        }
        else if (targetType === 'room') {
            if (!params.roomId)
                throw new Error('roomId is required for a room context');
            const room = await this.chat.readRoomWithMessages({ roomId: params.roomId, limit: 1, maxChars: Math.min(maxChars, 4000), includeThreadContext: false });
            root = room.room;
            target = root;
            neighbors = room.messages;
        }
        else {
            if (!params.roomId || !params.messageId)
                throw new Error('roomId and messageId are required for a message context');
            const room = await this.chat.readRoomWithMessages({ roomId: params.roomId, afterMessageId: params.messageId, contextBefore: Math.max(1, before + 1), limit: Math.max(1, before + after + 1), maxChars: Math.min(maxChars, 12000), includeThreadContext: true });
            root = room.room;
            target = await this.chat.getMessage({ roomId: params.roomId, messageId: params.messageId, includeReferences });
            neighbors = room.messages.filter((item) => item.messageId !== params.messageId).slice(0, before + after);
            let parent = target.fm?.reply_to;
            const seen = new Set();
            while (parent && parentChain.length < 5 && !seen.has(String(parent))) {
                seen.add(String(parent));
                const item = await this.chat.getMessage({ roomId: params.roomId, messageId: String(parent), includeReferences: false });
                parentChain.push(compactNote(item, Math.min(1000, Math.floor(maxChars / 5))));
                parent = item.fm?.reply_to;
            }
        }
        const componentBudget = Math.max(400, Math.floor(maxChars / (parentChain.length + neighbors.length + 3)));
        const packet = {
            protocol: 'mcpvault-context/v1',
            targetType,
            root: compactNote(root, componentBudget * 2),
            target: compactNote(target, componentBudget),
            ...(parentChain.length > 0 && { parentChain }),
            ...(neighbors.length > 0 && { neighbors: neighbors.map(item => compactNote(item, componentBudget)) }),
            bounds: { contextBefore: before, contextAfter: after, maxChars, truncated: false },
        };
        if (includeReferences) {
            const refs = [
                ...((root.fm || {}).references || []),
                ...((target.fm || {}).references || []),
            ].filter((value, index, all) => typeof value === 'string' && all.indexOf(value) === index).slice(0, 10);
            if (refs.length > 0) {
                // The originating service already applies scope checks. Context keeps
                // reference payloads small by using the existing resolved metadata.
                packet.references = [
                    ...(root.resolvedReferences || []),
                    ...(target.resolvedReferences || []),
                ].filter((value, index, all) => all.findIndex(item => item.path === value.path) === index).slice(0, 10);
            }
        }
        let serialized = JSON.stringify(packet);
        if (serialized.length > maxChars) {
            packet.bounds.truncated = true;
            for (const key of ['neighbors', 'parentChain']) {
                if (serialized.length <= maxChars)
                    break;
                if (Array.isArray(packet[key]))
                    packet[key] = packet[key].slice(0, 1);
                serialized = JSON.stringify(packet);
            }
            for (const item of [packet.target, packet.root, ...(packet.parentChain || []), ...(packet.neighbors || [])]) {
                if (serialized.length <= maxChars)
                    break;
                if (item && typeof item === 'object' && 'content' in item) {
                    item.content = String(item.content || '').slice(0, Math.max(120, Math.floor(componentBudget / 2)));
                    serialized = JSON.stringify(packet);
                }
            }
            if (serialized.length > maxChars) {
                delete packet.references;
                delete packet.neighbors;
                delete packet.parentChain;
                const rootSummary = packet.root;
                const targetSummary = packet.target;
                packet.root = { path: rootSummary.path, revision: rootSummary.revision };
                packet.target = { path: targetSummary.path, revision: targetSummary.revision, ...(targetSummary.commentId && { commentId: targetSummary.commentId }), ...(targetSummary.messageId && { messageId: targetSummary.messageId }) };
                serialized = JSON.stringify(packet);
            }
            // Paths and ids are bounded by their respective services, so this final
            // fallback guarantees the caller's maxChars contract even with unusual
            // frontmatter supplied by a user-authored note.
            if (serialized.length > maxChars) {
                packet.root = { path: String(packet.root.path || '').slice(0, 128) };
                packet.target = { path: String(packet.target.path || '').slice(0, 128) };
            }
        }
        return packet;
    }
}
