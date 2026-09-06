import type { PathFilter } from './pathfilter.js';
export type VaultCatalogChangeKind = 'upsert' | 'delete';
export interface VaultCatalogChange {
    path: string;
    kind: VaultCatalogChangeKind;
}
export interface VaultCatalogFileStat {
    size: number;
    mtimeMs: number;
}
export type VaultCatalogListener = (path?: string, kind?: VaultCatalogChangeKind) => void;
export type VaultCatalogBatchListener = (changes?: readonly VaultCatalogChange[]) => void;
/**
 * Shared, disposable vault file inventory for the read models.
 *
 * Markdown remains authoritative. This class only coalesces the recursive
 * directory walk and filesystem watcher that search, metadata, and semantic
 * indexing would otherwise each maintain independently.
 */
export declare class VaultFileCatalog {
    private readonly pathFilter;
    private readonly cacheOwner;
    private readonly vaultPath;
    private readonly listeners;
    private readonly batchListeners;
    private paths;
    private allPaths;
    private refreshPromise;
    private watcher;
    private watcherStarted;
    private needsRefresh;
    private lastReconciledAt;
    private forceReconcile;
    private changeGeneration;
    private pendingChanges;
    private pendingFullRefresh;
    private pendingTimer;
    private flushPromise;
    private readBarrier;
    private closed;
    private readonly directoryCache;
    private readonly dirtyDirectories;
    private readonly statInFlight;
    private readonly statCache;
    constructor(vaultPath: string, pathFilter: PathFilter);
    private assertOpen;
    subscribe(listener: VaultCatalogListener): () => void;
    /** Subscribe to coalesced watcher changes so read models invalidate once per batch. */
    subscribeBatch(listener: VaultCatalogBatchListener): () => void;
    /** Mark a mutation already handled by the write path without broadcasting it twice. */
    invalidate(path?: string): void;
    /** Invalidate several direct mutations with one generation/cache update. */
    invalidateMany(changes?: readonly VaultCatalogChange[]): void;
    listNotePaths(): Promise<string[]>;
    /** Return the current immutable-by-convention note-path snapshot for read models. */
    notePathsSnapshot(): Promise<readonly string[]>;
    listAllPaths(): Promise<string[]>;
    /** Return the current immutable-by-convention all-path snapshot for read models. */
    allPathsSnapshot(): Promise<readonly string[]>;
    /** Drain received notifications before an index decides it is clean.
     * This joins the active batch; it neither sleeps for the debounce timer nor
     * waits indefinitely for future OS events/writers. Concurrent reads coalesce.
     */
    flushPendingEvents(): Promise<void>;
    /** Share concurrent file stat calls between read models without retaining file metadata. */
    statPaths(paths: readonly string[]): Promise<ReadonlyMap<string, VaultCatalogFileStat>>;
    private listInventory;
    close(): void;
    private statPath;
    private startWatcher;
    private onFilesystemEvent;
    private queueFullRefreshEvent;
    private scheduleFlush;
    private flushPendingChanges;
    private emit;
    private emitBatch;
    private refresh;
    private findPaths;
    private readDirectoryEntries;
    private markDirtyDirectories;
}
//# sourceMappingURL=vault-catalog.d.ts.map