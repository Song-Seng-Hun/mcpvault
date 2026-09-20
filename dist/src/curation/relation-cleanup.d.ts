import type { FileSystemService } from '../filesystem.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { ParsedNote } from '../types.js';
/** Remove exact duplicate occurrences only. No target resolution, alias folding,
 * reciprocal edge inference or changes to relation evidence/rationale. */
export declare function relationCleanup(note: Pick<ParsedNote, 'frontmatter' | 'revision'>, path: string): {
    status: 'review_required';
    partial: boolean;
    reason: string;
    removed?: never;
    changes?: never;
} | {
    partial?: never;
    reason?: never;
    status: 'ready';
    removed: number;
    changes: {
        path: string;
        expectedRevision: string;
        frontmatter: {
            set: Record<string, string[]>;
        };
    }[];
};
/** Wiki-owner read-only intent. The curation journal must independently require
 * exact host grants, historical managed receipts and guarded change-set apply. */
export declare function wikiRelationCleanup(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal | undefined, path: string, expectedRevision: string): Promise<{
    status: 'review_required';
    partial: boolean;
    reason: string;
    removed?: never;
    changes?: never;
} | {
    partial?: never;
    reason?: never;
    status: 'ready';
    removed: number;
    changes: {
        path: string;
        expectedRevision: string;
        frontmatter: {
            set: Record<string, string[]>;
        };
    }[];
}>;
//# sourceMappingURL=relation-cleanup.d.ts.map