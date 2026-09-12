import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type MaintenanceHost, type MaintenanceOperation } from './maintenance-host.js';
import type { MoveNoteParams } from './types.js';
import type { VaultCatalogChange } from './vault-catalog.js';
export interface MaintenanceWriteIntent {
    before: string;
    after: string;
    previousRevision: string;
    revision: string;
}
export interface MaintenanceDerivedAdapter {
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
export interface MaintenanceOptions {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    host?: MaintenanceHost;
    authorize: (accountId: string, operation: MaintenanceOperation) => Promise<ScopePrincipal | undefined>;
    schedule?: (callback: () => void) => () => void;
    derived?: MaintenanceDerivedAdapter;
    runAs?: <T>(principal: ScopePrincipal, operation: () => Promise<T>) => Promise<T>;
}
/** A private serialized host worker. Receipts attest exact past writes, never
 * present truth or permission. Unknown history is retained for review. */
export declare class MaintenanceService {
    private readonly options;
    private readonly epoch;
    private readonly resource;
    private readonly observed;
    private state;
    private writer;
    private initialized;
    private closed;
    private fatal;
    private tail;
    private cancel;
    private dispose?;
    private pendingPaths;
    private reconcile;
    private historyDirty;
    constructor(options: MaintenanceOptions);
    private serial;
    private config;
    private initialize;
    private validateState;
    private save;
    private authority;
    private runAs;
    private schedule;
    move(params: MoveNoteParams, principal?: ScopePrincipal): Promise<import("./types.js").MoveResult>;
    notify(changes?: readonly VaultCatalogChange[]): Promise<void>;
    private invalidateMoveObservation;
    flush(): Promise<void>;
    private currentRevision;
    private repairMove;
    private repairDerived;
    close(): Promise<void>;
    private assertCurrentJob;
}
//# sourceMappingURL=maintenance-service.d.ts.map