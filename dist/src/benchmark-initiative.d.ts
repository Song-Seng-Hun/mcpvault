export type BenchmarkInitiativeState = 'disabled' | 'pending_approval' | 'active' | 'empty' | 'unknown';
export interface BenchmarkCandidateLink {
    url: string;
    reason: string;
    reuse: 'verified_reusable' | 'unknown';
}
export interface BenchmarkInitiativeHost {
    enabled: boolean;
    topic: string;
    /** Verified host identities; retained only in the existing private run receipt. */
    collectorAccounts: readonly string[];
    collectorOwnerIds: readonly string[];
    status(): Promise<{
        busy: boolean;
        pendingApproval: boolean;
        inFlight: boolean;
    }>;
    /** Existing host-wide atomic DURABLE execution receipt, shared by all accounts
     * and processes. Count reservation even on failure/interruption; never reset it.
     * The host must keep inFlight true until an aborted child actually stops. */
    reserveAttempt(params: {
        domain: 'benchmark-discovery';
        day: string;
        maxAttempts: 1;
        maxDurationMs: 300000;
        deadline: string;
    }): Promise<boolean>;
    finishAttempt(params: {
        domain: 'benchmark-discovery';
        day: string;
        outcome: string;
        collectorAccounts: readonly string[];
        collectorOwnerIds: readonly string[];
    }): Promise<void>;
    searchWiki(params: {
        query: string;
        urls?: string[];
        limit: 3;
        maxChars: 2000;
        signal: AbortSignal;
    }): Promise<{
        state: 'clear' | 'pending' | 'unknown';
        existingUrls: string[];
    }>;
    /** Host's existing public search connector, NOT an arbitrary fetch/exec hook.
     * No login, paid access, dataset/archive download, enumeration or answer body. */
    searchPublicLinks(params: {
        query: string;
        maxLinks: 3;
        publicOnly: true;
        linkOnly: true;
        signal: AbortSignal;
    }): Promise<BenchmarkCandidateLink[]>;
    /** Existing Wiki capture + same-target revision reread. No candidate database.
     * Must check signal at its own durable boundary and use the run's retry key. */
    captureWiki(params: {
        candidates: Array<BenchmarkCandidateLink & {
            disposition: 'human_review' | 'link_only_hold';
        }>;
        pendingHumanApproval: true;
        requestId: string;
        signal: AbortSignal;
    }): Promise<{
        path: string;
        revision: string;
    }>;
}
/** Invoked ONLY by an existing approved host hook. This function installs no
 * scheduler, launches no model, creates no receipts store and opens no challenge.
 * Missing host integrations are an explicit inactive state, never simulated. */
export declare function runBenchmarkInitiative(params: {
    host?: BenchmarkInitiativeHost;
    inspect: () => Promise<{
        state: BenchmarkInitiativeState;
    }>;
    trigger: 'session_start' | 'work_completion' | 'approved_heartbeat';
    now?: () => number;
}): Promise<Record<string, unknown>>;
//# sourceMappingURL=benchmark-initiative.d.ts.map