import { type RoleplayCommand, type RoleplayPolicy, type RoleplayReceipt, type RoleplayState } from './roleplay-model.js';
export declare const ROLEPLAY_ROOT = "Community/Roleplay/Turns";
export declare const roleplayTurnPath: (sequence: number) => string;
export interface RoleplayStoreOptions {
    vaultPath: string;
    hostPath: string;
    policy: RoleplayPolicy;
}
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
interface Event {
    version: 1;
    sequence: number;
    previous: string;
    command: RoleplayCommand;
    policy: RoleplayPolicy;
    receipt: RoleplayReceipt;
    at: string;
    hash: string;
}
interface Replay {
    state: RoleplayState;
    checkpoint: Checkpoint;
    bytes: number;
    records: Array<{
        path: string;
        revision: string;
        event: Event;
        content: string;
        frontmatter: Record<string, any>;
    }>;
}
export declare const ROLEPLAY_REPLAY_MAX_BYTES: number;
export declare function assertRoleplayReplayAdmission(existingBytes: number, candidateBytes: number): void;
export declare function canonicalTurnNames(dir: string): Promise<string[]>;
/** Single writer, durable intent before canonical Markdown, trusted tail outside the Vault.
 * No second chat log and no authoritative state snapshot. The journal is replayable.
 * Host checkpoint is integrity metadata, not a disposable index or a secret-vault claim. */
export declare class RoleplayStore {
    readonly options: RoleplayStoreOptions;
    private lock;
    private readonly nonce;
    private queue;
    private closing;
    private readonly fm;
    private verified;
    private constructor();
    private get lockPath();
    private get checkpointPath();
    private get preparedPath();
    static open(options: RoleplayStoreOptions): Promise<RoleplayStore>;
    private assertNoRecovery;
    private assertWriter;
    private release;
    private serial;
    close(): Promise<void>;
    private saveCheckpoint;
    private encode;
    private replay;
    snapshot(): Promise<RoleplayState>;
    read(): Promise<Replay>;
    transact(command: RoleplayCommand, revalidate?: (state: RoleplayState) => Promise<void>): Promise<RoleplayReceipt & {
        path: string;
        noteRevision: string;
    }>;
}
export {};
//# sourceMappingURL=roleplay-store.d.ts.map