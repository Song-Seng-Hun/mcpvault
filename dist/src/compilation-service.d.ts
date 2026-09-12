import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { CompilationHost } from './compilation-host.js';
import { type CompilationRuntime, type CompilationOperation } from './compilation-policy.js';
import { type CompilationJob, type CompilationIntent } from './compilation-model.js';
export interface CompilationAdapter {
    /** Code-owned deterministic checks, not an incoming client's success assertion. */
    check(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<{
        status: 'passed' | 'partial';
        ruleVersion: string;
    }>;
    protect(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<void>;
    preview(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<CompilationIntent>;
    /** Must delegate to the publication/change-set service with revision/authority guards. */
    apply(job: Readonly<CompilationJob>, intent: CompilationIntent, assertCurrent: () => Promise<void>): Promise<unknown>;
}
export interface CompilationOptions {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    host?: CompilationHost;
    readOnly?: boolean;
    authorize(accountId: string): Promise<ScopePrincipal | undefined>;
    runtime?(principal: ScopePrincipal, operation: CompilationOperation, paths: readonly string[]): Promise<CompilationRuntime | undefined>;
    adapter?: CompilationAdapter;
    /** Trusted restriction-only store; persists inherited policy before accepting draft bytes. */
    protectSources?(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<void>;
}
export interface CompilationParams {
    op?: string;
    requestId?: string;
    projectId?: string;
    operation?: CompilationOperation;
    inputs?: Array<{
        path: string;
        expectedRevision: string;
        role: 'source' | 'member' | 'concept' | 'topic';
    }>;
    outputPath?: string;
    expectedOutputRevision?: string;
    expectedJobRevision?: string;
    content?: string;
    maxChars?: number;
}
/** Host-owned bounded journal. No scheduler, model invocation or raw Vault writer.
 * Every entry point reauthorizes; checkpoints are never bearer access grants. */
export declare class CompilationService {
    private readonly options;
    private tail;
    private closed;
    private pendingPaths;
    private pendingReconcile;
    private notificationTask;
    constructor(options: CompilationOptions);
    private serial;
    close(): Promise<void>;
    private actor;
    private revision;
    private gate;
    private projection;
    execute(params: CompilationParams, principal?: ScopePrincipal, protectSources?: ((job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>) => Promise<void>) | undefined): Promise<any>;
    private run;
    private drift;
    private assertCurrent;
    /** Coalesce read-model events through the same worker; no model or application is scheduled.
     * Reconciliation supplies the full bounded dependency set when events were missed. */
    notify(paths?: readonly string[]): Promise<void>;
    private invalidateJobs;
}
//# sourceMappingURL=compilation-service.d.ts.map