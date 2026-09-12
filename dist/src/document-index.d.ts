import type { ScopePrincipal } from './scope-auth.js';
import type { DocumentResourceReader, DocumentResourceSnapshot, DocumentRevision } from './document-resource.js';
import { type DocumentStructure } from './document-structure.js';
import type { VaultFileCatalog } from './vault-catalog.js';
export interface LoadedDocument {
    snapshot: DocumentResourceSnapshot;
    structure: DocumentStructure;
}
export interface DocumentIndexOptions {
    cacheDir?: string;
    parse?: (input: {
        path: string;
        raw: string;
        revision: string;
        format: 'markdown' | 'text';
    }) => DocumentStructure;
    pdf?: {
        extract(snapshot: DocumentResourceSnapshot): Promise<DocumentStructure>;
    };
}
/** Advisory host-local structure cache. A cache hit NEVER replaces reading and
 * authorizing the current source. No filesystem event is treated as proof of deletion. */
export declare class DocumentIndex {
    readonly reader: DocumentResourceReader;
    readonly catalog?: VaultFileCatalog | undefined;
    readonly options: DocumentIndexOptions;
    private readonly hot;
    private readonly preparing;
    private readonly cacheOwner;
    private readonly namespace;
    private readonly unsubscribe;
    private closed;
    private diskQueue;
    private readonly pendingDiskKeys;
    private pendingDiskBytes;
    private readonly diskLedger;
    private diskLedgerReady;
    private diskWrites;
    private writerLease;
    constructor(reader: DocumentResourceReader, catalog?: VaultFileCatalog | undefined, options?: DocumentIndexOptions);
    private assertCacheDirectory;
    private key;
    private assertPrivateCache;
    load(path: string, principal?: ScopePrincipal, expectedRevision?: string): Promise<LoadedDocument>;
    /** Revalidate metadata-only pages without retaining or decoding source bodies. */
    revalidatePin(pin: DocumentRevision, principal?: ScopePrincipal): Promise<void>;
    private loadWithinWork;
    private restore;
    /** Copy only authority inputs into the queue, never the snapshot's original bytes. */
    private publicationGuard;
    /** One lifetime writer per private root makes its capacity ledger exclusive.
     * An abandoned lease fails closed to memory-only writes; never steal a host's lock. */
    private acquireWriterLease;
    private releaseWriterLease;
    private persist;
    private loadDiskLedger;
    private reserveDiskEntry;
    invalidate(path?: string): void;
    close(): Promise<void>;
}
//# sourceMappingURL=document-index.d.ts.map