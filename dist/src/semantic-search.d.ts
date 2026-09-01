import type { PathFilter } from './pathfilter.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { SearchParams, SearchResult } from './types.js';
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
    private readonly vaultPath;
    private readonly indexPath;
    private readonly manifestPath;
    private manifest;
    private manifestReady;
    private db;
    private embedder;
    private pending;
    private idleTimer;
    private unloadTimer;
    private syncPromise;
    private unavailableUntil;
    private lastError;
    constructor(vaultPath: string, pathFilter: PathFilter, accessPolicy?: ScopeAccessPolicy);
    notifyChange(path: string, kind: ChangeKind): void;
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
    private getTableNames;
    private getEmbedder;
    private embed;
    private embedQuery;
    private indexPathContent;
    private removePath;
    private pathIsVisible;
    private markUnavailable;
}
export {};
//# sourceMappingURL=semantic-search.d.ts.map