import { type EconomyCommand, type EconomyPolicy, type EconomyState } from './economy-model.js';
import type { FileSystemService } from './filesystem.js';
import { type EconomyStoragePaths } from './economy-storage.js';
export interface EconomyHostConfig {
    version: 1;
    vaultPath: string;
    hostPath: string;
    ledgerPath?: string;
    policy: EconomyPolicy;
}
/** Configuration is a host file, never a note or MCP argument. Loading is read-only. */
export declare function loadEconomyHostConfig(configPath: string, expectedVault: string): Promise<EconomyHostConfig>;
/** Conservative OS classification plus a bounded exclusive-create/fsync/rename
 * probe. This checks supported local semantics, not power-loss hardware claims. */
export declare function probeEconomyStorage(directory: string): Promise<{
    path: string;
    filesystem: string;
    probe: 'exclusive-create-sync-rename';
}>;
export declare function inspectEconomyRecovery(options: EconomyStoragePaths): Promise<{
    fingerprint: string;
    lock: any;
    checkpoint: any;
    journalFiles: number;
    action: string;
}>;
/** Runs inside the ledger's serialized commit path.  It deliberately receives
 * the already-replayed state so callers never call ledger.snapshot() recursively. */
export declare function validateOperatorAdjudication(state: EconomyState, command: EconomyCommand, fs: FileSystemService): Promise<void>;
export declare function recoverEconomyWriter(options: EconomyStoragePaths, approval: {
    expectedFingerprint: string;
    reason: string;
}): Promise<{
    recovered: boolean;
    audit: string;
    nextAction: string;
}>;
//# sourceMappingURL=economy-host.d.ts.map