import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
export declare class ChatService {
    private readonly fileSystem;
    private readonly references;
    constructor(fileSystem: FileSystemService, references: ReferenceService);
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
        references?: unknown;
    }): Promise<{
        success: boolean;
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
        messages: any[];
        totalMessages: number;
        truncated: boolean;
        nextCursor: any;
        contextBefore: number;
    }>;
    private readMessageContext;
}
//# sourceMappingURL=chat.d.ts.map