import type { FileSystemService } from '../filesystem.js';
import type { VaultFileCatalog, VaultCatalogChange } from '../vault-catalog.js';
import type { QueryNote } from '../types.js';
import { type GraphReadIndex, type GraphReferenceCapture } from './graph-references.js';
import type { CurationReadCapture, CurationReadIndex } from '../curation/read-index.js';
import type { CurationDelivery } from '../curation/delivery.js';
export interface MemoryCapture {
    notes: QueryNote[];
    truncated: boolean;
    generation: number;
    reason?: string;
    candidatePaths: Set<string>;
    assertCurrent(): Promise<void>;
}
export interface MemoryReadIndex {
    capture(params: MemoryCaptureRequest): Promise<MemoryCapture>;
}
interface MemoryCaptureRequest {
    root: string;
    prefix: string;
    query: string;
    role?: string;
    semantic?: boolean;
    dateFrom?: string;
    dateTo?: string;
    canAccess(path: string): boolean;
}
/** Private derivative index; startup/reconciliation is background, never a request scan. */
export declare class DiskMemoryIndex implements MemoryReadIndex, GraphReadIndex, CurationReadIndex {
    private fs;
    private allowed;
    private readonly owner;
    private store?;
    private storage;
    private revision;
    private state;
    private tail;
    private unsubscribe;
    private reconcileUnsubscribe;
    private draining;
    private reconciling;
    private pendingFull;
    private pending;
    private isClosed;
    constructor(fs: FileSystemService, cacheDir: string, allowed: (path: string) => boolean, catalog?: VaultFileCatalog);
    start(): Promise<void>;
    invalidate(changes?: readonly VaultCatalogChange[]): Promise<void>;
    private refresh;
    private rebuild;
    capture(p: MemoryCaptureRequest): Promise<MemoryCapture>;
    graphReferences(canAccess: (path: string) => boolean, read: (path: string) => Promise<QueryNote | undefined>): Promise<GraphReferenceCapture>;
    captureCuration(): Promise<CurationReadCapture | undefined>;
    recordCurationDelivery(event: CurationDelivery): Promise<void>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=read-index.d.ts.map