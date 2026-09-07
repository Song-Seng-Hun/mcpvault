import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export interface SourceChangeParams {
    sourcePath: string;
    previousSourcePath?: string;
    expectedRevision?: string;
    previousExpectedRevision?: string;
    knowledgePath?: string;
    afterPath?: string;
    maxChars?: number;
    prettyPrint?: boolean;
    principal?: ScopePrincipal;
}
/** Read-only literal edition comparison. No implicit latest edition, new ledger,
 * claim status mutation, semantic impact verdict or source hash repair. */
export declare class SourceChangeService {
    private readonly fs;
    private readonly access;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    private physical;
    read(params: SourceChangeParams): Promise<Record<string, any>>;
}
//# sourceMappingURL=source-change.d.ts.map