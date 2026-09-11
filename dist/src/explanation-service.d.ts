import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { WorkExecutionProfile } from './work-staffing.js';
export interface ExplanationSourceConfig {
    path: string;
    language?: string;
    audience?: string;
}
export interface ExplanationOptions {
    sources: ExplanationSourceConfig[];
    executionProfiles: () => Promise<WorkExecutionProfile[]>;
    assertActor: (principal: ScopePrincipal) => Promise<void>;
    accountAvailable?: (accountId: string) => Promise<boolean>;
    /** Includes Work/ordinary tasks; this service separately checks its own claims. */
    canTakeWork?: (principal: ScopePrincipal) => Promise<boolean>;
}
export interface ExplanationParams {
    sourcePath?: string;
    expectedSourceRevision?: string;
    expectedRevision?: string;
    requestId?: string;
    draft?: unknown;
    review?: unknown;
    cursor?: string;
    limit?: number;
    maxChars?: number;
}
export declare function validateExplanationSources(sources: ExplanationSourceConfig[]): ExplanationSourceConfig[];
/** Managed private Markdown is the job/verification record. Public text is served
 * only after current-source and current-reviewer checks, never from a stale cache.
 * No model invocation, background queue worker or implicit source discovery.
 */
export declare class ExplanationService {
    private readonly fs;
    private readonly access;
    private readonly options;
    private readonly sources;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, options: ExplanationOptions);
    private external;
    private config;
    private source;
    private actor;
    private record;
    private approved;
    private fresh;
    private hasOwnWork;
    /** Cover all awaits in a derived read. Revision rereads catch external edits;
     * synchronous service notifications close the gaps between those rereads.
     * This is not a cross-process filesystem snapshot/transaction guarantee. */
    private observedRead;
    execute(op: string, params: ExplanationParams, principal?: ScopePrincipal): Promise<Record<string, any>>;
    /** Explicit opt-in navigation only: no draft text, work suggestion or generation. */
    approvedAction(params: {
        sourcePath: string;
        expectedSourceRevision: string;
    }, principal?: ScopePrincipal): Promise<{
        endpointId: string;
        arguments: {
            sourcePath: string;
            expectedSourceRevision: string;
            expectedRevision: string;
            maxChars: number;
        };
    } | undefined>;
    private executeInternal;
    nextAction(principal: ScopePrincipal): Promise<{
        endpointId: string;
        arguments: Record<string, unknown>;
        reason: string;
    } | undefined>;
    private nextActionInternal;
}
//# sourceMappingURL=explanation-service.d.ts.map