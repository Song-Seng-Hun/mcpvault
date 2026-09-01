import type { PathFilter } from './pathfilter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { VaultIoCoordinator } from './vault-io.js';
export declare class ObsidianSearchService {
    private readonly vaultPath;
    private readonly pathFilter;
    private readonly access;
    private readonly vaultIo;
    private readonly cache;
    private readonly inFlight;
    private readonly cacheOwner;
    constructor(vaultPath: string, pathFilter: PathFilter, access: ScopeAccessPolicy, vaultIo?: VaultIoCoordinator);
    search(params: {
        query: string;
        pathPrefix?: string;
        limit?: number;
        maxChars?: number;
        context?: boolean;
        caseSensitive?: boolean;
        principal?: ScopePrincipal;
    }): Promise<{
        backend: 'obsidian';
        query: string;
        context: boolean;
        results: Array<Record<string, unknown>>;
        total: number;
        truncated: boolean;
    }>;
    private searchUncached;
    private deleteCache;
}
//# sourceMappingURL=obsidian-search.d.ts.map