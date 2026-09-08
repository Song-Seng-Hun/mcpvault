export declare const PUBLIC_FEDERATION_PROTOCOL: 'mcpvault-public-federation/v1';
export interface PublicFederationIdentity {
    origin: string;
    agentId: string;
    role?: 'publisher' | 'moderator';
}
interface PublicRecordBase {
    protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
    version: 1;
    recordId: string;
    actorId: string;
    revision: number;
}
export interface PublicActorRecord extends PublicRecordBase {
    type: 'actor';
    origin: string;
    agentId: string;
}
export interface PublicProfileRecord extends PublicRecordBase {
    type: 'profile';
    displayName: string;
    bio?: string;
}
export interface PublicPostRecord extends PublicRecordBase {
    type: 'post';
    objectId: string;
    title: string;
    body: string;
}
export interface PublicCommentRecord extends PublicRecordBase {
    type: 'comment';
    objectId: string;
    postId: string;
    replyTo?: string;
    body: string;
}
export interface PublicUpdateRecord extends PublicRecordBase {
    type: 'update';
    objectId: string;
    targetObjectId: string;
    title?: string;
    body?: string;
    displayName?: string;
    bio?: string;
}
export interface PublicTombstoneRecord extends PublicRecordBase {
    type: 'tombstone';
    objectId: string;
    targetObjectId: string;
    reason: string;
}
export type PublicFederationRecord = PublicActorRecord | PublicProfileRecord | PublicPostRecord | PublicCommentRecord | PublicUpdateRecord | PublicTombstoneRecord;
export type PublicPublishInput = {
    type: 'actor';
    actorId: string;
    expectedRevision: 0;
} | {
    type: 'profile';
    actorId: string;
    expectedRevision: number;
    displayName: string;
    bio?: string;
} | {
    type: 'post';
    objectId: string;
    actorId: string;
    expectedRevision: 0;
    title: string;
    body: string;
} | {
    type: 'comment';
    objectId: string;
    actorId: string;
    expectedRevision: 0;
    postId: string;
    replyTo?: string;
    body: string;
} | {
    type: 'update';
    objectId: string;
    actorId: string;
    targetObjectId: string;
    expectedRevision: number;
    title?: string;
    body?: string;
    displayName?: string;
    bio?: string;
} | {
    type: 'tombstone';
    objectId: string;
    actorId: string;
    targetObjectId: string;
    expectedRevision: number;
    reason: string;
};
export interface PublicModerationInput {
    objectId: string;
    action: 'hide' | 'restore';
    reason: string;
    expectedRevision: number;
}
export interface PublicModerationRecord {
    protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
    version: 1;
    type: 'moderation';
    recordId: string;
    objectId: string;
    action: 'hide' | 'restore';
    reason: string;
    moderator: PublicFederationIdentity;
    revision: number;
}
export interface PublicFederationEvent {
    eventId: string;
    sequence: number;
    previousHash: string;
    record: PublicFederationRecord | PublicModerationRecord;
    status: 'active' | 'pending-parent';
    publishedAt: string;
    idempotencyHash: string;
    eventHash: string;
    signature: string;
}
export interface PublicFederationFeed {
    protocol: typeof PUBLIC_FEDERATION_PROTOCOL;
    hubId: string;
    after: number;
    anchorHash: string;
    cursor: number;
    latestSequence: number;
    hasMore: boolean;
    events: PublicFederationEvent[];
    signature: string;
}
export interface PublicFederationHubOptions {
    hubId?: string;
    signingPrivateKey?: string;
    maxRecords?: number;
}
export declare function makePublicActorId(origin: string, agentId: string): string;
export declare function makePublicObjectId(kind: 'post' | 'comment' | 'update' | 'tombstone', origin: string, agentId: string, localId: string): string;
/** Pure transport preflight used before a local SocialService mutation. */
export declare function validatePublicPublishInput(input: PublicPublishInput, identity: PublicFederationIdentity): PublicFederationRecord;
export declare function verifyPublicFederationEvent(event: PublicFederationEvent, publicKeyPem: string): boolean;
export declare function verifyPublicFederationFeed(feed: PublicFederationFeed, publicKeyPem: string): boolean;
export declare class PublicFederationHub {
    private readonly root;
    private readonly recordsRoot;
    private readonly hubId;
    private readonly signingPrivateKey;
    private readonly signingPublicKey;
    private readonly maxRecords;
    private readonly processLockPath;
    private readonly events;
    private readonly objects;
    private readonly idempotency;
    private initialized;
    private loadPromise;
    private mutationTail;
    private closed;
    private processLock;
    constructor(root: string, options?: PublicFederationHubOptions);
    getPublicKey(): string;
    exportSigningPrivateKey(): string;
    private ensureLoaded;
    private load;
    private apply;
    private withMutation;
    private eventForId;
    publish(input: PublicPublishInput, rawIdentity: PublicFederationIdentity, idempotencyKey: string): Promise<PublicFederationEvent>;
    moderate(input: PublicModerationInput, rawIdentity: PublicFederationIdentity, idempotencyKey: string): Promise<PublicFederationEvent>;
    getFeed(after?: number, limit?: number): Promise<PublicFederationFeed>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=public-federation.d.ts.map