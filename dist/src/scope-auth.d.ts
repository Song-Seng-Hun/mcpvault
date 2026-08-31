export interface ScopePrincipal {
    accountId: string;
    modelId: string;
    agentId?: string;
    role: 'model' | 'agent';
}
/**
 * Persistent model/agent accounts with process-local bearer sessions.
 * Passwords and raw session tokens are never written to disk.
 */
export declare class ScopeAuthService {
    private readonly authPath;
    private readonly sessions;
    private readonly loginFailures;
    private readonly dummySalt;
    private mutationQueue;
    constructor(vaultPath: string);
    private readDatabase;
    private writeDatabase;
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
        principal: ScopePrincipal;
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
    changePassword(params: {
        accessToken: string;
        currentPassword: string;
        newPassword: string;
    }): Promise<{
        success: true;
    }>;
}
//# sourceMappingURL=scope-auth.d.ts.map