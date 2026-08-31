import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class ReferenceService {
    private readonly fileSystem;
    private readonly access;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy);
    validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal): Promise<string[]>;
    resolve(value: unknown, principal?: ScopePrincipal, includeContent?: boolean, limit?: number, maxChars?: number): Promise<Record<string, unknown>[]>;
    readFromNote(params: {
        path: string;
        principal?: ScopePrincipal;
        includeContent?: boolean;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        source: string;
        references: Record<string, unknown>[];
        total: number;
    }>;
}
//# sourceMappingURL=references.d.ts.map