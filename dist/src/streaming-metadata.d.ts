/** Collect only the existing frontmatter parser's leading input. A header may
 * be arbitrarily long/unclosed: the source reader, not this projection, caps it.
 * Chunk arrays avoid quadratic concatenation while finding split delimiters. */
export declare class HeaderCollector {
    private opener;
    private decided;
    private done;
    private readonly parts;
    private tail;
    write(text: string): void;
    private capture;
    finish(): string;
}
export interface Utf8MetadataSource {
    readonly header: string;
    readonly revision: string;
}
/** Header and digest come from the same opened file/decoded stream, not two
 * reads. Does not promise snapshot isolation from external in-place writers. */
export declare function readUtf8MetadataSource(path: string, maxBytes?: number): Promise<Utf8MetadataSource>;
//# sourceMappingURL=streaming-metadata.d.ts.map