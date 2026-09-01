import type { PathFilter } from './pathfilter.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import type { SearchParams, SearchResult } from './types.js';
import { VaultIoCoordinator } from './vault-io.js';
type ChangeKind = 'upsert' | 'delete';
interface SemanticSearchParams extends SearchParams {
    principal?: ScopePrincipal | undefined;
}
export interface SemanticSearchOutcome {
    results: SearchResult[];
    available: boolean;
    indexed: number;
    pending: number;
    error?: string | undefined;
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
    private readonly vaultPath;
    private readonly queryCacheOwner;
    private readonly queryCache;
    private queryGeneration;
    private readonly indexPath;
    private readonly manifestPath;
    private readonly workerLockPath;
    private manifest;
    private manifestReady;
    private db;
    private embedder;
    private embedderLease;
    private pending;
    private idleTimer;
    private unloadTimer;
    private syncPromise;
    private scanPromise;
    private dbPromise;
    private semanticActive;
    private indexLease;
    private indexWorker;
    private lastScanAt;
    private tableNamesCache;
    private tableNamesCachedAt;
    private unavailableUntil;
    private lastError;
    private readonly catalogUnsubscribe;
    constructor(vaultPath: string, pathFilter: PathFilter, accessPolicy?: ScopeAccessPolicy, catalog?: VaultFileCatalog | undefined, vaultIo?: VaultIoCoordinator);
    notifyChange(path: string, kind: ChangeKind): void;
    close(): void;
    private clearQueryCache;
    search(params: SemanticSearchParams): Promise<SemanticSearchOutcome>;
    status(): SemanticIndexStatus;
    private indexedCount;
    private loadManifest;
    private saveManifest;
    private scheduleIdleWork;
    private runIdleWork;
    private scanForChanges;
    private findMarkdownFiles;
    private drain;
    private getDb;
    /**
     * Coordinate document indexing across separately spawned MCP processes.
     * The first process that opts into server-side semantic search becomes the
     * leader. Other processes can query the shared derived cache, but never
     * start a second indexing worker.
     */
    private acquireIndexLease;
    private getTableNames;
    private getEmbedder;
    private embed;
    private embedMany;
    private prepareIndex;
    private applyIndexBatch;
    private pathIsVisible;
    private markUnavailable;
}
export {};
//# sourceMappingURL=semantic-search.d.ts.map