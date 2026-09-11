import type { DocumentIndex } from './document-index.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { RetrievalService } from './retrieval-service.js';
export interface DocumentSearchParams {
    query: string;
    path?: string;
    expectedRevision?: string;
    principal?: ScopePrincipal;
    limit?: number;
    maxChars?: number;
    cursor?: string;
    resourceCursor?: string;
    semantic?: boolean;
}
export declare class DocumentSearch {
    readonly index: DocumentIndex;
    readonly retrieval?: Pick<RetrievalService, 'searchNotes' | 'skillDiscoveryAllowed'> | undefined;
    constructor(index: DocumentIndex, retrieval?: Pick<RetrievalService, 'searchNotes' | 'skillDiscoveryAllowed'> | undefined);
    search(params: DocumentSearchParams): Promise<import("./work-model.js").WorkPage>;
}
//# sourceMappingURL=document-search.d.ts.map