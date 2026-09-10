/** Bump when source mapping, fragment kinds, references or identity semantics change. */
export declare const DOCUMENT_STRUCTURE_PROFILE = "mcpvault-document-structure-v1";
export interface DocumentStructure {
    path: string;
    revision: string;
    profile: string;
    raw: string;
    title: string;
    fragments: DocumentFragment[];
    /** Binary resources use extracted offsets, never physical PDF source lines. */
    locator?: string;
    gaps?: string[];
    pdfPages?: {
        page: number;
        startOffset: number;
        endOffset: number;
        status: 'ok' | 'failed';
        regions: {
            startOffset: number;
            endOffset: number;
            bbox: [number, number, number, number];
        }[];
    }[];
}
export interface DocumentFragment {
    id: string;
    kind: string;
    /** One-based physical source lines, including frontmatter; endLine is inclusive. */
    startLine: number;
    endLine: number;
    /** Zero-based UTF-16 half-open source range. Newline bytes stay in raw. */
    startOffset: number;
    endOffset: number;
    headingPath: string[];
    description: string;
    parent?: string;
    children: string[];
    previous?: string;
    next?: string;
    /** Explicit targets, not resolved fragment IDs: wiki target, URL or [^footnote]. */
    references: string[];
}
/** Pure synchronous parsing. Refuses excessive bytes/nodes/depth rather than truncating. */
export declare function parseDocumentStructure(input: {
    path: string;
    raw: string;
    revision?: string;
    format?: 'markdown' | 'text';
}): DocumentStructure;
export declare function fragmentText(document: DocumentStructure, fragment: DocumentFragment): string;
//# sourceMappingURL=document-structure.d.ts.map