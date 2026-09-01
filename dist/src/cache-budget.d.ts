/**
 * A process-wide budget for disposable, derived caches.
 *
 * Markdown/Git and the read models remain authoritative. This budget only
 * evicts values that can be rebuilt from those sources, so memory pressure
 * cannot change the visible data or search semantics.
 */
export declare const DEFAULT_DERIVED_CACHE_BUDGET_BYTES: number;
export interface DerivedCacheRegistrationOptions {
    /** Keep one bounded-but-large snapshot resident instead of rebuilding it per request. */
    allowOversized?: boolean;
}
export declare class DerivedCacheBudget {
    readonly maxBytes: number;
    private readonly entries;
    private readonly lruHeap;
    private totalBytes;
    private clock;
    constructor(maxBytes?: number);
    register(owner: string, key: string, bytes: number, onEvict: () => void, options?: DerivedCacheRegistrationOptions): void;
    touch(owner: string, key: string): void;
    remove(owner: string, key: string): void;
    clearOwner(owner: string): void;
    snapshot(): {
        maxBytes: number;
        totalBytes: number;
        entries: number;
    };
    private id;
    private removeById;
    private enforce;
    private heapMoveUp;
    private heapMoveDown;
    private heapSwap;
}
export declare const derivedCacheBudget: DerivedCacheBudget;
export declare function createDerivedCacheOwner(prefix: string): string;
export declare function estimateCacheBytes(value: unknown): number;
//# sourceMappingURL=cache-budget.d.ts.map