import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
interface StorageContext {
    access: ScopeAccessPolicy;
    principal?: ScopePrincipal;
    assertFresh: () => void;
    publicCommunityWriter?: boolean;
}
export declare function withEnterpriseStorageContext<T>(value: StorageContext, operation: () => T): T;
export declare function assertEnterpriseStorageFresh(): void;
export declare function canReadEnterpriseStoragePath(path: string): boolean;
/** A second boundary at physical IO protects service-internal reads and writes. */
export declare function assertEnterpriseStorageAccess(path: string, write?: boolean): void;
export {};
//# sourceMappingURL=enterprise-storage-context.d.ts.map