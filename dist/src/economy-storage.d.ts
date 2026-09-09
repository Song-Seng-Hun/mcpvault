export interface EconomyStoragePaths {
    vaultPath: string;
    hostPath: string;
    ledgerPath?: string;
}
export declare function assertLegacyEconomyStorage(options: EconomyStoragePaths): Promise<void>;
/** Reuse the established no-junction, canonical NAS/local-host path checks.
 * The journal and checkpoint are disjoint local directories; neither is a Wiki
 * replica. NAS contains only an admission marker, never a local-storage attestation. */
export declare function validateEconomyStoragePaths(options: EconomyStoragePaths): Promise<Required<EconomyStoragePaths>>;
/** Private binding precedes the immutable NAS admission marker. A torn or
 * half-published initialization fails closed, never silently recreated. */
export declare function bindEconomyStorage(options: EconomyStoragePaths, initialize?: boolean): Promise<{
    vaultPath: string;
    hostPath: string;
    ledgerPath: string;
    assertBinding: () => Promise<void>;
}>;
//# sourceMappingURL=economy-storage.d.ts.map