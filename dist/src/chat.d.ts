import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class ChatService {
    private readonly fileSystem;
    constructor(fileSystem: FileSystemService);
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
    }): Promise<{
        success: boolean;
        messageId: string;
        roomId: string;
        path: string;
        revision: string;
    }>;
    readRoomWithMessages(params: {
        roomId: string;
        limit?: number;
    }): Promise<{
        room: {
            path: string;
            fm: Record<string, any>;
            content: string;
            revision: string;
        };
        messages: {
            path: string;
            messageId: any;
            roomId: any;
            author: any;
            authorRole: any;
            replyTo: any;
            createdAt: any;
            content: string | undefined;
        }[];
        totalMessages: number;
        truncated: boolean;
    }>;
}
//# sourceMappingURL=chat.d.ts.map