import type { ScopePrincipal } from './scope-auth.js';
export declare class ScopeAccessPolicy {
    private readonly commandCenterId;
    constructor(options?: {
        commandCenterId?: string;
    });
    getCommandCenterId(): string;
    isCommunityPath(path: string): boolean;
    canAccessPhysicalPath(path: string, principal?: ScopePrincipal): boolean;
    resolveExternalPath(value: string, principal?: ScopePrincipal): string;
    assertMutationAllowed(path: string, operation: string): void;
    canReferenceFrom(containerPath: string, referencedPath: string): boolean;
    toPublicPath(path: string): string;
    scopeRoots(principal?: ScopePrincipal): Array<{
        kind: 'agent' | 'user' | 'model' | 'community' | 'global';
        root: string;
    }>;
}
//# sourceMappingURL=scope-access.d.ts.map