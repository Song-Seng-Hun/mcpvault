import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { RetrievalService } from './retrieval-service.js';
export interface SourceComparisonParams {
    sourcePath: string;
    query: string;
    expectedRevision?: string;
    includeSemantic?: boolean;
    maxChars?: number;
    prettyPrint?: boolean;
    principal?: ScopePrincipal;
}
/** Pre-authoring comparison, never an automatic novelty/conflict classifier.
 * The only full bodies retained are the source and seven discovered notes. */
export declare class SourceComparisonService {
    private readonly fs;
    private readonly access;
    private readonly retrieval;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService);
    read(params: SourceComparisonParams): Promise<Record<string, any>>;
}
//# sourceMappingURL=source-comparison.d.ts.map