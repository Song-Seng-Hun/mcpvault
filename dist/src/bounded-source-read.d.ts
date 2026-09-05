export declare class SourceReadLimitError extends Error {
    constructor();
}
/** Read a complete UTF-8 source or reject; never pass partial Markdown to a parser. */
export declare function readBoundedSource(path: string, maxBytes: number): Promise<string>;
//# sourceMappingURL=bounded-source-read.d.ts.map