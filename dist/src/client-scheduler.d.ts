export interface ClientScheduleOptions {
    /** Higher values run first when the queue is waiting. */
    priority?: number;
    /** A queued task is discarded if its signal is already aborted. */
    signal?: AbortSignal;
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
    constructor(maxConcurrency?: number);
    run<T>(key: string, task: () => Promise<T> | T, options?: ClientScheduleOptions): Promise<T>;
    pending(): number;
    running(): number;
    private pump;
}
//# sourceMappingURL=client-scheduler.d.ts.map