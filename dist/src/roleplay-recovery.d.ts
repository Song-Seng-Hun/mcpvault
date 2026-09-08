import { type RoleplayStoreOptions } from './roleplay-store.js';
interface Checkpoint {
    version: 1;
    vault: string;
    sequence: number;
    hash: string;
    pending?: {
        sequence: number;
        hash: string;
    };
}
export declare function inspectRoleplayRecovery(options: Pick<RoleplayStoreOptions, 'vaultPath' | 'hostPath'>): Promise<{
    fingerprint: string;
    lock: any;
    lockText: string | null;
    checkpoint: Checkpoint | null;
    turnFiles: number;
    action: string;
}>;
export declare function recoverRoleplayWriter(options: Pick<RoleplayStoreOptions, 'vaultPath' | 'hostPath'>, approval: {
    expectedFingerprint: string;
    reason: string;
}): Promise<{
    recovered: boolean;
    audit: string;
    nextAction: string;
}>;
export {};
//# sourceMappingURL=roleplay-recovery.d.ts.map