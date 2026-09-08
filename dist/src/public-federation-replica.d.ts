import { type PublicActorRecord, type PublicCommentRecord, type PublicFederationEvent, type PublicFederationFeed, type PublicFederationIdentity, type PublicPostRecord, type PublicProfileRecord, type PublicPublishInput } from './public-federation.js';
export interface PublicFederationTransport {
    publish(input: PublicPublishInput, idempotencyKey: string): Promise<PublicFederationEvent>;
    getFeed(after?: number, limit?: number): Promise<PublicFederationFeed>;
}
export interface PublicFederationReplicaOptions {
    vaultPath: string;
    identity: PublicFederationIdentity;
    client: PublicFederationTransport;
    trustedHubPublicKey: string;
    maxOutboxRecords?: number;
    maxOutboxBytes?: number;
    /** Namespace sidecar cursors/outboxes when several authenticated actors share one vault. */
    storageNamespace?: string;
    /** Existing SocialService/AgentDirectory files are the local source in enterprise mode. */
    manageLocalProjection?: boolean;
}
export interface PublicReplicaPublishResult {
    status: 'published' | 'pending';
    objectId: string;
    event?: PublicFederationEvent;
    error?: string;
}
export interface PublicOutboxFlushResult {
    published: string[];
    pending: string[];
    rejected: string[];
}
export interface PublicFederationPullResult {
    applied: string[];
    pending: string[];
    hidden: string[];
    cursor: number;
    hasMore: boolean;
    errors: string[];
}
export type PublicFederationObjectStatus = 'active' | 'pending-parent' | 'origin-tombstone' | 'global-moderation' | 'local-hide';
export interface PublicFederationObjectView {
    objectId: string;
    origin: string;
    revision: number;
    status: PublicFederationObjectStatus;
    record: PublicActorRecord | PublicProfileRecord | PublicPostRecord | PublicCommentRecord;
}
export interface PublicFederationListParams {
    type?: 'actor' | 'profile' | 'post' | 'comment';
    origin?: string;
    postId?: string;
    status?: PublicFederationObjectStatus;
    after?: string;
    limit?: number;
    /** Administrative diagnostics only; ordinary imported reads expose active records. */
    includeUnavailable?: boolean;
}
export interface PublicFederationObjectList {
    objects: PublicFederationObjectView[];
    truncated: boolean;
    nextCursor?: string;
}
export declare class PublicFederationReplica {
    private readonly vaultPath;
    private readonly publicRoot;
    private readonly internalRoot;
    private readonly outboxRoot;
    private readonly rejectedRoot;
    private readonly statePath;
    private readonly identity;
    private readonly actorId;
    private readonly client;
    private readonly trustedHubPublicKey;
    private readonly maxOutboxRecords;
    private readonly maxOutboxBytes;
    private readonly manageLocalProjection;
    private state;
    private loaded;
    private mutationTail;
    constructor(options: PublicFederationReplicaOptions);
    private read;
    private writeAtomic;
    private load;
    private save;
    private withMutation;
    private localPath;
    private outboxPath;
    private queued;
    private assertAcknowledgement;
    private deliver;
    private reject;
    publish(input: PublicPublishInput, idempotencyKey: string): Promise<PublicReplicaPublishResult>;
    flushOutbox(): Promise<PublicOutboxFlushResult>;
    private apply;
    private possibleImportedPaths;
    private reconcile;
    private objectStatus;
    private view;
    getObject(objectId: string, options?: {
        includeUnavailable?: boolean;
    }): Promise<PublicFederationObjectView | undefined>;
    listObjects(params?: PublicFederationListParams): Promise<PublicFederationObjectList>;
    pull(limit?: number): Promise<PublicFederationPullResult>;
    hideLocally(objectId: string, reason: string): Promise<void>;
}
//# sourceMappingURL=public-federation-replica.d.ts.map