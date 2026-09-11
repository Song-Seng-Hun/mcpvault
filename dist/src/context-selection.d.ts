import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { RetrievalService, RetrievalHit } from './retrieval-service.js';
import { type ContextIntent } from './context-rules.js';
import { type ContextPassageSelection } from './context-passages.js';
export interface SituationOptions {
    context: string;
    intent: ContextIntent;
    explain: boolean;
}
export declare function isSituationMemory(fm: Record<string, any>): boolean;
/** Metadata discovery reuses existing indexes. No prompt execution, body hydration,
 * cross-request cache, or private-memory aggregation. Eligibility precedes top-k. */
export declare function selectSituationCandidates(fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService, query: string, options: SituationOptions, principal?: ScopePrincipal, semantic?: boolean): Promise<{
    usedQuery: string;
    expanded: boolean;
    semantic: {
        state: 'disabled' | 'filtered' | 'available' | 'unavailable';
    };
    complete: boolean;
    results: RetrievalHit[];
    diagnostics: {
        physicalPath: string;
        revision: string;
        reason: string;
    }[];
    activatedPaths: string[];
}>;
/** Keep source units intact. A clipped unit becomes an exact continuation rather
 * than a sentence fragment that could hide a qualification. */
export declare function situationPassages(content: string, startLine: number, selected: ContextPassageSelection): {
    passages: import("./context-passages.js").ContextPassage[];
    truncated: boolean;
};
//# sourceMappingURL=context-selection.d.ts.map