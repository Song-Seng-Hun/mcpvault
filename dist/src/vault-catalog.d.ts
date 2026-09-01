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
    constructor(vaultPath: string, pathFilter: PathFilter);
    subscribe(listener: VaultCatalogListener): () => void;
    /** Mark a mutation already handled by the write path without broadcasting it twice. */
    invalidate(path?: string): void;
    listNotePaths(): Promise<string[]>;
    listAllPaths(): Promise<string[]>;
    private listInventory;
    close(): void;
    private startWatcher;
    private onFilesystemEvent;
    private emit;
    private refresh;
    private findPaths;
}
//# sourceMappingURL=vault-catalog.d.ts.map