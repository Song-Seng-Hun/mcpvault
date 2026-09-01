import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
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
    private readonly vaultPath;
    private readonly entries;
    private readonly filterIndex;
    private readonly dirty;
    private ready;
    private refreshPromise;
    private watcher;
    private needsFullRefresh;
    private lastFullRefreshAt;
    private firstList;
    constructor(vaultPath: string, pathFilter: PathFilter, frontmatter: FrontmatterHandler);
    invalidate(path: string, kind: 'upsert' | 'delete'): void;
    list(filters?: Record<string, unknown>): Promise<VaultIndexEntry[]>;
    /**
     * Check a previously returned revision without reopening the note body.
     * The stat check keeps the answer fresh even when a filesystem watcher is
     * unavailable; a later full refresh repairs metadata and hash state.
     */
    matchesRevision(path: string, expectedRevision: string): Promise<boolean>;
    close(): void;
    private startWatcher;
    private refreshAll;
    private refreshDirty;
    private readEntry;
    private rebuildFilterIndex;
    private addFilterEntry;
    private removeFilterEntry;
    private filterCandidates;
    private findNotePaths;
}
//# sourceMappingURL=vault-index.d.ts.map