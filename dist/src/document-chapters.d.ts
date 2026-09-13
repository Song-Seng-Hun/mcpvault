import type { DocumentStructure } from './document-structure.js';
export declare const DOCUMENT_CHAPTER_PROFILE = "mcpvault-source-chapters-v1";
export interface DocumentChapter {
    id: string;
    kind: 'chapter' | 'source_reference';
    status: 'source_projection';
    identity: 'content' | 'ambiguous';
    title: string;
    description: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    position: number;
    previous?: string;
    next?: string;
    reason?: 'indivisible_source_unit';
}
/** Exact, disposable source projection. IDs survive only unambiguous unchanged
 * content at the same path; durable IDs across moves/edits require a bundle ledger.
 * Source descriptions are untrusted discovery data, never rule authority. */
export declare function documentChapters(doc: DocumentStructure): DocumentChapter[];
//# sourceMappingURL=document-chapters.d.ts.map