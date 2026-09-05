/** Only confirmed path absence may be interpreted as deletion by read models. */
export declare function isMissingVaultPath(error: unknown): boolean;
/** Paths and driver details can describe another scope; never expose them. */
export declare class VaultReadUnavailableError extends Error {
    readonly code = "VAULT_READ_UNAVAILABLE";
    constructor();
}
/** A selected query row changed before hydration; no partial page is safe. */
export declare class QuerySnapshotChangedError extends Error {
    readonly code = "QUERY_SNAPSHOT_CHANGED";
    constructor();
}
//# sourceMappingURL=vault-read-errors.d.ts.map