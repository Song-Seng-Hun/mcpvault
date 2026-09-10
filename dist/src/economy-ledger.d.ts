import { type EconomyCommand, type EconomyPolicy, type EconomyReceipt, type EconomyState, type BenchmarkAwardProof } from './economy-model.js';
export interface EconomyLedgerOptions {
    vaultPath: string;
    /** Existing private host directory outside the Vault and source checkout. */
    hostPath: string;
    /** Optional explicitly bound local journal directory for a separate live Wiki. */
    ledgerPath?: string;
    /** Explicit host attestation: local storage with exclusive create + atomic rename.
     * Never accepted as a tool argument. Network/NAS storage must not be attested. */
    storageVerified: boolean;
    policy: EconomyPolicy;
    now?: () => Date;
    /** Host-only adapters, never constructed from endpoint input. Proof validation
     * must re-read current sealed adjudication and sources inside this ledger queue. */
    benchmarkAuthority?: {
        assertHumanOperator: (actor: string) => Promise<void>;
        validateAward: (proof: BenchmarkAwardProof, state: EconomyState) => Promise<void>;
    };
}
export declare function assertEconomyConfigured(vaultPath: string, configured: boolean): Promise<void>;
export declare function admitEconomyEventBytes(existing: number, proposed: number): void;
/** Reject gaps before any pending intent can be published.  In particular, a
 * count alone cannot establish that the next filename is unused. */
export declare function assertContiguousEconomyJournalNames(entries: readonly string[]): string[];
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
    private readonly preparedPath;
    private readonly lockPath;
    private lock;
    private queue;
    private closed;
    private closing;
    private assertStorageBinding;
    private constructor();
    static initialize(options: EconomyLedgerOptions): Promise<EconomyLedger>;
    static open(options: EconomyLedgerOptions): Promise<EconomyLedger>;
    private static acquire;
    private assertNoRecovery;
    private assertLock;
    private releaseLock;
    private serialized;
    close(): Promise<void>;
    private checkpoint;
    private saveCheckpoint;
    private replay;
    private makeEvent;
    snapshot(): Promise<EconomyState>;
    walletSnapshot(account: string): Promise<{
        state: EconomyState;
        transactions: Record<string, unknown>[];
        historyLimited: boolean;
    }>;
    transact(command: EconomyCommand, revalidate?: (state: EconomyState) => Promise<void>): Promise<EconomyReceipt>;
}
//# sourceMappingURL=economy-ledger.d.ts.map