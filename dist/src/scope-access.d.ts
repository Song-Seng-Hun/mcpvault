import type { ScopePrincipal } from './scope-auth.js';
/** Accept vault-relative physical paths; filesystem callers must resolve first. */
export declare function isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
export declare function assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
export declare class ScopeAccessPolicy {
    private readonly commandCenterId;
    constructor(options?: {
        commandCenterId?: string;
    });
    getCommandCenterId(): string;
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
        kind: 'agent' | 'model' | 'community' | 'global';
        root: string;
    }>;
}
//# sourceMappingURL=scope-access.d.ts.map