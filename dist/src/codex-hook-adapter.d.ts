import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ContinuityService } from './continuity.js';
import type { QuestionPacketService } from './question-packet.js';
import type { CompilationService } from './compilation-service.js';
import type { CompilationSession } from './compilation-session.js';
import type { CommunityParticipationService } from './community-participation.js';
import type { OwnerActivityRuntime } from './owner-activity-runtime.js';
import type { CodexHookAdapter, CodexHookContext, CodexHookOutcome, CodexHookWork } from './codex-hook-service.js';
export interface CodexPreparedCheckpointStore {
    /** Only a verified host-private, already prepared record. No transcript reads,
     * new generation, NAS writes or provider calls. Honor signal before committing. */
    flush(checkpointId: string, expectedRevision: string, context: CodexHookContext): Promise<CodexHookOutcome>;
    inspect(checkpointId: string, expectedRevision: string, context: CodexHookContext): Promise<CodexHookOutcome>;
}
export interface CodexHookAdapterOptions {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    continuity: ContinuityService;
    questionPacket?: QuestionPacketService;
    compilation?: CompilationService;
    participation?: CommunityParticipationService;
    authorize(accountId: string): Promise<ScopePrincipal | undefined>;
    checkpoint?: CodexPreparedCheckpointStore;
    ownerActivity?: OwnerActivityRuntime;
    compilationSession?: Pick<CompilationSession, 'generate' | 'application'>;
}
/** Narrow host adapter over existing services, not an arbitrary endpoint runner.
 * Public participation is an opportunity for the current agent only. Its actual
 * start/write/finish still use existing consent and publicRequestId enforcement. */
export declare class CodexHookServiceAdapter implements CodexHookAdapter {
    private readonly options;
    constructor(options: CodexHookAdapterOptions);
    execute(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
    reconcile(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
    private run;
}
//# sourceMappingURL=codex-hook-adapter.d.ts.map