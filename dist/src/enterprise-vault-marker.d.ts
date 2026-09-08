interface EnterpriseVaultMarker {
    version: 1;
    mode: 'public' | 'company';
    realmId: string;
}
export declare function readEnterpriseVaultMarker(vaultPath: string): EnterpriseVaultMarker | undefined;
export declare function ensureEnterpriseVaultMarker(vaultPath: string, profile: Omit<EnterpriseVaultMarker, 'version'>): Promise<void>;
export {};
//# sourceMappingURL=enterprise-vault-marker.d.ts.map