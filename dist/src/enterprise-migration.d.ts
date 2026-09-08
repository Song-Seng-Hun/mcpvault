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
    guidance: "Legacy User files stay host-private. Re-enroll employees and runtimes, verify ownership, and explicitly review any copy into newly approved memory. Never infer owners from model names.";
}>;
//# sourceMappingURL=enterprise-migration.d.ts.map