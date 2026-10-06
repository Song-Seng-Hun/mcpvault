import type { ScopePrincipal } from './scope-auth.js';
import { type DocumentAuthorityOptions } from './document-authority.js';
/** Accept vault-relative physical paths; filesystem callers must resolve first. */
export declare function isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
export declare function assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
export declare class ScopeAccessPolicy {
    private readonly documentAuthority;
    private readonly localInferenceAllowed;
    private readonly commandCenterId;
    constructor(options?: {
        commandCenterId?: string;
    } & DocumentAuthorityOptions);
    getCommandCenterId(): string;
    hasDocumentPolicy(): boolean;
    documentPolicyFingerprint(): string;
    /** Dependency-scoped invalidation only, not proof of present read or execution authority. */
    documentDependencyFingerprint(paths: readonly string[]): string;
    isConfidentialDocument(path: string): boolean;
    /** Pin authorization, not document bodies. Revocation at any await discards
     * the outgoing result, including aggregate existence information. */
    captureDocumentBoundary(principal?: ScopePrincipal): () => void;
    /** Used at physical IO independently of a service's legacy scope behavior. */
    canReadProtectedDocument(path: string, principal?: ScopePrincipal, recordSource?: boolean): boolean;
    getCommunityRoot(): string;
    isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
    assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
    isCommunityPath(path: string): boolean;
    canAccessPhysicalPath(path: string, principal?: ScopePrincipal, recordSource?: boolean): boolean;
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