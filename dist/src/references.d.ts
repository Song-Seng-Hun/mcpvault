import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class ReferenceService {
    private readonly fileSystem;
    private readonly access;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy);
    private resolveWikiLinkTarget;
    /**
     * Validate explicit references and automatically add resolvable Obsidian
     * wikilinks found in the body. Unresolved body links remain ordinary
     * Obsidian links and are reported by lint, while explicit references fail
     * loudly because they claim to be evidence.
     */
    validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal, content?: string): Promise<string[]>;
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