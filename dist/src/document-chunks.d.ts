import type { DocumentStructure } from './document-structure.js';
import type { SemanticChunk } from './semantic-chunks.js';
export declare const DOCUMENT_CHUNK_PROFILE = "structure-byte448-v1";
export declare const STRUCTURED_DOCUMENTS_ENABLED: boolean;
export declare const MAX_STRUCTURED_CHUNKS = 65536;
export declare function assertDocumentEmbeddingTokens(text: string, tokenizer?: {
    encode(text: string, options?: {
        add_special_tokens?: boolean;
    }): number[];
}): void;
export interface StructuredSemanticChunk extends SemanticChunk {
    endOffset: number;
    fragmentIds: string[];
    contextTruncated: boolean;
}
/** Complete, deterministic source partition; byte budget is conservative and
 * production embedding additionally verifies the pinned tokenizer's 512-token limit. */
export declare function chunkStructuredDocument(doc: DocumentStructure): StructuredSemanticChunk[];
//# sourceMappingURL=document-chunks.d.ts.map