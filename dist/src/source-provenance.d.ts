import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
type ReadNoteResult = Awaited<ReturnType<FileSystemService['readNote']>>;
export declare const sourceWorkIdentity: (fm: Record<string, unknown>) => string | undefined;
/** Request-local cache and revision guards, not a new index or trust authority.
 * All claims share twenty loads / sixteen MiB of retained textual payload;
 * this accounts for original/raw YAML too, not total JavaScript heap overhead. */
export declare class SourceProvenanceSession {
    private readonly fs;
    private readonly access;
    private readonly container;
    private readonly principal?;
    private readonly notes;
    private readonly attempted;
    private readonly observed;
    private bytes;
    private limited;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, container: string, principal?: ScopePrincipal | undefined);
    private physical;
    private allowed;
    observe(path: string, revision: string): void;
    load(input: string): Promise<ReadNoteResult | undefined>;
    trace(paths: string[]): Promise<import("./source-provenance-model.js").SourceOriginTrace>;
    validate(): Promise<void>;
}
/** Only explicit quotation/adaptation/republication records are ancestry.
 * Ordinary citations, social agreement and similarity are never promoted. */
export declare function prepareSourceDerivations(fs: FileSystemService, access: ScopeAccessPolicy, value: unknown, container: string, principal?: ScopePrincipal): Promise<{
    records: import("./source-provenance-model.js").SourceDerivation[];
    guards: {
        path: string;
        expectedRevision: string;
    }[];
}>;
export {};
//# sourceMappingURL=source-provenance.d.ts.map