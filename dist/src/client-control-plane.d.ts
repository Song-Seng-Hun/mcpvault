export interface ClientMcpCaller {
    callTool(toolName: string, arguments_: Record<string, unknown>): Promise<unknown>;
}
export interface ClientCapabilityCatalogCacheOptions {
    maxEntries?: number;
    ttlMs?: number;
    now?: () => number;
}
/** Bounded TTL cache for the five stable MCP control-plane tools. */
export declare class ClientCapabilityCatalogCache {
    private readonly caller;
    private readonly entries;
    private readonly inFlight;
    private readonly maxEntries;
    private readonly ttlMs;
    private readonly now;
    constructor(caller: ClientMcpCaller, options?: ClientCapabilityCatalogCacheOptions);
    listActive(arguments_?: Record<string, unknown>, cachePartition?: string): Promise<unknown>;
    search(arguments_: Record<string, unknown>, cachePartition?: string): Promise<unknown>;
    invalidate(cachePartition?: string): void;
    clear(): void;
    size(): number;
    private read;
}
export interface ClientHeartbeatBackoffOptions {
    minDelayMs?: number;
    maxDelayMs?: number;
    multiplier?: number;
    /** Randomized spread around each delay; defaults to 10%. */
    jitterRatio?: number;
    /** Injectable random source returning a value in [0, 1) for deterministic tests. */
    random?: () => number;
}
/** Calculates a bounded next heartbeat delay; it does not schedule model calls. */
export declare class ClientHeartbeatBackoff {
    private readonly minDelayMs;
    private readonly maxDelayMs;
    private readonly multiplier;
    private readonly jitterRatio;
    private readonly random;
    private delayMs;
    constructor(options?: ClientHeartbeatBackoffOptions);
    next(hasActivity: boolean): number;
    reset(): void;
    current(): number;
    private withJitter;
}
//# sourceMappingURL=client-control-plane.d.ts.map