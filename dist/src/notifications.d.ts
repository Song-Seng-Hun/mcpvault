import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReputationService } from './reputation.js';
type NotificationKind = 'mention' | 'reply' | 'activity' | 'watch';
export interface NotificationEvent {
    notificationId: string;
    kind: NotificationKind;
    sourcePath: string;
    sourceType: string;
    sourceId: string;
    author: string;
    createdAt: string;
    content: string;
    context?: string;
    authorLevel?: number;
    authorLevelLabel?: string;
    unread: boolean;
}
export declare class NotificationService {
    private readonly fileSystem;
    private readonly reputation;
    private readonly eventCache;
    private readonly eventInFlight;
    constructor(fileSystem: FileSystemService, reputation: ReputationService);
    invalidate(): void;
    private cachedPublicEvents;
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