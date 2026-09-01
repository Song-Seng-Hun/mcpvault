import { randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
import { extractMentions, MAX_COMMUNITY_TEXT_LENGTH } from './social.js';
const ROOM_ROOT = 'Community/ChatRooms';
const MESSAGE_ROOT = 'Community/ChatMessages';
const ROOM_STATUSES = new Set(['open', 'archived']);
const now = () => new Date().toISOString();
const roomPath = (roomId) => `${ROOM_ROOT}/${normalizeScopeId(roomId, 'roomId')}.md`;
const messagesRoot = (roomId) => `${MESSAGE_ROOT}/${normalizeScopeId(roomId, 'roomId')}`;
const messagePath = (roomId, messageId) => `${messagesRoot(roomId)}/${normalizeScopeId(messageId, 'messageId')}.md`;
function shortMessage(content) {
    const normalized = String(content ?? '').trim();
    if (!normalized)
        throw new Error('content is required');
    const length = Array.from(normalized).length;
    if (length > MAX_COMMUNITY_TEXT_LENGTH)
        throw new Error(`content must be ${MAX_COMMUNITY_TEXT_LENGTH} Unicode characters or fewer (received ${length})`);
    return normalized;
}
function windowNumber(value, fallback, maximum) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 1)
        throw new Error('window limits must be positive integers');
    return Math.min(number, maximum);
}
function identity(principal) {
    return principal.agentId || principal.modelId;
}
function requireParticipant(principal) {
    if (!principal)
        throw new Error('Login is required to create rooms or send chat messages');
    return principal;
}
export class ChatService {
    fileSystem;
    references;
    constructor(fileSystem, references) {
        this.fileSystem = fileSystem;
        this.references = references;
    }
    async createRoom(params) {
        const principal = requireParticipant(params.principal);
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const title = String(params.title || '').trim();
        if (!title)
            throw new Error('title is required');
        if (!params.expectedRevision)
            throw new Error("expectedRevision is required; use 'missing' for a new room");
        const path = roomPath(roomId);
        const timestamp = now();
        await this.fileSystem.writeNote({
            path,
            content: `# ${title}\n\n${String(params.description || '').trim()}\n`,
            frontmatter: {
                mcpvault_type: 'chat_room', room_id: roomId, title, status: 'open',
                description: String(params.description || '').trim(), created_by: identity(principal),
                created_at: timestamp, updated_at: timestamp,
            },
            expectedRevision: params.expectedRevision,
        });
        const created = await this.fileSystem.readNote(path);
        return { success: true, created: true, roomId, path, status: 'open', revision: created.revision };
    }
    async listRooms(params) {
        const requestedStatus = String(params.status || 'open').trim().toLowerCase();
        if (requestedStatus !== 'all' && !ROOM_STATUSES.has(requestedStatus))
            throw new Error('status must be open, archived, or all');
        const result = await this.fileSystem.queryNotes({
            pathPrefix: ROOM_ROOT, filters: { mcpvault_type: 'chat_room' },
            sortBy: 'created_at', sortOrder: 'desc', limit: 500,
        });
        const rooms = result.notes.filter(note => requestedStatus === 'all' || note.frontmatter.status === requestedStatus).map(note => ({
            path: note.path,
            roomId: note.frontmatter.room_id,
            title: note.frontmatter.title,
            description: note.frontmatter.description,
            status: note.frontmatter.status,
            createdBy: note.frontmatter.created_by,
            createdAt: note.frontmatter.created_at,
            updatedAt: note.frontmatter.updated_at,
        }));
        const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
        return { rooms: rooms.slice(0, limit), total: rooms.length, truncated: result.truncated || rooms.length > limit };
    }
    async readRoom(roomId) {
        const path = roomPath(roomId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'chat_room')
            throw new Error(`Not a chat room: ${roomId}`);
        return { path, note };
    }
    async sendMessage(params) {
        const principal = requireParticipant(params.principal);
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const room = await this.readRoom(roomId);
        if (room.note.frontmatter.status !== 'open')
            throw new Error('Cannot send a message to an archived room');
        const content = shortMessage(params.content);
        const messageId = params.messageId ? normalizeScopeId(params.messageId, 'messageId') : `message-${randomUUID().slice(0, 10)}`;
        if (params.replyTo)
            await this.fileSystem.readNote(messagePath(roomId, params.replyTo));
        const timestamp = now();
        const path = messagePath(roomId, messageId);
        const references = await this.references.validateAndNormalize(params.references, path, principal);
        await this.fileSystem.writeNote({
            path,
            content: `${content}\n`,
            frontmatter: {
                mcpvault_type: 'chat_message', message_id: messageId, room_id: roomId,
                author: identity(principal), author_role: principal.role, created_at: timestamp, updated_at: timestamp,
                mentions: extractMentions(content),
                references,
                ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }),
            },
            expectedRevision: 'missing',
        });
        const created = await this.fileSystem.readNote(path);
        return { success: true, messageId, roomId, path, revision: created.revision };
    }
    async editMessage(params) {
        const principal = requireParticipant(params.principal);
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const messageId = normalizeScopeId(params.messageId, 'messageId');
        const path = messagePath(roomId, messageId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'chat_message')
            throw new Error(`Not a chat message: ${messageId}`);
        if (note.frontmatter.author !== identity(principal))
            throw new Error('Only the original message author can edit this message');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the message first');
        const text = shortMessage(params.content);
        const references = params.references !== undefined
            ? await this.references.validateAndNormalize(params.references, path, principal)
            : (note.frontmatter.references || []);
        await this.fileSystem.writeNote({ path, content: `${text}\n`, frontmatter: { ...note.frontmatter, content_status: 'published', mentions: extractMentions(text), references, updated_at: now() }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, messageId, roomId, revision: updated.revision };
    }
    async deleteMessage(params) {
        const principal = requireParticipant(params.principal);
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const messageId = normalizeScopeId(params.messageId, 'messageId');
        const path = messagePath(roomId, messageId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'chat_message')
            throw new Error(`Not a chat message: ${messageId}`);
        if (note.frontmatter.author !== identity(principal))
            throw new Error('Only the original message author can delete this message');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the message first');
        await this.fileSystem.writeNote({ path, content: '[deleted]\n', frontmatter: { ...note.frontmatter, content_status: 'deleted', deleted_at: now(), updated_at: now() }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, messageId, roomId, deleted: true, revision: updated.revision };
    }
    async archiveRoom(params) {
        const principal = requireParticipant(params.principal);
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const room = await this.readRoom(roomId);
        if (room.note.frontmatter.created_by !== identity(principal))
            throw new Error('Only the room creator can archive this room');
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the room first');
        await this.fileSystem.writeNote({ path: room.path, content: room.note.content, frontmatter: { ...room.note.frontmatter, status: 'archived', updated_at: now() }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(room.path);
        return { success: true, roomId, status: 'archived', revision: updated.revision };
    }
    async readRoomWithMessages(params) {
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const room = await this.readRoom(roomId);
        const result = await this.fileSystem.queryNotes({
            pathPrefix: messagesRoot(roomId), filters: { mcpvault_type: 'chat_message' },
            sortBy: 'created_at', sortOrder: 'asc', limit: 500,
        });
        const limit = windowNumber(params.limit, 20, 100);
        const maxChars = windowNumber(params.maxChars, 6000, 20000);
        const contextBefore = windowNumber(params.contextBefore, 2, 20) - 1;
        const cursorIndex = params.afterMessageId
            ? result.notes.findIndex(note => note.frontmatter.message_id === normalizeScopeId(params.afterMessageId, 'afterMessageId'))
            : -1;
        if (params.afterMessageId && cursorIndex < 0)
            throw new Error(`afterMessageId was not found in room: ${params.afterMessageId}`);
        const start = cursorIndex >= 0 ? Math.max(0, cursorIndex - contextBefore) : Math.max(0, result.notes.length - limit);
        const selected = [];
        let usedChars = 0;
        for (let index = start; index < result.notes.length && selected.length < limit; index += 1) {
            const note = result.notes[index];
            const full = await this.fileSystem.readNote(note.path);
            const contentLength = Array.from(full.content).length;
            if (selected.length > 0 && usedChars + contentLength > maxChars)
                break;
            selected.push({ note, content: full.content, revision: full.revision });
            usedChars += contentLength;
        }
        const last = selected.at(-1)?.note.frontmatter.message_id;
        return {
            room: { path: room.path, fm: room.note.frontmatter, content: room.note.content, revision: room.note.revision },
            messages: await Promise.all(selected.map(async ({ note, content, revision }) => ({
                path: note.path,
                messageId: note.frontmatter.message_id,
                roomId: note.frontmatter.room_id,
                author: note.frontmatter.author,
                authorRole: note.frontmatter.author_role,
                replyTo: note.frontmatter.reply_to,
                createdAt: note.frontmatter.created_at,
                content,
                revision,
                references: note.frontmatter.references || [],
                ...(params.includeThreadContext !== false && note.frontmatter.reply_to && { parent: await this.readMessageContext(roomId, note.frontmatter.reply_to) }),
            }))),
            totalMessages: result.total,
            truncated: start > 0 || result.truncated || start + selected.length < result.notes.length,
            nextCursor: last,
            contextBefore: cursorIndex >= 0 ? contextBefore + 1 : 0,
        };
    }
    async readMessageContext(roomId, messageId) {
        const path = messagePath(roomId, messageId);
        const parent = await this.fileSystem.readNote(path);
        if (parent.frontmatter.mcpvault_type !== 'chat_message')
            throw new Error(`Reply target is not a chat message: ${messageId}`);
        return { path, messageId: parent.frontmatter.message_id, roomId: parent.frontmatter.room_id, author: parent.frontmatter.author, authorRole: parent.frontmatter.author_role, createdAt: parent.frontmatter.created_at, content: parent.content, replyTo: parent.frontmatter.reply_to };
    }
}
