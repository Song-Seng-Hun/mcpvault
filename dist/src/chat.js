import { randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
import { extractMentions, MAX_COMMUNITY_TEXT_LENGTH } from './social.js';
import { workflowStatus } from './community-status.js';
import { isModerationHidden, moderationStatus } from './moderation-policy.js';
import { boundItems } from './search-limits.js';
import { queryWindow } from './paged-query.js';
import { readNotesInBatches } from './batch-read.js';
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
    reputation;
    constructor(fileSystem, references, reputation) {
        this.fileSystem = fileSystem;
        this.references = references;
        this.reputation = reputation;
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
        const filters = { mcpvault_type: 'chat_room', ...(requestedStatus !== 'all' && { status: requestedStatus }) };
        const limit = Math.min(Math.max(Number(params.limit || 50), 1), 500);
        const window = await queryWindow(this.fileSystem, {
            pathPrefix: ROOM_ROOT, filters: { mcpvault_type: 'chat_room', ...(requestedStatus !== 'all' && { status: requestedStatus }) },
            sortBy: 'created_at', sortOrder: 'desc',
            limit,
        }, note => requestedStatus === 'all' || note.frontmatter.status === requestedStatus);
        const total = await this.fileSystem.countNotes({ pathPrefix: ROOM_ROOT, filters });
        const selectedRooms = window.notes;
        const reputations = await this.reputation.getMany(selectedRooms.map(note => String(note.frontmatter.created_by || '')));
        const rooms = selectedRooms.map(note => ({
            path: note.path,
            roomId: note.frontmatter.room_id,
            title: note.frontmatter.title,
            description: note.frontmatter.description,
            status: note.frontmatter.status,
            createdBy: note.frontmatter.created_by,
            createdAt: note.frontmatter.created_at,
            updatedAt: note.frontmatter.updated_at,
            creatorLevel: reputations.get(String(note.frontmatter.created_by || '').toLowerCase())?.level ?? 0,
            creatorLevelLabel: reputations.get(String(note.frontmatter.created_by || '').toLowerCase())?.label ?? '뉴비',
            moderationStatus: moderationStatus(note.frontmatter),
        }));
        const bounded = boundItems(rooms, Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000));
        return { rooms: bounded.items, total, truncated: window.truncated || total > selectedRooms.length || bounded.truncated };
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
        const references = await this.references.validateAndNormalize(params.references, path, principal, content);
        await this.fileSystem.writeNote({
            path,
            content: `${content}\n`,
            frontmatter: {
                mcpvault_type: 'chat_message', message_id: messageId, room_id: roomId,
                author: identity(principal), author_role: principal.role, created_at: timestamp, updated_at: timestamp,
                mentions: extractMentions(content),
                references,
                workflow_status: 'open',
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
        const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, path, principal, text);
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
        const limit = windowNumber(params.limit, 20, 100);
        const maxChars = windowNumber(params.maxChars, 6000, 20000);
        const contextBefore = windowNumber(params.contextBefore, 2, 20) - 1;
        const filters = { mcpvault_type: 'chat_message' };
        let notes;
        let total;
        let queryTruncated;
        if (params.afterMessageId) {
            const messageId = normalizeScopeId(params.afterMessageId, 'afterMessageId');
            const cursorResult = await this.fileSystem.queryNotes({
                pathPrefix: messagesRoot(roomId), filters: { ...filters, message_id: messageId },
                sortBy: 'created_at', sortOrder: 'asc', limit: 1, includeTotal: false,
            });
            const cursorNote = cursorResult.notes[0];
            if (!cursorNote || isModerationHidden(cursorNote.frontmatter))
                throw new Error(`afterMessageId was not found in room: ${params.afterMessageId}`);
            const cursor = cursorNote.frontmatter.created_at === undefined
                ? { path: cursorNote.path, missing: true }
                : { path: cursorNote.path, value: cursorNote.frontmatter.created_at };
            const before = contextBefore > 0
                ? await queryWindow(this.fileSystem, { pathPrefix: messagesRoot(roomId), filters, sortBy: 'created_at', sortOrder: 'desc', limit: contextBefore, after: cursor }, note => !isModerationHidden(note.frontmatter))
                : { notes: [], truncated: false };
            const forwardLimit = Math.max(1, limit - before.notes.length - 1);
            const forward = await queryWindow(this.fileSystem, { pathPrefix: messagesRoot(roomId), filters, sortBy: 'created_at', sortOrder: 'asc', limit: forwardLimit, after: cursor }, note => !isModerationHidden(note.frontmatter));
            notes = [...before.notes].reverse();
            notes.push(cursorNote, ...forward.notes);
            total = await this.fileSystem.countNotes({ pathPrefix: messagesRoot(roomId), filters }, undefined, note => !isModerationHidden(note.frontmatter));
            queryTruncated = before.truncated || forward.truncated;
        }
        else {
            const window = await queryWindow(this.fileSystem, {
                pathPrefix: messagesRoot(roomId), filters,
                sortBy: 'created_at', sortOrder: 'desc', limit,
            }, note => !isModerationHidden(note.frontmatter));
            notes = [...window.notes].reverse();
            total = await this.fileSystem.countNotes({ pathPrefix: messagesRoot(roomId), filters }, undefined, note => !isModerationHidden(note.frontmatter));
            queryTruncated = window.truncated;
        }
        const cursorIndex = params.afterMessageId
            ? notes.findIndex(note => note.frontmatter.message_id === normalizeScopeId(params.afterMessageId, 'afterMessageId'))
            : -1;
        if (params.afterMessageId && cursorIndex < 0)
            throw new Error(`afterMessageId was not found in room: ${params.afterMessageId}`);
        const start = cursorIndex >= 0 ? Math.max(0, cursorIndex - contextBefore) : Math.max(0, notes.length - limit);
        const selected = [];
        let usedChars = 0;
        const candidates = notes.slice(start).filter(note => !isModerationHidden(note.frontmatter));
        let stop = false;
        for (let batchStart = 0; batchStart < candidates.length && selected.length < limit && !stop; batchStart += 10) {
            const batchNotes = candidates.slice(batchStart, batchStart + 10);
            const fullByPath = await readNotesInBatches(this.fileSystem, batchNotes.map(note => note.path));
            for (const note of batchNotes) {
                if (selected.length >= limit)
                    break;
                const full = fullByPath.get(note.path);
                if (!full)
                    continue;
                const contentLength = Array.from(full.content).length;
                if (selected.length > 0 && usedChars + contentLength > maxChars) {
                    stop = true;
                    break;
                }
                selected.push({ note, content: full.content, revision: full.revision });
                usedChars += contentLength;
            }
        }
        const last = selected.at(-1)?.note.frontmatter.message_id;
        const selectedByPath = new Map(selected.map(item => [item.note.path, {
                path: item.note.path,
                frontmatter: item.note.frontmatter,
                content: item.content,
                revision: item.revision,
            }]));
        const parentPaths = params.includeThreadContext === false
            ? []
            : Array.from(new Set(selected
                .map(({ note }) => note.frontmatter.reply_to ? messagePath(roomId, String(note.frontmatter.reply_to)) : undefined)
                .filter((path) => Boolean(path))))
                .filter(path => !selectedByPath.has(path));
        const parentByPath = new Map(selectedByPath);
        for (const [path, parent] of await readNotesInBatches(this.fileSystem, parentPaths))
            parentByPath.set(path, parent);
        const messageReputations = await this.reputation.getMany([
            ...selected.map(({ note }) => String(note.frontmatter.author || '')),
            ...Array.from(parentByPath.values()).map(note => String(note.frontmatter.author || '')),
        ]);
        const viewerReputation = params.principal ? await this.reputation.getForPrincipal(params.principal) : undefined;
        return {
            room: { path: room.path, fm: room.note.frontmatter, content: room.note.content, revision: room.note.revision },
            ...(viewerReputation && { viewerLevel: viewerReputation.level, viewerXp: viewerReputation.xp, viewerLevelLabel: viewerReputation.label }),
            messages: selected.map(({ note, content, revision }) => ({
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
                workflowStatus: workflowStatus(note.frontmatter),
                workflowStatusBy: note.frontmatter.workflow_status_by,
                workflowStatusReason: note.frontmatter.workflow_status_reason,
                workflowStatusUpdatedAt: note.frontmatter.workflow_status_updated_at,
                moderationStatus: moderationStatus(note.frontmatter),
                authorLevel: messageReputations.get(String(note.frontmatter.author || '').toLowerCase())?.level ?? 0,
                authorLevelLabel: messageReputations.get(String(note.frontmatter.author || '').toLowerCase())?.label ?? '뉴비',
                ...(params.includeThreadContext !== false && note.frontmatter.reply_to && { parent: this.messageContextFromNote(roomId, String(note.frontmatter.reply_to), parentByPath.get(messagePath(roomId, String(note.frontmatter.reply_to))), messageReputations) }),
            })),
            totalMessages: total,
            truncated: start > 0 || queryTruncated || start + selected.length < notes.length || total > notes.length,
            nextCursor: last,
            contextBefore: cursorIndex >= 0 ? contextBefore + 1 : 0,
        };
    }
    /** Read one message directly so context-oriented callers do not need to scan a timeline. */
    async getMessage(params) {
        const roomId = normalizeScopeId(params.roomId, 'roomId');
        const messageId = normalizeScopeId(params.messageId, 'messageId');
        await this.readRoom(roomId);
        const path = messagePath(roomId, messageId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'chat_message')
            throw new Error(`Not a chat message: ${messageId}`);
        if (isModerationHidden(note.frontmatter))
            throw new Error('This chat message is unavailable because it was hidden by moderation');
        const authorReputation = (await this.reputation.getMany([String(note.frontmatter.author || '')])).get(String(note.frontmatter.author || '').toLowerCase());
        return {
            path,
            fm: note.frontmatter,
            messageId,
            roomId,
            content: note.content,
            revision: note.revision,
            authorLevel: authorReputation?.level ?? 0,
            authorLevelLabel: authorReputation?.label ?? '뉴비',
            ...(params.includeReferences !== false && { resolvedReferences: await this.references.resolve(note.frontmatter.references) }),
        };
    }
    messageContextFromNote(roomId, messageId, parent, reputations) {
        const path = messagePath(roomId, messageId);
        if (!parent)
            throw new Error(`Reply target was not readable: ${messageId}`);
        if (parent.frontmatter.mcpvault_type !== 'chat_message')
            throw new Error(`Reply target is not a chat message: ${messageId}`);
        const parentReputation = reputations.get(String(parent.frontmatter.author || '').toLowerCase());
        if (isModerationHidden(parent.frontmatter))
            return { path, messageId: parent.frontmatter.message_id, roomId: parent.frontmatter.room_id, author: parent.frontmatter.author, authorRole: parent.frontmatter.author_role, authorLevel: parentReputation?.level ?? 0, authorLevelLabel: parentReputation?.label ?? '뉴비', createdAt: parent.frontmatter.created_at, content: '[moderated]', replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter), moderated: true };
        return { path, messageId: parent.frontmatter.message_id, roomId: parent.frontmatter.room_id, author: parent.frontmatter.author, authorRole: parent.frontmatter.author_role, authorLevel: parentReputation?.level ?? 0, authorLevelLabel: parentReputation?.label ?? '뉴비', createdAt: parent.frontmatter.created_at, content: parent.content, replyTo: parent.frontmatter.reply_to, workflowStatus: workflowStatus(parent.frontmatter) };
    }
}
