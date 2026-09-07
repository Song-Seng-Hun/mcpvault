import type { SearchService } from './search.js';
import type { CollaborationService } from './scopes.js';
import type { SemanticSearchService } from './semantic-search.js';
import type { SearchParams, SearchResult, ParsedNote } from './types.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { FileSystemService } from './filesystem.js';
export declare const RETRIEVAL_NOTE_BYTES: number;
export type RetrievalParams = SearchParams & {
    principal?: ScopePrincipal;
    excerptMode?: 'compact' | 'context';
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
    constructor(search: SearchService, collaboration: CollaborationService, semantic: Pick<SemanticSearchService, 'search'>, access: ScopeAccessPolicy, fs: FileSystemService);
    physical(hit: RetrievalHit, principal?: ScopePrincipal): string;
    retrieve(params: RetrievalParams, allowExpansion?: boolean): Promise<RetrievalOutcome>;
    searchNotes(params: RetrievalParams): Promise<RetrievalHit[]>;
}
//# sourceMappingURL=retrieval-service.d.ts.map