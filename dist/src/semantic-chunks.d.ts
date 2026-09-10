export interface SemanticChunk {
    id: string;
    text: string;
    /** One-based physical Markdown line, including frontmatter. */
    line: number;
    /** Zero-based UTF-16 position in the authoritative Markdown string. */
    offset: number;
    bodyOffset: number;
}
/** The legacy default is retained until the quality/economy gate is measured. */
export declare function chunkDocumentForEmbedding(path: string, raw: string, structured?: boolean): SemanticChunk[];
/** Preserve legacy embedding text/IDs while mapping anchors to raw Markdown. */
export declare function chunkSemanticNote(path: string, raw: string): SemanticChunk[];
//# sourceMappingURL=semantic-chunks.d.ts.map