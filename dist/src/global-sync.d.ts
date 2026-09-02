import type { Server as NetServer } from 'node:net';
declare const PROTOCOL: 'mcpvault-global-sync/v1';
export type GlobalSyncOperation = 'upsert' | 'tombstone';
export type GlobalProposalStatus = 'pending' | 'approved' | 'rejected' | 'conflict';
export interface GlobalRevision {
    revisionId: string;
    documentId: string;
    sequence: number;
    parentRevision?: string;
    operation: GlobalSyncOperation;
    contentHash?: string;
    byteLength: number;
    author: string;
    reason: string;
    origin: string;
    createdAt: string;
    signature: string;
}
export interface GlobalManifestEntry {
    documentId: string;
    revisionId: string;
    sequence: number;
    parentRevision?: string;
    operation: GlobalSyncOperation;
    contentHash?: string;
}
export interface GlobalManifest {
    protocol: typeof PROTOCOL;
    hubId: string;
    cursor: number;
    entries: GlobalManifestEntry[];
    hasMore: boolean;
    signature: string;
}
export interface GlobalRevisionWithContent extends GlobalRevision {
    content?: string;
}
export interface GlobalProposal {
    proposalId: string;
    documentId: string;
    parentRevision?: string;
    operation: GlobalSyncOperation;
    contentHash?: string;
    byteLength: number;
    author: string;
    reason: string;
    origin: string;
    createdAt: string;
    status: GlobalProposalStatus;
    approvals?: string[];
    decisionReason?: string;
    decidedAt?: string;
}
export interface GlobalAuditResult {
    ok: boolean;
    checkedRevisions: number;
    checkedObjects: number;
    errors: string[];
}
export interface GlobalProposalList {
    proposals: GlobalProposal[];
    total: number;
    truncated: boolean;
}
export interface GlobalSyncHubOptions {
    hubId?: string;
    signingPrivateKey?: string;
}
export interface GlobalSyncChangeInput {
    documentId: string;
    parentRevision?: string;
    operation?: GlobalSyncOperation;
    content?: string;
    author: string;
    reason: string;
    origin: string;
}
export declare function generateGlobalSyncSigningKeyPair(): {
    privateKey: string;
    publicKey: string;
};
/**
 * Append-only Global authority. It stores metadata in a rebuildable state
 * snapshot and content in immutable, hash-addressed objects. No physical
 * document deletion operation exists: deletion is a reviewable tombstone.
 */
export declare class GlobalSyncHub {
    private readonly root;
    private readonly statePath;
    private readonly eventPath;
    private readonly objectRoot;
    private readonly hubId;
    private readonly signingPrivateKey;
    private readonly signingPublicKey;
    private readonly approvalQuorum;
    private readonly originWindows;
    private state;
    private initialized;
    private mutationTail;
    constructor(root: string, options?: GlobalSyncHubOptions);
    getPublicKey(): string;
    exportSigningPrivateKey(): string;
    private ensureLoaded;
    private withMutation;
    private appendEvent;
    private objectPath;
    private storeContent;
    private enforceProposalQuota;
    private currentRevision;
    submitProposal(input: GlobalSyncChangeInput): Promise<GlobalProposal>;
    getManifest(after?: number, limit?: number): Promise<GlobalManifest>;
    getRevision(revisionId: string): Promise<GlobalRevisionWithContent>;
    listProposals(status?: GlobalProposalStatus, limit?: number): Promise<GlobalProposalList>;
    approveProposal(proposalId: string, reviewer: string, reason: string): Promise<{
        status: 'pending' | 'approved' | 'conflict';
        proposal: GlobalProposal;
        revision?: GlobalRevision;
        currentRevision?: string;
    }>;
    rejectProposal(proposalId: string, reviewer: string, reason: string): Promise<GlobalProposal>;
    restoreDocument(documentIdInput: string, targetRevisionId: string, reviewer: string, reason: string, expectedCurrentRevision?: string): Promise<GlobalRevision>;
    audit(): Promise<GlobalAuditResult>;
}
export interface GlobalSyncClientOptions {
    baseUrl: string;
    authToken: string;
    reviewerToken?: string;
}
/** Small HTTP client used by a vault replica; it never sends User or Community paths. */
export declare class GlobalSyncClient {
    private readonly baseUrl;
    private readonly authToken;
    private readonly reviewerToken?;
    constructor(options: GlobalSyncClientOptions);
    private request;
    getManifest(after?: number, limit?: number): Promise<GlobalManifest>;
    getRevision(revisionId: string): Promise<GlobalRevisionWithContent>;
    submitProposal(input: GlobalSyncChangeInput): Promise<GlobalProposal>;
    listProposals(status?: GlobalProposalStatus, limit?: number): Promise<GlobalProposalList>;
    approveProposal(proposalId: string, reviewer: string, reason: string): Promise<{
        status: 'pending' | 'approved' | 'conflict';
        proposal: GlobalProposal;
        revision?: GlobalRevision;
        currentRevision?: string;
    }>;
    rejectProposal(proposalId: string, reviewer: string, reason: string): Promise<GlobalProposal>;
    restoreDocument(documentId: string, targetRevisionId: string, reviewer: string, reason: string, expectedCurrentRevision?: string): Promise<GlobalRevision>;
}
export interface GlobalSyncReplicaOptions {
    vaultPath: string;
    client: Pick<GlobalSyncClient, 'getManifest' | 'getRevision' | 'submitProposal'>;
    trustedPublicKey: string;
}
export interface GlobalPullResult {
    applied: string[];
    conflicts: Array<{
        documentId: string;
        revisionId: string;
        reason: string;
    }>;
    cursor: number;
    hasMore: boolean;
}
/** Pull-only replica. Local edits are never overwritten; remote tombstones are recoverable moves. */
export declare class GlobalSyncReplica {
    private readonly vaultPath;
    private readonly statePath;
    private readonly backupRoot;
    private readonly quarantineRoot;
    private readonly client;
    private readonly trustedPublicKey;
    private state;
    private loaded;
    constructor(options: GlobalSyncReplicaOptions);
    private load;
    private save;
    private localPath;
    private currentContent;
    private backup;
    pull(limit?: number): Promise<GlobalPullResult>;
    proposeLocal(documentId: string, author: string, reason: string, origin: string): Promise<GlobalProposal>;
    proposeTombstone(documentId: string, author: string, reason: string, origin: string): Promise<GlobalProposal>;
}
export interface GlobalSyncHubHttpOptions {
    host?: string;
    port?: number;
    authToken: string;
    reviewerToken: string;
    reviewerTokens?: Record<string, string>;
    maxBodyBytes?: number;
    hubId?: string;
    signingKeyPath?: string;
    proposerOrigin?: string;
    tls?: {
        key: string;
        cert: string;
        ca?: string;
        requestCert?: boolean;
        rejectUnauthorized?: boolean;
    };
    maxConnections?: number;
}
export interface GlobalSyncHubHttpHandle {
    server: NetServer;
    host: string;
    port: number;
    hub: GlobalSyncHub;
    close(): Promise<void>;
}
/** Optional standalone HTTP control plane for a GlobalSyncHub. */
export declare function startGlobalSyncHub(root: string, options: GlobalSyncHubHttpOptions): Promise<GlobalSyncHubHttpHandle>;
export {};
//# sourceMappingURL=global-sync.d.ts.map