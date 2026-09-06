import type { FileSystemService } from './filesystem.js';
import type { QueryNote, QueryNotesParams, QueryNotesResult } from './types.js';
/** Stream small revision-checked body groups, never a whole hydrated page.
 * Started siblings settle before failure/return; the next group is not prefetched.
 */
export declare function iterateNoteBodies(fileSystem: FileSystemService, params?: QueryNotesParams, canAccessPath?: (path: string) => boolean, canReadNote?: (note: QueryNote) => boolean): AsyncGenerator<QueryNote, void, void>;
/**
 * Stream matching metadata pages without retaining the complete collection.
 * Callers that need a response window should prefer queryWindow; this helper
 * is for bounded-memory scans such as linting and derived-index rebuilds.
 */
export declare function iterateNotes(fileSystem: FileSystemService, params?: QueryNotesParams, canAccessPath?: (path: string) => boolean): AsyncGenerator<QueryNotesResult['notes'][number], void, void>;
/**
 * Read only enough metadata rows to fill a bounded response window. A
 * predicate may discard hidden or workflow-closed rows; the helper advances
 * by keyset cursor until the requested visible page is full.
 */
export declare function queryWindow(fileSystem: FileSystemService, params: QueryNotesParams & {
    limit: number;
}, predicate?: (note: QueryNotesResult['notes'][number]) => boolean, canAccessPath?: (path: string) => boolean): Promise<{
    notes: QueryNotesResult['notes'];
    truncated: boolean;
}>;
/**
 * Read every matching metadata row in bounded pages. The caller still owns
 * the final response limit; this helper only removes the old silent 500-row
 * ceiling from internal discovery paths. Callers should leave
 * includeContent=false and hydrate only the selected rows when bodies are
 * needed.
 */
export declare function queryAllNotes(fileSystem: FileSystemService, params?: QueryNotesParams, canAccessPath?: (path: string) => boolean): Promise<QueryNotesResult>;
//# sourceMappingURL=paged-query.d.ts.map