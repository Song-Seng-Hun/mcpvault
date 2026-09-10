import type { SearchService } from './search.js';
import type { CollaborationService } from './scopes.js';
import type { SemanticSearchService } from './semantic-search.js';
import type { SearchParams, SearchResult, ParsedNote, MemorySearchParams } from './types.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { FileSystemService } from './filesystem.js';
import { type FictionDomainSelection } from './fiction-domain.js';
export declare const RETRIEVAL_NOTE_BYTES: number;
export type RetrievalParams = SearchParams & {
    principal?: ScopePrincipal;
    excerptMode?: 'compact' | 'context';
    fictionDomain?: FictionDomainSelection;
};
export type RetrievalHit = SearchResult & {
    physicalPath?: string;
    scope?: string;
    context?: unknown;
    nextAction?: unknown;
};
export type RetrievalOutcome = {
    results: RetrievalHit[];
    usedQuery: string;
    expanded: boolean;
    semantic: {
        state: 'disabled' | 'filtered' | 'available' | 'unavailable';
    };
};
export type MemoryCandidateParams = MemorySearchParams & {
    principal?: ScopePrincipal;
};
export type MemoryCandidateOutcome = RetrievalOutcome & {
    complete: boolean;
};
export declare function constrainedQuery(query: string): boolean;
export declare function plainQueryExpansion(query: string): string | undefined;
export declare function bodyStartLine(note: ParsedNote): number;
export declare function passageAction(path: string, revision: string, startLine: number, endLine: number): {
    endpointId: string;
    arguments: {
        path: string;
        startLine: number;
        endLine: number;
        expectedRevision: string;
        maxChars: number;
    };
};
/** Shared adapter-independent retrieval. Indexes discover; current Markdown
 * supplies excerpt content. No persistent question/answer cache or model. */
export declare class RetrievalService {
    private readonly search;
    private readonly collaboration;
    private readonly semantic;
    private readonly access;
    private readonly fs;
    private skillEvolution?;
    attachSkillEvolution(service: NonNullable<RetrievalService['skillEvolution']>): void;
    projectSkillDiscovery(hits: RetrievalHit[], principal?: ScopePrincipal, admitted?: (path: string) => boolean): Promise<RetrievalHit[]>;
    skillDiscoveryAllowed(path: string): boolean;
    constructor(search: SearchService, collaboration: CollaborationService, semantic: Pick<SemanticSearchService, 'search'> & Partial<Pick<SemanticSearchService, 'memoryCandidates'>>, access: ScopeAccessPolicy, fs: FileSystemService);
    physical(hit: RetrievalHit, principal?: ScopePrincipal): string;
    /** Shared memory discovery only: up to 10,000 metadata hits, ex='', indexed
     * rv, no source hydration and no display/JSON cap. The caller owns bounded
     * current-revision body reads, exact matching and final response serialization.
     * complete=false forbids treating this result window as a lossless inventory. */
    memoryCandidates(params: MemoryCandidateParams): Promise<MemoryCandidateOutcome>;
    retrieve(params: RetrievalParams, allowExpansion?: boolean): Promise<RetrievalOutcome>;
    searchNotes(params: RetrievalParams): Promise<RetrievalHit[]>;
}
//# sourceMappingURL=retrieval-service.d.ts.map