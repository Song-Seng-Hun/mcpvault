import type { FileSystemService } from './filesystem.js';
import type { QueryNotesParams, QueryNotesResult } from './types.js';
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