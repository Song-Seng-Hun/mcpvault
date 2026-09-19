import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
export interface ComputerFact {
    key: string;
    category: 'hardware' | 'software' | 'path' | 'constraint';
    value: string;
    basis: 'observed' | 'reported' | 'inferred';
    source: string;
    observedAt: string;
}
/** Worldview companion, not a second game engine or a hardware authority.
 * Catalogs use existing private scope ACLs and filesystem revision guards.
 * Session selection never updates the shared fictional event journal. */
export declare class ComputerWorldService {
    private readonly fs;
    private readonly access;
    private readonly options;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, options: {
        assertActor: () => Promise<void>;
        readOnly?: boolean;
        changed?: (path: string) => void;
    });
    private assert;
    private location;
    private load;
    private save;
    execute(params: Record<string, any>, principal?: ScopePrincipal): Promise<any>;
    private pack;
    /** Internal read-only receipt check for evolution. No new endpoint or execution grant. */
    verifyUpdate(params: Record<string, any>, principal: ScopePrincipal): Promise<string | undefined>;
}
//# sourceMappingURL=computer-worlds.d.ts.map