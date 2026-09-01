import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
type NotificationKind = 'mention' | 'reply' | 'activity' | 'watch';
interface NotificationEvent {
    notificationId: string;
    kind: NotificationKind;
    sourcePath: string;
    sourceType: string;
    sourceId: string;
    author: string;
    createdAt: string;
    content: string;
    context?: string;
    unread: boolean;
}
export declare class NotificationService {
    private readonly fileSystem;
    constructor(fileSystem: FileSystemService);
    private lastReadAt;
    private publicEvents;
    list(params: {
        principal?: ScopePrincipal;
        includeRead?: boolean;
        limit?: number;
        maxChars?: number;
        afterNotificationId?: string;
    }): Promise<{
        notifications: NotificationEvent[];
        unreadCount: number;
        total: number;
        truncated: boolean;
        lastReadAt: string | undefined;
        nextCursor: string | undefined;
    }>;
    markRead(params: {
        principal?: ScopePrincipal;
        through?: string;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        lastReadAt: string;
        through: string | undefined;
        revision: string;
    }>;
}
export {};
//# sourceMappingURL=notifications.d.ts.map