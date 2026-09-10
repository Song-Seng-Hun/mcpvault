import type { ScopePrincipal } from './scope-auth.js';
import type { DocumentResourceReader, DocumentResourceSnapshot } from './document-resource.js';
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
    private readonly cacheOwner;
    private readonly namespace;
    private readonly unsubscribe;
    private closed;
    private diskQueue;
    constructor(reader: DocumentResourceReader, catalog?: VaultFileCatalog | undefined, options?: DocumentIndexOptions);
    private assertCacheDirectory;
    private key;
    load(path: string, principal?: ScopePrincipal, expectedRevision?: string): Promise<LoadedDocument>;
    private restore;
    private persist;
    invalidate(path?: string): void;
    close(): void;
}
//# sourceMappingURL=document-index.d.ts.map