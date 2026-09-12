import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
interface DocumentContext {
    access: ScopeAccessPolicy;
    principal?: ScopePrincipal;
    assertFresh: () => void;
    observe?: (policyRoot: string) => void;
    inherit?: (target: string) => Promise<void>;
    canAccessPath?: (path: string) => boolean;
    canTraversePath?: (path: string) => boolean;
    beforeWrite?: (path: string) => Promise<void>;
}
interface StorageContext extends DocumentContext {
    publicCommunityWriter?: boolean;
    documentContext?: DocumentContext;
}
export declare function withEnterpriseStorageContext<T>(value: StorageContext, operation: () => T): T;
export declare function activeDocumentStorageContext(): DocumentContext | undefined;
/** Every serialized body write passes this before the final physical guard. */
export declare function prepareDocumentWrite(path: string): Promise<void>;
export declare function assertEnterpriseStorageFresh(): void;
/** recordSource=false is for internal filename discovery only. Every physical
 * read and exposed metadata row still uses the default observing check. */
export declare function canReadEnterpriseStoragePath(path: string, recordSource?: boolean): boolean;
/** Directory enumeration only. The caller must first establish that the
 * physical entry is a directory. Never use this for body IO or writes. */
export declare function canTraverseEnterpriseStoragePath(path: string, recordSource?: boolean): boolean;
/** Optional-activity guard for trusted storage adapters whose root is not an
 * enterprise scope. Call only with a canonical logical Vault path. */
export declare function assertOwnerActivityStorageAccess(path: string): void;
/** Refresh owner consent before an optional adapter performs its physical write. */
export declare function prepareOwnerActivityStorageWrite(path: string): Promise<void>;
/** A second boundary at physical IO protects service-internal reads and writes. */
export declare function assertEnterpriseStorageAccess(path: string, write?: boolean): void;
export {};
//# sourceMappingURL=enterprise-storage-context.d.ts.map