import type { PathFilter } from './pathfilter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class ObsidianSearchService {
    private readonly vaultPath;
    private readonly pathFilter;
    private readonly access;
    constructor(vaultPath: string, pathFilter: PathFilter, access: ScopeAccessPolicy);
    search(params: {
        query: string;
        pathPrefix?: string;
        limit?: number;
        maxChars?: number;
        context?: boolean;
        caseSensitive?: boolean;
        principal?: ScopePrincipal;
    }): Promise<{
        backend: string;
        query: string;
        context: boolean;
        results: {
            p: string;
            ln?: number;
            ex?: string;
        }[];
        total: number;
        truncated: boolean;
    }>;
}
//# sourceMappingURL=obsidian-search.d.ts.map