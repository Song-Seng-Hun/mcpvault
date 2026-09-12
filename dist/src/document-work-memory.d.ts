import type { DocumentStructure } from './document-structure.js';
/** Nested read/parse operations share one lifetime. Concurrent requests still
 * reserve from the same process budget. This is admission accounting, not an
 * OS/native-allocator hard limit; estimates are deliberately conservative. */
export declare function withDocumentWork<T>(operation: () => Promise<T>): Promise<T>;
/** Private owner-scoped values cannot survive their foreground operation. */
export declare function documentWorkMemo<T>(owner: object): Map<string, T>;
export declare function documentResidentEstimate(document: DocumentStructure): number;
export declare function reserveDocumentWork(bytes: number): {
    release(): void;
};
export declare function documentParseEstimate(raw: string): number;
/** Match the reader's data-only frontmatter boundary without invoking YAML/JSON.
 * Scalars plus collection punctuation can allocate many nodes per source byte. */
export declare function documentFrontmatterEstimate(raw: string): number;
//# sourceMappingURL=document-work-memory.d.ts.map