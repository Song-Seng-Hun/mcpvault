import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import type { QueryNote } from './types.js';
export type BodyLink = ReturnType<typeof extractObsidianLinkOccurrences>[number];
export type ReadReferenceMetadata = (path: string, canRead: (path: string) => boolean) => Promise<QueryNote | undefined>;
export declare class ReferenceService {
    private readonly fileSystem;
    private readonly access;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy);
    private lexicalPath;
    private canonicalPath;
    private resolveWikiLinkTarget;
    private resolveBodyLink;
    /** Strict structured prose only. The domain supplies its authored-path policy
     * (including scope expansion), occurrence budget and separate field parsing.
     * Ordinary note-body permissiveness in validateAndNormalize is unchanged. */
    validateBodyLinks(links: readonly BodyLink[], containerPath: string, principal: ScopePrincipal | undefined, assertPath: (path: string) => void): Promise<string[]>;
    /** Request-local observations, not cached permissions or a current-state
     * promise. Callers retain their final access and revision guards. */
    createMetadataReader(principal?: ScopePrincipal): ReadReferenceMetadata;
    /**
     * Validate explicit references and automatically add resolvable Obsidian
     * wikilinks found in the body. Unresolved body links remain ordinary
     * Obsidian links and are reported by lint, while explicit references fail
     * loudly because they claim to be evidence.
     */
    validateAndNormalize(value: unknown, containerPath: string, principal?: ScopePrincipal, content?: string, policy?: {
        strictBodyLinks?: boolean;
    }): Promise<string[]>;
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