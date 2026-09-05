import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
import type { VaultCatalogChange, VaultFileCatalog } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
import type { AuthorityShelfResult } from './types.js';
export interface VaultIndexEntry {
    path: string;
    frontmatter: Record<string, any>;
    revision: string;
    size: number;
    mtimeMs: number;
}
/**
 * A disposable, metadata-only read model for repeated structured queries.
 * Markdown remains authoritative; this index only avoids reopening and
 * reparsing every note for every pulse/community query.
 */
export declare class VaultMetadataIndex {
    private readonly pathFilter;
    private readonly frontmatter;
    private readonly catalog?;
    private readonly vaultIo;
    private readonly vaultPath;
    private readonly cacheOwner;
    private readonly entries;
    private readonly filterIndex;
    private readonly pathIndex;
    private readonly authoritySchemeIndex;
    private readonly authorityPairIndex;
    private readonly queryCache;
    private readonly sortedQueryCache;
    private referenceIndex;
    private queryCacheRows;
    private sortedQueryCacheRows;
    private readonly dirty;
    private readonly snapshotReady;
    private ready;
    private refreshPromise;
    private snapshotWrite;
    private snapshotTimer;
    private snapshotPending;
    private closed;
    private watcher;
    private watcherStarted;
    private readonly catalogUnsubscribe;
    private needsFullRefresh;
    private changeGeneration;
    private forceFullRead;
    private lastFullRefreshAt;
    private firstList;
    constructor(vaultPath: string, pathFilter: PathFilter, frontmatter: FrontmatterHandler, catalog?: VaultFileCatalog | undefined, vaultIo?: VaultIoCoordinator);
    invalidate(path: string, kind: 'upsert' | 'delete'): void;
    invalidateMany(changes: readonly VaultCatalogChange[]): void;
    private invalidateAll;
    private clearQueryCaches;
    /** Resolve a visible Obsidian note identity from the disposable metadata
     * read model. The identity map is rebuilt only after metadata invalidation;
     * Markdown and current frontmatter entries remain authoritative. */
    resolveNoteReference(document: string, canAccessPath?: (path: string) => boolean, sourcePath?: string): Promise<string[]>;
    list(filters?: Record<string, unknown>, pathPrefix?: string): Promise<VaultIndexEntry[]>;
    /** Count metadata candidates without sorting or reading note bodies. */
    count(filters?: Record<string, unknown>, pathPrefix?: string, canAccessPath?: (path: string) => boolean, predicate?: (entry: VaultIndexEntry) => boolean): Promise<number>;
    /**
     * Read a bounded exact-path metadata set without reopening note bodies.
     * Request order is preserved, duplicate paths are collapsed, and caller
     * visibility is applied before any entry leaves the disposable index.
     */
    getMany(paths: readonly string[], canAccessPath?: (path: string) => boolean): Promise<VaultIndexEntry[]>;
    listSorted(filters?: Record<string, unknown>, pathPrefix?: string, sortBy?: string, sortOrder?: 'asc' | 'desc'): Promise<VaultIndexEntry[]>;
    /**
     * Select a bounded page without materializing a fully sorted candidate list.
     * Exact totals intentionally stay on listSorted/queryNotes' older path;
     * page-only callers only need limit+1 to determine truncation.
     */
    listSortedPage(params: {
        filters?: Record<string, unknown>;
        pathPrefix?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        limit: number;
        offset?: number;
        after?: {
            path: string;
            value?: unknown;
            missing?: boolean;
        };
        canAccessPath?: (path: string) => boolean;
        canReadEntry?: (entry: VaultIndexEntry) => boolean;
    }): Promise<{
        entries: VaultIndexEntry[];
        truncated: boolean;
    }>;
    /**
     * Check a previously returned revision without reopening the note body.
     * The stat check keeps the answer fresh even when a filesystem watcher is
     * unavailable; a later full refresh repairs metadata and hash state.
     */
    matchesRevision(path: string, expectedRevision: string): Promise<boolean>;
    /**
     * Return one visibility-filtered authority shelf. Authority metadata is an
     * acceleration index only; current Markdown/frontmatter entries remain the
     * source of truth. Filtering happens before totals and collision detection
     * so hidden notes cannot leak through aggregate metadata.
     */
    queryAuthorityShelf(params: {
        scheme: string;
        aroundAuthorityId?: string;
        includeUnclassified?: boolean;
        limit?: number;
    }, canAccessPath?: (path: string) => boolean): Promise<AuthorityShelfResult>;
    close(): Promise<void>;
    private ensureFresh;
    private candidatePaths;
    private iterateCandidateEntries;
    private startWatcher;
    private refreshAll;
    private refreshDirty;
    private readBatch;
    private readEntry;
    private initialize;
    private loadSnapshot;
    private scheduleSnapshotSave;
    private flushSnapshot;
    private rebuildFilterIndex;
    private rebuildPathIndex;
    private rebuildAuthorityIndex;
    private addAuthorityEntry;
    private removeAuthorityEntry;
    private addPathEntry;
    private removePathEntry;
    private addFilterEntry;
    private removeFilterEntry;
    private filterCandidates;
    private findNotePaths;
}
//# sourceMappingURL=vault-index.d.ts.map