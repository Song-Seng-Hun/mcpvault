import { type DocumentStructure } from './document-structure.js';
/** Validates an entire admitted generation. The worker may resume individual
 * pages; its host must merge them before passing the complete generation here. */
export declare function pdfDocumentStructure(path: string, revision: string, result: any): DocumentStructure;
export declare function pdfRangeProvenance(doc: DocumentStructure, start: number, end: number): {
    page: number;
    startOffset: number;
    endOffset: number;
    bbox?: [number, number, number, number];
}[] | undefined;
//# sourceMappingURL=document-pdf.d.ts.map