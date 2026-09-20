import type { QueryNote } from '../types.js';
import { type ResolveNoteReferenceOptions } from '../note-reference.js';
import type { MemorySqliteStore } from './sqlite-store.js';
export interface GraphReferenceCapture {
    reason?: string;
    resolve(document: string, options?: ResolveNoteReferenceOptions): Promise<string[]>;
    assertCurrent(): Promise<void>;
}
export interface GraphReadIndex {
    graphReferences(canAccess: (path: string) => boolean, read: (path: string) => Promise<QueryNote | undefined>): Promise<GraphReferenceCapture>;
}
/** Bounded advisory lookup, followed by the same live identity resolver used by
 * the legacy path. Missing candidates are never a proof of reference absence. */
export declare function indexedGraphReferences(store: MemorySqliteStore, canAccess: (path: string) => boolean, read: (path: string) => Promise<QueryNote | undefined>, current: () => Promise<void>): GraphReferenceCapture;
//# sourceMappingURL=graph-references.d.ts.map