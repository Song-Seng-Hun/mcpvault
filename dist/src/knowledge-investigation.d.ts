import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNote } from './types.js';
import { type KnowledgeInvestigation } from './knowledge-investigation-model.js';
/** A result is a report against a saved plan, not permission to execute it. */
export declare function prepareKnowledgeInvestigation(fs: FileSystemService, access: ScopeAccessPolicy, value: unknown, container: string, existing: QueryNote | undefined, principal?: ScopePrincipal): Promise<{
    investigation: KnowledgeInvestigation;
    guards: {
        path: string;
        expectedRevision: string;
    }[];
    assertAccess: () => void;
}>;
/** Bounded metadata projection. Read progress and matching revisions are not truth. */
export declare function inspectInvestigation(value: unknown, container: string, read: (path: string) => Promise<QueryNote | undefined>, access: ScopeAccessPolicy, principal?: ScopePrincipal): Promise<Record<string, any>>;
//# sourceMappingURL=knowledge-investigation.d.ts.map