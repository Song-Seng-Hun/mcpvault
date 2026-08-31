import { randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
const ROOM_ROOT = 'Community/ChatRooms';
const MESSAGE_ROOT = 'Community/ChatMessages';
const ROOM_STATUSES = new Set(['open', 'archived']);
const now = () => new Date().toISOString();
const roomPath = (roomId) => `${ROOM_ROOT}/${normalizeScopeId(roomId, 'roomId')}.md`;
const messagesRoot = (roomId) => `${MESSAGE_ROOT}/${normalizeScopeId(roomId, 'roomId')}`;
const messagePath = (roomId, messageId) => `${messagesRoot(roomId)}/${normalizeScopeId(messageId, 'messageId')}.md`;
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
    constructor(fileSystem) {
        this.fileSystem = fileSystem;
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
        const content = String(params.content ?? '').trim();
        if (!content)
            throw new Error('content is required');
        const messageId = params.messageId ? normalizeScopeId(params.messageId, 'messageId') : `message-${randomUUID().slice(0, 10)}`;
        if (params.replyTo)
            await this.fileSystem.readNote(messagePath(roomId, params.replyTo));
        const timestamp = now();
        const path = messagePath(roomId, messageId);
        await this.fileSystem.writeNote({
            path,
            content: `${content}\n`,
            frontmatter: {
                mcpvault_type: 'chat_message', message_id: messageId, room_id: roomId,
                author: identity(principal), author_role: principal.role, created_at: timestamp, updated_at: timestamp,
                ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }),
            },
            expectedRevision: 'missing',
        });
        const created = await this.fileSystem.readNote(path);
        return { success: true, messageId, roomId, path, revision: created.revision };
    }
    async readRoomWithMessages(params) {
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const room = await this.readRoom(roomId);
        const result = await this.fileSystem.queryNotes({
            pathPrefix: messagesRoot(roomId), filters: { mcpvault_type: 'chat_message' },
            sortBy: 'created_at', sortOrder: 'asc', limit: Math.min(Math.max(Number(params.limit || 200), 1), 500), includeContent: true,
        });
        return {
            room: { path: room.path, fm: room.note.frontmatter, content: room.note.content, revision: room.note.revision },
            messages: result.notes.map(note => ({
                path: note.path,
                messageId: note.frontmatter.message_id,
                roomId: note.frontmatter.room_id,
                author: note.frontmatter.author,
                authorRole: note.frontmatter.author_role,
                replyTo: note.frontmatter.reply_to,
                createdAt: note.frontmatter.created_at,
                content: note.content,
            })),
            totalMessages: result.total,
            truncated: result.truncated,
        };
    }
}
