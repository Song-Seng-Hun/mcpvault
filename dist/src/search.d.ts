import type { PathFilter } from './pathfilter.js';
import type { SearchParams, SearchResult } from './types.js';
export declare class SearchService {
    private pathFilter;
    private vaultPath;
    private readonly cache;
    private readonly inFlight;
    private cacheGeneration;
    constructor(vaultPath: string, pathFilter: PathFilter);
    /**
     * Search is derived from Markdown, so a short cache is safe and useful for
     * repeated agent lookups. Writers call this immediately after a mutation;
     * the TTL also covers edits made directly in Obsidian.
     */
    invalidate(): void;
    search(params: SearchParams): Promise<SearchResult[]>;
    private findMarkdownFiles;
    private rerank;
}
//# sourceMappingURL=search.d.ts.map