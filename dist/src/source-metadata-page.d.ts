import type { FileSystemService } from './filesystem.js';
import type { QueryNote } from './types.js';
/** Fresh bounded discovery without queryNotes' no-index body hydration.
 * Path inventory is reused; only <=60 headers/revision streams are examined.
 * Reaching a budget means possible continuation, not another matching note.
 * Callers must revalidate ALL observed revisions/permissions before return. */
export declare function readSourceMetadataPage(fs: FileSystemService, canAccess: (p: string) => boolean, predicate: (n: QueryNote) => boolean, afterPath?: string, limit?: number): Promise<{
    notes: QueryNote[];
    observed: QueryNote[];
    truncated: boolean;
    afterPath?: string;
}>;
//# sourceMappingURL=source-metadata-page.d.ts.map