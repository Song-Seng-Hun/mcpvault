import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type KnowledgeApplication } from './knowledge-application-model.js';
type Guard = {
    path: string;
    expectedRevision: string;
};
export interface ApplicationCursor {
    path: string;
    index: number;
    revision: string;
    knowledgePath: string;
    knowledgeRevision: string;
}
export interface ApplicationReadParams {
    path: string;
    principal?: ScopePrincipal;
    expectedRevision?: string;
    limit?: number;
    maxChars?: number;
    cursor?: ApplicationCursor;
}
/** Experience belongs to an existing note, not a second event ledger. */
export declare class KnowledgeApplicationService {
    private readonly fs;
    private readonly access;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    private physical;
    private metadata;
    private compatible;
    private proseReferences;
    /** Guard current reference visibility while retaining the reported historical revision.
     * Up to eight distinct related documents leaves room for an existing project guard. */
    prepare(value: unknown, container: string, principal?: ScopePrincipal): Promise<{
        records: KnowledgeApplication[];
        guards: Guard[];
    }>;
    read(params: ApplicationReadParams): Promise<Record<string, any>>;
}
export {};
//# sourceMappingURL=knowledge-applications.d.ts.map