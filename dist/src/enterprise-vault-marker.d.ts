interface EnterpriseVaultMarker {
    version: 1;
    mode: 'public' | 'company';
    realmId: string;
}
export declare function readEnterpriseVaultMarker(vaultPath: string): EnterpriseVaultMarker | undefined;
export {};
//# sourceMappingURL=enterprise-vault-marker.d.ts.map