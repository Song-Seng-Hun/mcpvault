/** Only confirmed path absence may be interpreted as deletion by read models. */
export function isMissingVaultPath(error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
/** Paths and driver details can describe another scope; never expose them. */
export class VaultReadUnavailableError extends Error {
    code = 'VAULT_READ_UNAVAILABLE';
    constructor() {
        super('Vault read unavailable; retry after storage access is restored.');
        this.name = 'VaultReadUnavailableError';
    }
}
