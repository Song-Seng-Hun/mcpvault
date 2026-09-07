import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { VaultCatalogChange } from './vault-catalog.js';
export interface MocRegionOptions {
    path: string;
    operation: 'preview' | 'register' | 'regenerate' | 'stop' | 'status';
    pathPrefix?: string;
    expectedRevision?: string;
    expectedFingerprint?: string;
    maxChars?: number;
}
/** Trusted registrations are separate from editable Markdown. One queue, no polling. */
export declare class MocRegionService {
    private readonly vault;
    private readonly fs;
    private readonly access;
    private readonly authorize;
    private readonly readOnly;
    private registrations;
    private pending;
    private tail;
    private startup?;
    private timer;
    private closed;
    constructor(vault: string, fs: FileSystemService, access: ScopeAccessPolicy, authorize: (accountId: string) => Promise<ScopePrincipal | undefined>, readOnly?: boolean);
    private exclusive;
    private statePath;
    private save;
    start(): Promise<void>;
    private validatePath;
    private validatePrefix;
    private projection;
    run(principal: ScopePrincipal | undefined, options: MocRegionOptions): Promise<any>;
    private write;
    notify(changes?: readonly VaultCatalogChange[]): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=wiki-moc-regions.d.ts.map