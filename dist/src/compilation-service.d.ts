import type { ManagedRollback } from './memory/rollback.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { CompilationHost } from './compilation-host.js';
import type { DocumentPolicyStore } from './document-policy-store.js';
import type { PublicationBoundary } from './compilation-publication.js';
import { type CompilationSession, type CompilationSessionRequest } from './compilation-session.js';
import { type CompilationFinding } from './compilation-review.js';
import { type CompilationRuntime, type CompilationOperation } from './compilation-policy.js';
import { type CompilationJob, type CompilationIntent } from './compilation-model.js';
export interface CompilationAdapter {
    /** Code registration only; never read from a job, note or client request. */
    readonly outputOwner?: 'wiki_knowledge';
    /** Code-owned deterministic checks, not an incoming client's success assertion. */
    check(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<{
        status: 'passed' | 'partial';
        ruleVersion: string;
    }>;
    /** Must verify real immutable sources/coverage; never synthesize or publish. */
    checkObservation?(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<{
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
    /** Verifies only server-owned structural processing; never used for generated drafts. */
    structuralRuntime?: CompilationOptions['runtime'];
    adapter?: CompilationAdapter;
    /** Trusted restriction-only store; persists inherited policy before accepting draft bytes. */
    protectSources?(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<void>;
    documentPolicy?: DocumentPolicyStore;
}
export interface CompilationParams {
    kind?: 'single_output' | 'document_bundle';
    documentPath?: string;
    expectedDocumentRevision?: string;
    bundleId?: string;
    projection?: 'summary' | 'original' | 'plan' | 'candidate';
    startOffset?: number;
    endOffset?: number;
    chapterCursor?: number;
    expectedPlanRevision?: string;
    chapterId?: string;
    expectedCandidateRevision?: string;
    metadata?: unknown;
    expectedPublicationRevision?: string;
    fingerprint?: string;
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
    evidence?: unknown;
    observation?: unknown;
    maxChars?: number;
    includeInspection?: boolean;
    inspectionCursor?: number;
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
    private sessionBusy;
    private readonly bundles;
    constructor(options: CompilationOptions);
    private serial;
    close(): Promise<void>;
    /** Historical ownership only. Does not attest current content, grant curation,
     * or execute a model. A separate operation grant and fresh revision are required. */
    managedOutputProof(path: string, revision: string, principal: ScopePrincipal): Promise<string | undefined>;
    private rollbackJob;
    captureRollback(id: string, principal: ScopePrincipal): Promise<ManagedRollback | undefined>;
    confirmRestored(id: string, snapshot: ManagedRollback, principal: ScopePrincipal): Promise<{
        state: 'withdrawn' | 'unknown';
        revision?: string;
    }>;
    restoreManaged(id: string, outputRevision: string, snapshot: ManagedRollback, principal: ScopePrincipal, current: () => Promise<void>): Promise<{
        revision: string;
    }>;
    /** Internal evolution bridge. Authorize every input before returning a pinned private job. */
    evolutionSnapshot(requestId: string, principal: ScopePrincipal): Promise<{
        job: CompilationJob;
        revision: string;
    }>;
    /** Host-only existing-session driver, never an endpoint-supplied callback. */
    runSession(request: CompilationSessionRequest, principal: ScopePrincipal, context: CompilationSession): Promise<any>;
    /** Optional host-private diagnostics for existing views. No registration,
     * history repair, counters for omitted jobs, execution, or journal writes. */
    review(principal?: ScopePrincipal, paths?: readonly string[]): Promise<CompilationFinding[]>;
    private actor;
    private revision;
    private gate;
    private projection;
    execute(params: CompilationParams, principal?: ScopePrincipal, protectSources?: ((job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>) => Promise<void>) | undefined, publicationBoundary?: PublicationBoundary): Promise<any>;
    private run;
    private drift;
    private assertCurrent;
    /** Coalesce read-model events through the same worker; no model or application is scheduled.
     * Reconciliation supplies the full bounded dependency set when events were missed. */
    notify(paths?: readonly string[]): Promise<void>;
    private invalidateJobs;
}
//# sourceMappingURL=compilation-service.d.ts.map