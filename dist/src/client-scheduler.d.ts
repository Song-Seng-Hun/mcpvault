export interface ClientScheduleOptions {
    /** Higher values run first when the queue is waiting. */
    priority?: number;
    /** A queued task is discarded if its signal is aborted; running tasks receive it too. */
    signal?: AbortSignal;
}
export interface ClientRequestSchedulerOptions {
    /** Hard upper bound for concurrent work. */
    maxConcurrency?: number;
    /** Lower bound used when adaptive control is enabled; defaults to 1. */
    minConcurrency?: number;
    /** Starting concurrency used when adaptive control is enabled. */
    initialConcurrency?: number;
    /** Enable additive-increase/multiplicative-decrease backpressure. */
    adaptive?: boolean;
    /** Successful work slower than this target is treated as congested. */
    targetLatencyMs?: number;
}
/**
 * Host-side priority queue for MCP calls and local work. It coalesces the
 * same key while it is running, bounds concurrency, and never changes the
 * server's authorization or visibility decisions.
 */
export declare class ClientRequestScheduler {
    private readonly queue;
    private readonly inFlight;
    private active;
    private sequence;
    private readonly maxConcurrency;
    private readonly minConcurrency;
    private readonly adaptive;
    private readonly targetLatencyMs;
    private concurrency;
    constructor(options?: number | ClientRequestSchedulerOptions);
    run<T>(key: string, task: (signal?: AbortSignal) => Promise<T> | T, options?: ClientScheduleOptions): Promise<T>;
    pending(): number;
    running(): number;
    currentConcurrency(): number;
    private pump;
    private recordOutcome;
}
//# sourceMappingURL=client-scheduler.d.ts.map