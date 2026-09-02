export declare const SCOPE_CAPABILITIES: readonly ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile', 'journal', 'moderate'];
export type ScopeCapability = typeof SCOPE_CAPABILITIES[number];
export interface ScopePrincipal {
    accountId: string;
    modelId: string;
    agentId?: string;
    role: 'model' | 'agent';
    capabilities?: ScopeCapability[];
}
/**
 * Persistent model/agent accounts with process-local bearer sessions.
 * Passwords and raw session tokens are never written to disk.
 */
export declare class ScopeAuthService {
    private readonly authPath;
    private readonly moderatorAccounts;
    private readonly sessions;
    private readonly loginFailures;
    private readonly dummySalt;
    private mutationQueue;
    private databaseCache;
    private databaseInFlight;
    private principalCache;
    constructor(vaultPath: string, options?: {
        moderatorAccounts?: string[];
    });
    private effectiveCapabilities;
    private readDatabase;
    private writeDatabase;
    private defaultCapabilities;
    private exclusive;
    authenticate(accessToken: unknown): ScopePrincipal | undefined;
    register(params: {
        accountId: string;
        password: string;
        modelId: string;
        agentId?: string;
        accessToken?: string;
    }): Promise<{
        success: true;
        accessToken: string;
        expiresAt: string;
        principal: ScopePrincipal;
        next: string;
    }>;
    login(params: {
        accountId: string;
        password: string;
    }): Promise<{
        success: true;
        accessToken: string;
        expiresAt: string;
        principal: ScopePrincipal;
    }>;
    logout(accessToken: unknown): {
        success: true;
    };
    whoami(accessToken: unknown): ScopePrincipal | {
        role: 'global';
        note: string;
    };
    listPrincipals(): Promise<ScopePrincipal[]>;
    updateAgentCapabilities(params: {
        accessToken: string;
        agentId: string;
        capabilities: unknown;
    }): Promise<{
        success: true;
        agentId: string;
        capabilities: ScopeCapability[];
    }>;
    hasCapability(principal: ScopePrincipal | undefined, capability: ScopeCapability): boolean;
    changePassword(params: {
        accessToken: string;
        currentPassword: string;
        newPassword: string;
    }): Promise<{
        success: true;
    }>;
}
//# sourceMappingURL=scope-auth.d.ts.map