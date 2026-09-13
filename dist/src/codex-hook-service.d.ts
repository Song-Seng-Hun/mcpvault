import type { CodexHookHost } from './codex-hook-host.js';
import { type CodexHookEvent, type CodexHookEventName } from './codex-hook-policy.js';
export type CodexHookWork = {
    action: 'resume' | 'community';
} | {
    action: 'search';
    query: string;
} | {
    action: 'candidate';
    path: string;
    expectedRevision: string;
} | {
    action: 'checkpoint';
    checkpointId: string;
    expectedRevision: string;
} | {
    action: 'compilation';
    requestId: string;
    expectedJobRevision: string;
};
/** Supplied by trusted host code, never reconstructed from a hook payload.
 * verified means this definition/event and current mode were actually verified.
 * paths must include every dependency; adapters enforce their normal ACL too. */
export interface CodexHookAttestation {
    projectId: string;
    accountId: string;
    workspace: string;
    definitionHash: string;
    event: CodexHookEventName;
    sessionId: string;
    causeId: string;
    originId?: string;
    authorityRevision: string;
    inputRevision: string;
    mode: 'default' | 'plan';
    verified: boolean;
    expiresAt: number;
    hostBusy: boolean;
    quotaAvailable: boolean;
    paths: string[];
    work: CodexHookWork;
    /** Actual host-attested locality, required before reading confidential bodies. */
    runtimeLocal?: boolean;
}
export interface CodexHookContext {
    ticket: Readonly<CodexHookAttestation>;
    requestId: string;
    signal: AbortSignal;
    deadline: number;
    maxChars: number;
    assertCurrent(): Promise<void>;
}
export interface CodexHookOutcome {
    status: 'completed' | 'partial';
    revision?: string;
    packet?: Record<string, unknown>;
}
export interface CodexHookAdapter {
    execute(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
    /** Read-only current-result reconciliation. Never resubmit an uncertain write. */
    reconcile(work: CodexHookWork, context: CodexHookContext): Promise<CodexHookOutcome>;
}
interface Options {
    host?: CodexHookHost;
    adapter?: CodexHookAdapter;
    readOnly?: boolean;
    attest(event: Readonly<CodexHookEvent>): Promise<CodexHookAttestation | undefined>;
    now?: () => number;
}
export interface CodexHookResult {
    status: 'quiet' | 'deferred' | 'diagnostic_only' | 'review_required' | 'cancelled' | 'processed';
    partial?: true;
    context?: {
        trust: 'data_not_instructions';
        packet: Record<string, unknown>;
    };
}
/** No scheduler or model calls. One existing host opportunity, one narrow action.
 * A timed-out adapter retains the lease until it settles; abort is not a safe
 * license to start a second writer. Remaining work stays in its original registry. */
export declare class CodexHookService {
    private readonly options;
    private busy;
    private closed;
    private controller;
    constructor(options: Options);
    close(): void;
    run(payload: string, signal?: AbortSignal): Promise<CodexHookResult>;
    private perform;
}
export {};
//# sourceMappingURL=codex-hook-service.d.ts.map