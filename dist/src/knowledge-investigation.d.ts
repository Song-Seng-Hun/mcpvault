import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNote, ParsedNoteContent } from './types.js';
import { type ReadReferenceMetadata } from './references.js';
import { type KnowledgeInvestigation } from './knowledge-investigation-model.js';
/** A result is a report against a saved plan, not permission to execute it. */
export declare function prepareKnowledgeInvestigation(fs: FileSystemService, access: ScopeAccessPolicy, value: unknown, container: string, existing: QueryNote | undefined, principal?: ScopePrincipal, readMetadata?: ReadReferenceMetadata): Promise<{
    investigation: KnowledgeInvestigation;
    guards: {
        path: string;
        expectedRevision: string;
    }[];
    assertAccess: () => void;
}>;
export declare function investigationReviewBasis(content: string, frontmatter: Record<string, any>): string;
/** Extend the existing review write with bounded related-note guards, not a workflow. */
export declare function writeInvestigationReview(fs: FileSystemService, access: ScopeAccessPolicy, params: {
    path: string;
    expectedRevision: string;
    principal?: ScopePrincipal;
    investigationEvidence?: unknown;
}, note: ParsedNoteContent, changes: Record<string, any>, claimId?: string): Promise<{
    revision: string;
    frontmatter: Record<string, any>;
}>;
/** Bounded projection. Read progress and matching revisions are not truth. */
export declare function inspectInvestigation(value: unknown, container: string, read: (path: string) => Promise<QueryNote | undefined>, access: ScopeAccessPolicy, principal?: ScopePrincipal, review?: {
    revision: string | undefined;
    readBasis: (note: QueryNote) => Promise<string | undefined>;
}): Promise<Record<string, any>>;
//# sourceMappingURL=knowledge-investigation.d.ts.map