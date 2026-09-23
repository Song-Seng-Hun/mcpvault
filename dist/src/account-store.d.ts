/** Validate metadata only, before opening the account database. Never fixes ACLs
 * or creates a missing store: explicit operator provisioning is required. */
export declare function assertPrivateAccountStore(vaultPath: string, path: string): Promise<void>;
//# sourceMappingURL=account-store.d.ts.map