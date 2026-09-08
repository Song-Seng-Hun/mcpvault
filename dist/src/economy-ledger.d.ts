import { type EconomyCommand, type EconomyPolicy, type EconomyReceipt, type EconomyState } from './economy-model.js';
export interface EconomyLedgerOptions {
    vaultPath: string;
    /** Existing private host directory outside the Vault and source checkout. */
    hostPath: string;
    /** Explicit host attestation: local storage with exclusive create + atomic rename.
     * Never accepted as a tool argument. Network/NAS storage must not be attested. */
    storageVerified: boolean;
    policy: EconomyPolicy;
    now?: () => Date;
}
export declare function assertEconomyConfigured(vaultPath: string, configured: boolean): Promise<void>;
export declare function admitEconomyEventBytes(existing: number, proposed: number): void;
/** One writer for the canonical Vault, no lock stealing on timeout. A crash leaves
 * an explicit recovery condition; removing a live writer's lock is never safe.
 * Journal Markdown is authoritative. The external checkpoint only detects rollback. */
export declare class EconomyLedger {
    private readonly options;
    private readonly vault;
    private readonly host;
    private readonly nonce;
    private readonly frontmatter;
    private readonly journal;
    private readonly checkpointPath;
    private readonly lockPath;
    private lock;
    private queue;
    private closed;
    private closing;
    private constructor();
    static initialize(options: EconomyLedgerOptions): Promise<EconomyLedger>;
    static open(options: EconomyLedgerOptions): Promise<EconomyLedger>;
    private static acquire;
    private assertLock;
    private releaseLock;
    private serialized;
    close(): Promise<void>;
    private checkpoint;
    private saveCheckpoint;
    private replay;
    private makeEvent;
    snapshot(): Promise<EconomyState>;
    transact(command: EconomyCommand, revalidate?: () => Promise<void>): Promise<EconomyReceipt>;
}
//# sourceMappingURL=economy-ledger.d.ts.map