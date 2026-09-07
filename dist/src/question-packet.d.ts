import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type RetrievalService } from './retrieval-service.js';
export interface QuestionParams {
    query: string;
    path?: string;
    expectedRevision?: string;
    includeSemantic?: boolean;
    maxChars?: number;
    prettyPrint?: boolean;
    principal?: ScopePrincipal;
}
/** A per-request bounded source reader, not a generated answer or a second
 * knowledge database. Never serializes arbitrary source Properties. */
export declare class QuestionPacketService {
    private readonly fs;
    private readonly access;
    private readonly retrieval;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService);
    read(params: QuestionParams): Promise<Record<string, any>>;
}
//# sourceMappingURL=question-packet.d.ts.map