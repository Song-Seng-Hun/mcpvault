import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import type { ReputationService } from './reputation.js';
/** Shared reply validation for ordinary chat and pre-roleplay room history. */
export declare function readChatReplyTarget(fileSystem: FileSystemService, roomId: string, messageId: string, options?: {
    canAccessPath?: (path: string) => boolean;
    ordinaryOnly?: boolean;
}): Promise<{
    path: string;
    note: import("./types.js").ParsedNote;
}>;
export declare class ChatService {
    private readonly fileSystem;
    private readonly references;
    private readonly reputation;
    private readonly verifiedRoleplay?;
    constructor(fileSystem: FileSystemService, references: ReferenceService, reputation: ReputationService, verifiedRoleplay?: (() => Promise<Array<{
        path: string;
        revision: string;
        content: string;
        frontmatter: Record<string, any>;
    }>>) | undefined);
    private verifiedTurns;
    private verifiedMessage;
    createRoom(params: {
        principal?: ScopePrincipal;
        roomId: string;
        title: string;
        description?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        roomId: string;
        path: string;
        status: string;
        revision: string;
    }>;
    listRooms(params: {
        status?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        rooms: {
            path: string;
            roomId: any;
            title: any;
            description: any;
            status: any;
            createdBy: any;
            createdAt: any;
            updatedAt: any;
            creatorLevel: number;
            creatorLevelLabel: string;
            moderationStatus: "hidden" | "quarantined" | "removed" | "visible" | "warned";
        }[];
        total: number;
        truncated: boolean;
    }>;
    private readRoom;
    sendMessage(params: {
        principal?: ScopePrincipal;
        roomId: string;
        content: string;
        replyTo?: string;
        messageId?: string;
        requestId?: string;
        references?: unknown;
    }): Promise<{
        success: true;
        messageId: string;
        roomId: string;
        path: string;
        revision: string;
    }>;
    editMessage(params: {
        principal?: ScopePrincipal;
        roomId: string;
        messageId: string;
        content: string;
        references?: unknown;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        messageId: string;
        roomId: string;
        revision: string;
    }>;
    deleteMessage(params: {
        principal?: ScopePrincipal;
        roomId: string;
        messageId: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        messageId: string;
        roomId: string;
        deleted: boolean;
        revision: string;
    }>;
    archiveRoom(params: {
        principal?: ScopePrincipal;
        roomId: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        roomId: string;
        status: string;
        revision: string;
    }>;
    readRoomWithMessages(params: {
        principal?: ScopePrincipal;
        roomId: string;
        limit?: number;
        afterMessageId?: string;
        contextBefore?: number;
        maxChars?: number;
        includeThreadContext?: boolean;
    }): Promise<{
        room: {
            path: string;
            fm: Record<string, any>;
            content: string;
            revision: string;
        };
        viewerLevel?: number;
        viewerXp?: number;
        viewerLevelLabel?: string;
        messages: any[];
        totalMessages: number;
        truncated: boolean;
        nextCursor: any;
        contextBefore: number;
    }>;
    /** Read one message directly so context-oriented callers do not need to scan a timeline. */
    getMessage(params: {
        roomId: string;
        messageId: string;
        includeReferences?: boolean;
    }): Promise<{
        path: string;
        fm: {
            [x: string]: any;
        };
        messageId: string;
        roomId: string;
        content: string;
        revision: string;
        authorLevel: number;
        authorLevelLabel: string;
        resolvedReferences?: Record<string, unknown>[];
    }>;
    private messageContextFromNote;
}
//# sourceMappingURL=chat.d.ts.map