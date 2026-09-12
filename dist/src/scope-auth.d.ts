import type { EnterpriseRegistry } from './enterprise-registry.js';
export declare const SCOPE_CAPABILITIES: readonly ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile', 'journal', 'moderate'];
export type ScopeCapability = typeof SCOPE_CAPABILITIES[number];
export interface ScopePrincipal {
    accountId: string;
    modelId: string;
    agentId?: string;
    /** Stable owner identity shared by all agents of one human user. */
    userId?: string;
    /** Command center that issued this account. */
    commandCenterId?: string;
    role: 'model' | 'agent';
    capabilities?: ScopeCapability[];
    /** Issued by enterprise authentication, never accepted from tool arguments. */
    enterprise?: {
        mode: 'public' | 'company';
        realmId: string;
        runtimeId: string;
        sharedMemoryEnabled: boolean;
        /** Current administrator-verified membership, refreshed during authentication. */
        departmentIds?: string[];
        defaultDepartmentId?: string;
    };
    sessionId?: string;
    sessionGeneration?: number;
    actorId?: string;
    authorLabel?: string;
}
/**
 * Persistent model/agent accounts with process-local bearer sessions.
 * Passwords and raw session tokens are never written to disk.
 */
export declare class ScopeAuthService {
    private readonly enterpriseRegistry;
    private readonly authPath;
    private readonly authLockPath;
    private readonly moderatorAccounts;
    private readonly commandCenterId;
    private readonly sessions;
    private readonly loginFailures;
    private loginWindow;
    private registrationWindow;
    private readonly dummySalt;
    private mutationQueue;
    private databaseCache;
    private databaseInFlight;
    private principalCache;
    constructor(vaultPath: string, options?: {
        moderatorAccounts?: string[];
        commandCenterId?: string;
        enterpriseRegistry?: EnterpriseRegistry;
        authPath?: string;
        protectedServicePaths?: string[];
    });
    private effectiveCapabilities;
    private readDatabase;
    private writeDatabase;
    private defaultCapabilities;
    private exclusive;
    private consumeLoginAttempt;
    private consumeRegistrationAttempt;
    private rememberLoginFailure;
    authenticate(accessToken: unknown): ScopePrincipal | undefined;
    /** Called before auth endpoints as well, preventing REST/stdio from bypassing mTLS. */
    requireEnterpriseRuntime(): import("./enterprise-registry.js").EnterpriseRuntime | undefined;
    private assertEnterprisePrincipal;
    private enterpriseSession;
    private registerEnterprise;
    register(params: {
        accountId: string;
        password: string;
        modelId: string;
        agentId?: string;
        userId?: string;
        accessToken?: string;
        invitationToken?: string;
        sessionId?: string;
        expectedGeneration?: number;
        /** User selection is checked against host authority; it grants nothing. */
        accountType?: 'personal' | 'enterprise';
        departmentId?: string;
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
        sessionId?: string;
        expectedGeneration?: number;
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
    endSession(accessToken: unknown): Promise<{
        success: true;
    }>;
    handoffEnterpriseSession(accessToken: unknown, params: {
        agentId: string;
        fromSessionId?: string;
        toSessionId: string;
        expectedGeneration: number;
    }): Promise<{
        success: boolean;
        agentId: string;
        generation: number;
        currentSession: string;
        nextAction: {
            tool: string;
            arguments: {
                endpointId: string;
                arguments: {
                    accountId: string;
                    sessionId: string;
                };
            };
        };
    }>;
    listPrincipals(options?: {
        fresh?: boolean;
    }): Promise<ScopePrincipal[]>;
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