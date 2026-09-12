export type EnterpriseMode = 'public' | 'company';
export type RuntimeKind = 'external' | 'internal';
export interface EnterpriseProfile {
    mode: EnterpriseMode;
    realmId: string;
    vaultPath: string;
}
export interface EnterpriseEmployee {
    userId: string;
    active: boolean;
    sharedMemoryEnabled: boolean;
    createdAt: string;
    disabledAt?: string;
    /** Verified host-admin memberships; absence grants no department access. */
    departmentIds?: string[];
    defaultDepartmentId?: string;
    departmentRevision?: number;
}
export interface EnterpriseRuntime {
    runtimeId: string;
    kind: RuntimeKind;
    certFingerprint: string;
    active: boolean;
    createdAt: string;
    disabledAt?: string;
}
export interface EnterpriseBinding {
    accountId: string;
    agentId: string;
    userId: string;
    modelId: string;
    runtimeId: string;
    displayLabel?: string;
    role?: string;
}
export interface EnterpriseSessionLease {
    agentId: string;
    sessionId: string;
    generation: number;
    expiresAt: string;
}
export interface EnterpriseRegistryOptions {
    registryPath: string;
    vaultPath: string;
    servicePaths?: string[];
    now?: () => Date;
}
export interface ReserveInviteInput {
    secret: string;
    realmId: string;
    mode: EnterpriseMode;
    runtimeId: string;
    certFingerprint: string;
    binding?: EnterpriseBinding;
}
export declare class EnterpriseRegistry {
    readonly registryPath: string;
    private readonly lockPath;
    private readonly vaultPath;
    private readonly protectedPaths;
    private readonly now;
    private mutationQueue;
    constructor(options: EnterpriseRegistryOptions);
    private timestamp;
    private readDatabase;
    private writeDatabase;
    private acquireLock;
    private releaseLock;
    private exclusive;
    private assertRuntimeMode;
    private assertActive;
    initialize(profileInput: EnterpriseProfile): Promise<EnterpriseProfile>;
    getPolicy(): EnterpriseProfile;
    getEmployee(userIdInput: string): EnterpriseEmployee | undefined;
    createEmployee(params: {
        userId: string;
        sharedMemoryEnabled?: boolean;
        departmentIds?: string[];
        defaultDepartmentId?: string;
    }): Promise<EnterpriseEmployee>;
    /** Host administrator API only. Replaces memberships; an omitted default clears it. */
    updateEmployeeDepartments(params: {
        userId: string;
        departmentIds: string[];
        defaultDepartmentId?: string;
        expectedDepartmentRevision: number;
    }): Promise<EnterpriseEmployee>;
    disableEmployee(params: {
        userId: string;
    }): Promise<EnterpriseEmployee>;
    registerRuntime(params: {
        runtimeId: string;
        kind: RuntimeKind;
        certFingerprint: string;
    }): Promise<EnterpriseRuntime>;
    disableRuntime(params: {
        runtimeId: string;
    }): Promise<EnterpriseRuntime>;
    createInvite(params: {
        binding: EnterpriseBinding;
        expiresAt: string;
        secretFile: string;
    }): Promise<{
        inviteId: string;
        expiresAt: string;
        secretFile: string;
    }>;
    private validateReservation;
    reserveInvite(input: ReserveInviteInput): Promise<{
        registrationId: string;
        binding: EnterpriseBinding;
    }>;
    completeInvite(params: {
        registrationId: string;
    }): Promise<{
        registrationId: string;
        binding: EnterpriseBinding;
    }>;
    redeemInvite(input: ReserveInviteInput, registerAccount: (binding: EnterpriseBinding, registrationId: string) => Promise<void>): Promise<{
        registrationId: string;
        binding: EnterpriseBinding;
    }>;
    getBinding(accountIdInput: string): EnterpriseBinding | undefined;
    disableAccount(params: {
        accountId: string;
    }): Promise<{
        accountId: string;
        disabled: true;
    }>;
    assertRegisteredBinding(bindingInput: EnterpriseBinding): {
        binding: EnterpriseBinding;
        employee: EnterpriseEmployee;
        runtime: EnterpriseRuntime;
        policy: EnterpriseProfile;
    };
    resolveRequestCertificate(certFingerprintInput: string): EnterpriseRuntime;
    assertBinding(input: EnterpriseBinding & {
        realmId: string;
        mode: EnterpriseMode;
        certFingerprint: string;
    }): {
        binding: EnterpriseBinding;
        employee: EnterpriseEmployee;
        runtime: EnterpriseRuntime;
        policy: EnterpriseProfile;
    };
    getSessionLease(agentIdInput: string): EnterpriseSessionLease | undefined;
    getSessionGeneration(agentIdInput: string): number;
    claimSessionLease(params: {
        agentId: string;
        sessionId: string;
        expectedGeneration: number;
        expiresAt: string;
    }): Promise<EnterpriseSessionLease>;
    assertSessionLease(params: {
        agentId: string;
        sessionId: string;
        generation: number;
    }): EnterpriseSessionLease;
    releaseSessionLease(params: {
        agentId: string;
        sessionId: string;
        expectedGeneration: number;
    }): Promise<{
        agentId: string;
        generation: number;
    }>;
}
//# sourceMappingURL=enterprise-registry.d.ts.map