import type { ScopePrincipal } from './scope-auth.js';
/** Accept vault-relative physical paths; filesystem callers must resolve first. */
export declare function isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
export declare function assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
export declare class ScopeAccessPolicy {
    private readonly commandCenterId;
    private readonly enterprise;
    constructor(options?: {
        commandCenterId?: string;
        enterprise?: {
            mode: 'public' | 'company';
            realmId: string;
        };
    });
    getCommandCenterId(): string;
    getEnterpriseProfile(): {
        mode: 'public' | 'company';
        realmId: string;
    } | undefined;
    getCommunityRoot(): string;
    private enterprisePrincipalAllowed;
    userMemoryRoot(principal?: ScopePrincipal): string | undefined;
    isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
    assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
    isCommunityPath(path: string): boolean;
    canAccessPhysicalPath(path: string, principal?: ScopePrincipal): boolean;
    resolveExternalPath(value: string, principal?: ScopePrincipal): string;
    private isPrivateServicePath;
    assertMutationAllowed(path: string, operation: string): void;
    canReferenceFrom(containerPath: string, referencedPath: string): boolean;
    toPublicPath(path: string): string;
    scopeRoots(principal?: ScopePrincipal): Array<{
        kind: 'agent' | 'model' | 'user' | 'community' | 'global';
        root: string;
    }>;
}
//# sourceMappingURL=scope-access.d.ts.map