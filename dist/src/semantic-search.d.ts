import type { PathFilter } from './pathfilter.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { VaultCatalogChange, VaultFileCatalog } from './vault-catalog.js';
import type { SearchParams, SearchResult, MemorySearchParams, MemorySearchOutcome } from './types.js';
import { VaultIoCoordinator } from './vault-io.js';
type ChangeKind = 'upsert' | 'delete';
interface SemanticSearchParams extends SearchParams {
    principal?: ScopePrincipal | undefined;
    signal?: AbortSignal;
}
export interface SemanticSearchOutcome {
    results: SearchResult[];
    available: boolean;
    indexed: number;
    pending: number;
    error?: string | undefined;
}
export interface MemorySemanticSearchOutcome extends MemorySearchOutcome {
    available: boolean;
}
export interface SemanticIndexStatus {
    enabled: true;
    model: string;
    available: boolean;
    indexed: number;
    pending: number;
    worker: 'process-shared';
    indexWorker: 'leader' | 'standby';
    indexingActive: boolean;
    lastError?: string | undefined;
}
/**
 * Optional semantic search cache. It is deliberately a cache, not a second
 * source of truth: Markdown and Git remain authoritative. All failures are
 * contained here so lexical search and the MCP server keep working.
 */
export declare class SemanticSearchService {
    private readonly pathFilter;
    private readonly accessPolicy;
    private readonly catalog?;
    private readonly vaultIo;
    private readonly excludePath;
    private readonly vaultPath;
    private readonly queryCacheOwner;
    private readonly vectorCacheOwner;
    private readonly queryCache;
    private readonly vectorCache;
    private readonly vectorInFlight;
    private queryGeneration;
    private indexPath;
    private readonly snapshotStorage;
    private manifest;
    private manifestReady;
    private pendingReady;
    private db;
    private readonly tableCache;
    private readonly tableLastUsed;
    private readonly tableOpening;
    private embedder;
    private embedderLease;
    private readonly inferenceAbort;
    private readonly inferenceTasks;
    private pending;
    private pendingSnapshotTimer;
    private pendingSnapshotWrite;
    private pendingSnapshotPending;
    private idleTimer;
    private unloadTimer;
    private activeSearches;
    private syncPromise;
    private scanPromise;
    private dbPromise;
    private semanticActive;
    private indexLease;
    private indexLeaseNonce;
    private indexWorker;
    private lastScanAt;
    private tableNamesCache;
    private tableNamesCachedAt;
    private unavailableUntil;
    private lastError;
    private readonly catalogUnsubscribe;
    constructor(vaultPath: string, pathFilter: PathFilter, accessPolicy?: ScopeAccessPolicy, catalog?: VaultFileCatalog | undefined, vaultIo?: VaultIoCoordinator, excludePath?: (path: string) => boolean, cacheDir?: string | undefined);
    notifyChange(path: string, kind: ChangeKind): void;
    notifyChanges(changes: readonly VaultCatalogChange[]): void;
    close(): Promise<void>;
    private clearQueryCache;
    private clearVectorCache;
    /** Query only disposable vector metadata. The caller has already selected
     * visible memory paths; no result/body hydration or predicate-cache reuse is
     * allowed here. Source revision/body verification belongs to its read budget. */
    memoryCandidates(params: MemorySearchParams & {
        principal?: ScopePrincipal;
        signal?: AbortSignal;
    }): Promise<MemorySemanticSearchOutcome>;
    search(params: SemanticSearchParams): Promise<SemanticSearchOutcome>;
    private searchCurrent;
    private hydrateRows;
    private changedQueryOutcome;
    status(): SemanticIndexStatus;
    private indexedCount;
    private pendingCount;
    private loadManifest;
    private validatedManifest;
    private saveManifest;
    private loadPendingSnapshot;
    private queuePendingSnapshotSave;
    private flushPendingSnapshot;
    private scheduleIdleWork;
    private runIdleWork;
    private scanForChanges;
    private findMarkdownFiles;
    private drain;
    private indexDirectory;
    private getDb;
    private getTable;
    /**
     * Coordinate document indexing across separately spawned MCP processes.
     * The first process that opts into server-side semantic search becomes the
     * leader. Other processes can query the shared derived cache, but never
     * start a second indexing worker.
     */
    private acquireIndexLease;
    private releaseIndexLease;
    private getTableNames;
    private getEmbedder;
    private scheduleResourceRelease;
    private withInference;
    private embed;
    private embedDirect;
    private embedQuery;
    private computeQuery;
    private embedMany;
    private prepareIndex;
    private reusableVectors;
    private applyIndexBatch;
    private pathIsVisible;
    private pathCanBeIndexed;
    private markUnavailable;
}
export {};
//# sourceMappingURL=semantic-search.d.ts.map