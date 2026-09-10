import type { DocumentStructure, DocumentFragment } from './document-structure.js';
export interface DocumentRangeRequest {
    fragmentId?: string;
    relation?: 'self' | 'previous' | 'next' | 'parent';
    edge?: 'head' | 'tail';
    lineCount?: number;
    startLine?: number;
    endLine?: number;
    startOffset?: number;
    endOffset?: number;
    mode?: 'semantic' | 'exact';
}
export interface DocumentRange {
    startOffset: number;
    endOffset: number;
    role: 'requested' | 'heading' | 'table_header' | 'list_context' | 'prerequisite';
    fragmentId?: string;
}
export interface DocumentRangeSelection {
    ranges: DocumentRange[];
    fragment?: DocumentFragment;
    totalLines: number;
}
export declare function documentLineStarts(raw: string): number[];
export declare function documentLineAt(starts: number[], offset: number): number;
/** Structural context only, not an assertion that a model understood all qualifiers. */
export declare function selectDocumentRanges(doc: DocumentStructure, request: DocumentRangeRequest): DocumentRangeSelection;
//# sourceMappingURL=document-ranges.d.ts.map