import type { CompilationOptions, CompilationParams } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type CompilationJob } from './compilation-model.js';
export interface CompilationSession {
    signal: AbortSignal;
    deadline: number;
    /** Host-selected only. apply_verified requires actual quality/operation grants;
     * this value is never accepted from MCP arguments or a generated response. */
    application?: 'check_only' | 'apply_verified';
    assertCurrent(): Promise<void>;
    /** The existing authorized session reads exact inputs and produces data only.
     * This module never starts a model, process, scheduler, or provider. */
    generate(job: Readonly<CompilationJob>, assertCurrent: () => Promise<void>): Promise<{
        content: string;
        evidence: unknown;
    } | {
        observation: unknown;
    }>;
}
export interface CompilationSessionRequest {
    requestId: string;
    expectedJobRevision: string;
}
/** Called under CompilationService's single-worker lease. Durable generation
 * reservations prevent uncertain generation from being repeated after restart.
 * Persistence and publication continue through the existing job services. */
export declare function runCompilationSession(options: CompilationOptions, request: CompilationSessionRequest, principal: ScopePrincipal, context: CompilationSession, execute: (params: CompilationParams) => Promise<any>): Promise<any>;
//# sourceMappingURL=compilation-session.d.ts.map