import type { QueryNote, QueryNotesCursor, QueryNotesResult } from './types.js';
interface QueryPageOptions {
    maxChars: number;
    prettyPrint?: boolean;
    includeContent?: boolean;
    cursorFor: (note: QueryNote) => QueryNotesCursor;
    /** undefined means source IO was deliberately omitted, not a missing note. */
    hydrate?: (note: QueryNote) => Promise<QueryNote | undefined>;
}
export interface PackedQueryPage {
    text: string;
    isError?: true;
}
/** Preserve a contiguous delivery prefix and never derive a cursor from clipped Properties. */
export declare function packQueryPage(page: QueryNotesResult, options: QueryPageOptions): Promise<PackedQueryPage>;
export {};
//# sourceMappingURL=query-page.d.ts.map