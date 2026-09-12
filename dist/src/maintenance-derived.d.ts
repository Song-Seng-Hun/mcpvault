import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { MaintenanceOperation } from './maintenance-host.js';
import type { MaintenanceDerivedAdapter, MaintenanceWriteIntent } from './maintenance-service.js';
export declare class MaintenanceDerivedService implements MaintenanceDerivedAdapter {
    private readonly fs;
    private readonly access;
    private readonly wiki;
    private readonly refreshCache;
    private readonly cacheEpoch;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService, refreshCache: (path: string, principal: ScopePrincipal) => Promise<void>);
    private accessible;
    private plan;
    inspect(operation: MaintenanceOperation, path: string, principal: ScopePrincipal): Promise<{
        fingerprint: string;
        revision: string;
        needed: boolean;
    }>;
    repair(operation: MaintenanceOperation, path: string, principal: ScopePrincipal, assertAccess: () => Promise<void>, recordIntent: (intent: MaintenanceWriteIntent) => Promise<void>, expected: {
        fingerprint: string;
        revision: string;
    }, assertCurrent?: () => void): Promise<{
        revision: string;
    }>;
}
//# sourceMappingURL=maintenance-derived.d.ts.map