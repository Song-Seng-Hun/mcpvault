import type { BacklinkMatch, OrphanNotesResult, UnresolvedLinksResult } from './types.js';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
import type { VaultFileCatalog, VaultCatalogChangeKind } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
/**
 * Incremental Obsidian graph read model for backlinks, tags, unresolved links,
 * and orphan notes. It stores only parsed link/tag metadata and refreshes a
 * changed note, rather than rereading the entire vault for every request.
 */
export declare class VaultGraphIndex {
    private readonly pathFilter;
    private readonly frontmatter;
    private readonly catalog?;
    private readonly vaultIo;
    private readonly vaultPath;
    private readonly entries;
    private allPaths;
    private readonly dirty;
    private refreshPromise;
    private watcher;
    private watcherStarted;
    private initialized;
    private needsFullRefresh;
    private lastFullRefreshAt;
    private changeGeneration;
    private readonly visibilityCache;
    private readonly catalogUnsubscribe;
    constructor(vaultPath: string, pathFilter: PathFilter, frontmatter: FrontmatterHandler, catalog?: VaultFileCatalog | undefined, vaultIo?: VaultIoCoordinator);
    invalidate(path?: string, kind?: VaultCatalogChangeKind): void;
    close(): void;
    getBacklinks(path: string, limit: number, canAccessPath: (path: string) => boolean): Promise<{
        target: string;
        backlinks: BacklinkMatch[];
        total: number;
        truncated: boolean;
    }>;
    findUnresolvedLinks(limit: number, canAccessPath: (path: string) => boolean): Promise<UnresolvedLinksResult>;
    findOrphanNotes(limit: number, canAccessPath: (path: string) => boolean): Promise<OrphanNotesResult>;
    listAllTags(canAccessPath: (path: string) => boolean): Promise<Array<{
        tag: string;
        count: number;
    }>>;
    private ensure;
    private visibilityContext;
    private startWatcher;
    private refreshAll;
    private refreshDirty;
    private readEntry;
    private findNotePaths;
}
//# sourceMappingURL=vault-graph.d.ts.map