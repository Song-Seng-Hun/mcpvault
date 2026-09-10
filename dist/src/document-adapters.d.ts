import type { DocumentStructure } from './document-structure.js';
import { pdfRangeProvenance } from './document-pdf.js';
export interface DocumentRecord {
    id: string;
    text: string;
    metadata: {
        path: string;
        revision: string;
        profile: string;
        kind: string;
        headingPath: string[];
        description: string;
    };
    locator: {
        unit: string;
        startOffset: number;
        endOffset: number;
        startLine: number;
        endLine: number;
    };
    relationships: {
        parent?: string;
        previous?: string;
        next?: string;
        children: string[];
        references: string[];
    };
    pdfProvenance?: ReturnType<typeof pdfRangeProvenance>;
}
/** Call only on a currently authorized DocumentIndex result. No fetching, model
 * calls or framework constructors occur here; consumers own their scoped store.
 * Explicit publicPath avoids exporting physical private-scope paths by accident. */
export declare function documentRecords(doc: DocumentStructure, publicPath: string, options?: {
    includeContainers?: boolean;
}): DocumentRecord[];
/** Structural data accepted by LangChain Document constructors (no dependency). */
export declare function toLangChainDocument(record: DocumentRecord): {
    id: string;
    pageContent: string;
    metadata: {
        path: string;
        revision: string;
        profile: string;
        kind: string;
        headingPath: string[];
        description: string;
        locator: {
            unit: string;
            startOffset: number;
            endOffset: number;
            startLine: number;
            endLine: number;
        };
        relationships: {
            parent?: string;
            previous?: string;
            next?: string;
            children: string[];
            references: string[];
        };
        pdfProvenance?: {
            page: number;
            startOffset: number;
            endOffset: number;
            bbox?: [number, number, number, number];
        }[];
    };
};
/** TextNode constructor data; relationships remain neutral metadata rather than
 * pretending strings are a version-specific LlamaIndex RelatedNodeInfo API. */
export declare function toLlamaIndexNode(record: DocumentRecord): {
    id_: string;
    text: string;
    metadata: {
        path: string;
        revision: string;
        profile: string;
        kind: string;
        headingPath: string[];
        description: string;
        locator: {
            unit: string;
            startOffset: number;
            endOffset: number;
            startLine: number;
            endLine: number;
        };
        sourceRelationships: {
            parent?: string;
            previous?: string;
            next?: string;
            children: string[];
            references: string[];
        };
        pdfProvenance?: {
            page: number;
            startOffset: number;
            endOffset: number;
            bbox?: [number, number, number, number];
        }[];
    };
};
//# sourceMappingURL=document-adapters.d.ts.map