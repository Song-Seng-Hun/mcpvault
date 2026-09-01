import type { ScopePrincipal } from './scope-auth.js';
export interface AuditEvent {
    at: string;
    tool: string;
    actor: string;
    role: 'model' | 'agent' | 'anonymous';
    outcome: 'attempt' | 'error';
    target?: string;
    error?: string;
}
/**
 * Append-only, metadata-only audit trail. It deliberately excludes request
 * bodies and access tokens so it can diagnose denied operations without
 * becoming a second content database or a secret store.
 */
export declare class AuditService {
    private readonly auditPath;
    private tail;
    constructor(vaultPath: string);
    private exclusive;
    private readTail;
    record(params: {
        tool: string;
        principal?: ScopePrincipal;
        args?: Record<string, unknown>;
        outcome: AuditEvent['outcome'];
        error?: unknown;
        explicitActor?: unknown;
    }): Promise<void>;
    list(params: {
        principal?: ScopePrincipal;
        limit?: number;
        includeErrors?: boolean;
    }): Promise<{
        events: AuditEvent[];
        total: number;
        truncated: boolean;
    }>;
}
//# sourceMappingURL=audit.d.ts.map