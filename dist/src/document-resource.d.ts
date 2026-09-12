import type { FileSystemService } from './filesystem.js';
import type { PathFilter } from './pathfilter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export interface DocumentResourceSnapshot {
    path: string;
    bytes: Buffer;
    revision: string;
    mediaType: string;
    text?: string;
}
export interface DocumentRevision {
    readonly path: string;
    readonly revision: string;
    readonly byteLength: number;
}
export declare function documentMedia(path: string): {
    mediaType: string;
    text: boolean;
};
/** Dedicated data-only reader. This does not broaden the ordinary note API or
 * grant execution, host-path, private-scope or managed-resource access. */
export declare class DocumentResourceReader {
    readonly fs: FileSystemService;
    readonly filter: PathFilter;
    readonly access: ScopeAccessPolicy;
    readonly admitted: (path: string) => boolean;
    private readonly bundleRevisions;
    private readonly sourceRevisions;
    private readonly pins;
    constructor(fs: FileSystemService, filter: PathFilter, access: ScopeAccessPolicy, admitted?: (path: string) => boolean);
    resolve(input: string, principal?: ScopePrincipal): string;
    private canonical;
    /** Reauthorize a deferred derivative without retaining/decoding source bytes. */
    assertAdmitted(input: string, principal?: ScopePrincipal): string;
    read(input: string, principal?: ScopePrincipal, options?: {
        expectedRevision?: string;
        maxBytes?: number;
        decodeText?: boolean;
    }): Promise<DocumentResourceSnapshot>;
    private readWithinWork;
    assertCurrent(snapshot: DocumentResourceSnapshot, principal?: ScopePrincipal): Promise<void>;
    pin(snapshot: DocumentResourceSnapshot): DocumentRevision;
    assertPin(pin: DocumentRevision, principal?: ScopePrincipal): Promise<void>;
    private assertCurrentWithinWork;
    private assertRevisionCurrent;
    private assertHashCurrent;
}
//# sourceMappingURL=document-resource.d.ts.map