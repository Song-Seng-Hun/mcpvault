/** Only confirmed path absence may be interpreted as deletion by read models. */
export function isMissingVaultPath(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Paths and driver details can describe another scope; never expose them. */
export class VaultReadUnavailableError extends Error {
  readonly code = 'VAULT_READ_UNAVAILABLE';
  constructor() {
    super('Vault read unavailable; retry after storage access is restored.');
    this.name = 'VaultReadUnavailableError';
  }
}

/** A selected query row changed before hydration; no partial page is safe. */
export class QuerySnapshotChangedError extends Error {
  readonly code = 'QUERY_SNAPSHOT_CHANGED';
  constructor() {
    super('Query snapshot changed; discard this page and restart the query from its first page (without after/offset).');
    this.name = 'QuerySnapshotChangedError';
  }
}
