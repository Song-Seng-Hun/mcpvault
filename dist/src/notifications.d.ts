import type { FileSystemService } from './filesystem.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReputationService } from './reputation.js';
import type { QueryNote } from './types.js';
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
export interface PublicSnapshot {
    posts: QueryNote[];
    comments: QueryNote[];
    messages: QueryNote[];
    rooms: QueryNote[];
}
export interface PublicSnapshotIndex extends PublicSnapshot {
    postsByPostId: Map<string, QueryNote[]>;
    postsBySeriesId: Map<string, QueryNote[]>;
    postsByAuthor: Map<string, QueryNote[]>;
    postsByTag: Map<string, QueryNote[]>;
    postsByMention: Map<string, QueryNote[]>;
    commentsByPostId: Map<string, QueryNote[]>;
    commentsByCommentId: Map<string, QueryNote[]>;
    commentsByAuthor: Map<string, QueryNote[]>;
    commentsByMention: Map<string, QueryNote[]>;
    commentsByReplyTo: Map<string, QueryNote[]>;
    messagesByMessageId: Map<string, QueryNote[]>;
    messagesByMention: Map<string, QueryNote[]>;
    messagesByReplyTo: Map<string, QueryNote[]>;
    postTitles: Map<string, string>;
    roomTitles: Map<string, string>;
    seriesFirstSeen: Map<string, {
        createdAt: string;
        path: string;
    }>;
    seriesOrder: string[];
}
export declare class NotificationService {
    private readonly fileSystem;
    private readonly reputation;
    private readonly vaultPath?;
    private readonly fileCatalog?;
    private readonly candidateCacheOwner;
    private readonly publicSnapshotCacheOwner;
    private readonly candidateCache;
    private readonly candidateInFlight;
    private publicSnapshotCache;
    private publicSnapshotInFlight;
    private publicSnapshotUpdate;
    private publicSnapshotWrite;
    private publicSnapshotRestoreAttempted;
    constructor(fileSystem: FileSystemService, reputation: ReputationService, vaultPath?: string | undefined, fileCatalog?: VaultFileCatalog | undefined);
    close(): Promise<void>;
    discoverySnapshot(): Promise<PublicSnapshotIndex>;
    /** Return only indexed public items that mention one of the exact identities. */
    mentionCandidates(targets: ReadonlySet<string>, includeClosed?: boolean): Promise<QueryNote[]>;
    private publicManifest;
    private loadPublicSnapshot;
    private savePublicSnapshot;
    private queuePublicSnapshotSave;
    private clearCandidateCache;
    private clearPublicSnapshotCache;
    private trackPublicSnapshotCache;
    invalidate(path?: string, kind?: 'upsert' | 'delete'): void;
    invalidateMany(changes?: readonly {
        path: string;
        kind: 'upsert' | 'delete';
    }[]): void;
    private cachedPublicSnapshot;
    private updatePublicSnapshot;
    private hydrateNotes;
    private cachedPublicCandidates;
    private lastReadAt;
    private publicCandidates;
    private hydrateCandidates;
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