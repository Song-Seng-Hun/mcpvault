import type { ClientEndpointCaller } from './client-cache.js';
export interface ClientReferenceReadOptions {
    includeContent?: boolean;
    limit?: number;
    maxChars?: number;
    accessToken?: string;
    /** Use a stable per-principal value when one cache instance serves private sessions. */
    cachePartition?: string;
    signal?: AbortSignal;
}
export interface ClientReferenceCacheOptions {
    maxEntries?: number;
}
/**
 * Bounded host-side cache for authorized reference resolution. The source
 * revision is mandatory so edits naturally invalidate a cached resolution.
 */
export declare class ClientReferenceCache {
    private readonly caller;
    private readonly entries;
    private readonly inFlight;
    private readonly maxEntries;
    constructor(caller: ClientEndpointCaller, options?: ClientReferenceCacheOptions);
    read(path: string, revision: string, options?: ClientReferenceReadOptions): Promise<Record<string, unknown>>;
    invalidate(path?: string, revision?: string): void;
    clear(): void;
    size(): number;
    private readUncached;
}
//# sourceMappingURL=client-references.d.ts.map