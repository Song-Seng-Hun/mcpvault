import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNote } from './types.js';
/** Inspect only visible current metadata; never expose unavailable input identities. */
export declare function inspectSynthesisBasis(value: unknown, container: string, read: (path: string) => Promise<QueryNote>, access: ScopeAccessPolicy, principal?: ScopePrincipal): Promise<{
    state: string;
    changedInputIds?: never;
    historicalInputIds?: never;
    notice?: never;
} | {
    state: string;
    changedInputIds: string[];
    historicalInputIds: string[];
    notice: string;
}>;
/** Validates a supplied interpretation for the existing publication transaction.
 * No separate writer, source promotion, truth score, or automatic input update. */
export declare function prepareKnowledgeSynthesis(fs: FileSystemService, access: ScopeAccessPolicy, value: unknown, container: string, principal?: ScopePrincipal): Promise<{
    synthesis: import("./knowledge-synthesis-model.js").KnowledgeSynthesis;
    guards: {
        path: string;
        expectedRevision: string;
    }[];
    assertAccess: () => void;
}>;
//# sourceMappingURL=knowledge-synthesis.d.ts.map