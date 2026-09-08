export interface MemoryMigrationEntry {
    scope: 'user' | 'agent' | 'model';
    identity: string;
    path: string;
    disposition: 'keep-host-private' | 'ownership-review-required' | 'manual-agent-copy-candidate';
    verifiedOwner?: string;
}
/** Host-admin inventory only: never reads bodies, mutates files or grants access. */
export declare function previewMemoryMigration(options: {
    vaultPath: string;
    verifiedAgents?: {
        agentId: string;
        userId: string;
    }[];
    limit?: number;
}): Promise<{
    automaticMigration: false;
    entries: MemoryMigrationEntry[];
    shown: number;
    truncated: boolean;
    guidance: string;
}>;
//# sourceMappingURL=enterprise-migration.d.ts.map