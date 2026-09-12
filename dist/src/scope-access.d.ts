import type { ScopePrincipal } from './scope-auth.js';
import { type DocumentAuthorityOptions } from './document-authority.js';
/** Accept vault-relative physical paths; filesystem callers must resolve first. */
export declare function isLegacyDiscussionPath(path: string, includeAncestors?: boolean): boolean;
export declare function assertLegacyDiscussionMutationAllowed(path: string, operation: string, includeAncestors?: boolean): void;
export declare class ScopeAccessPolicy {
    private readonly documentAuthority;
    private readonly localInferenceAllowed;
    private readonly commandCenterId;
    private readonly enterprise;
    constructor(options?: {
        commandCenterId?: string;
        enterprise?: {
            mode: 'public' | 'company';
            realmId: string;
        };
    } & DocumentAuthorityOptions);
    getCommandCenterId(): string;
    getEnterpriseProfile(): {
        mode: 'public' | 'company';
        realmId: string;
    } | undefined;
    hasDocumentPolicy(): boolean;
    documentPolicyFingerprint(): string;
    /** Navigation only; the principal must originate from current host authentication. */
    defaultDepartment(principal?: ScopePrincipal): string | undefined;
    defaultNavigation(principal?: ScopePrincipal): {
        departmentId: string;
        basis: string;
        action: {
            endpointId: string;
            arguments: {
                department: string;
                limit: number;
                includeContent: boolean;
                includeTotal: boolean;
                maxChars: number;
            };
        };
    } | undefined;
    isInDefaultDepartment(path: string, principal?: ScopePrincipal, recordSource?: boolean): boolean;
    isConfidentialDocument(path: string): boolean;
    /** Pin authorization, not document bodies. Revocation at any await discards
     * the outgoing result, including aggregate existence information. */
    captureDocumentBoundary(principal?: ScopePrincipal): () => void;
    /** Used at physical IO independently of a service's legacy scope behavior. */
    canReadProtectedDocument(path: string, principal?: ScopePrincipal, recordSource?: boolean): boolean;
    getCommunityRoot(): string;
    private enterprisePrincipalAllowed;
    userMemoryRoot(principal?: ScopePrincipal): string | undefined;
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