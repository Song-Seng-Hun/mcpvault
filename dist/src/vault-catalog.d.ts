import type { PathFilter } from './pathfilter.js';
export type VaultCatalogChangeKind = 'upsert' | 'delete';
export type VaultCatalogListener = (path?: string, kind?: VaultCatalogChangeKind) => void;
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
    private paths;
    private allPaths;
    private refreshPromise;
    private watcher;
    private watcherStarted;
    private needsRefresh;
    private lastRefreshAt;
    private changeGeneration;
    private pendingChanges;
    private pendingFullRefresh;
    private pendingTimer;
    private flushPromise;
    private closed;
    private readonly directoryCache;
    private readonly dirtyDirectories;
    constructor(vaultPath: string, pathFilter: PathFilter);
    subscribe(listener: VaultCatalogListener): () => void;
    /** Mark a mutation already handled by the write path without broadcasting it twice. */
    invalidate(path?: string): void;
    listNotePaths(): Promise<string[]>;
    /** Return the current immutable-by-convention note-path snapshot for read models. */
    notePathsSnapshot(): Promise<readonly string[]>;
    listAllPaths(): Promise<string[]>;
    /** Return the current immutable-by-convention all-path snapshot for read models. */
    allPathsSnapshot(): Promise<readonly string[]>;
    private listInventory;
    close(): void;
    private startWatcher;
    private onFilesystemEvent;
    private queueFullRefreshEvent;
    private scheduleFlush;
    private flushPendingChanges;
    private emit;
    private refresh;
    private findPaths;
    private readDirectoryEntries;
    private markDirtyDirectories;
}
//# sourceMappingURL=vault-catalog.d.ts.map