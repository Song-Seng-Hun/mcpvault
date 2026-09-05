/** Only confirmed path absence may be interpreted as deletion by read models. */
export declare function isMissingVaultPath(error: unknown): boolean;
/** Paths and driver details can describe another scope; never expose them. */
export declare class VaultReadUnavailableError extends Error {
    readonly code = "VAULT_READ_UNAVAILABLE";
    constructor();
}
//# sourceMappingURL=vault-read-errors.d.ts.map