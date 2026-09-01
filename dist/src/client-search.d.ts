import type { AsyncClientKeyValueStore, CachedNote, ClientKeyValueStore } from './client-cache.js';
export interface ClientSearchResult {
    path: string;
    score: number;
    excerpt: string;
    revision: string;
}
export interface ClientSearchResponse {
    /** False because the client index contains only documents explicitly cached by the host. */
    complete: false;
    indexedDocuments: number;
    results: ClientSearchResult[];
}
export interface ClientSearchIndexBuildOptions {
    /** Number of notes indexed before yielding to the host; defaults to 16. */
    batchSize?: number;
    /** Cancel a background indexing pass without affecting existing entries. */
    signal?: AbortSignal;
    /** Host-provided idle hook, such as a requestIdleCallback wrapper. */
    yield?: () => Promise<void>;
}
/**
 * Lightweight host-side first-pass search over explicitly cached notes. It is
 * an optimization only: callers must use the server search/revision contract
 * before treating a result as current or authoritative.
 */
export declare class McpVaultClientSearchIndex {
    private readonly documents;
    private readonly postings;
    private readonly searchCache;
    private readonly dirtyPaths;
    private readonly maxDocuments;
    constructor(options?: {
        maxDocuments?: number;
    });
    upsert(note: CachedNote): void;
    /**
     * Builds or refreshes an index in bounded batches. The default macrotask
     * yield keeps a browser/agent host responsive; hosts can inject a stronger
     * idle callback or a worker bridge through `yield`.
     */
    upsertMany(notes: CachedNote[], options?: ClientSearchIndexBuildOptions): Promise<void>;
    remove(path: string): void;
    clear(): void;
    size(): number;
    values(): CachedNote[];
    snapshot(): string;
    restore(snapshot: string): number;
    persist(store: ClientKeyValueStore, key: string): void;
    hydrate(store: ClientKeyValueStore, key: string): number;
    /**
     * Persists only changed or newly indexed documents plus a small manifest.
     * The host store remains responsible for choosing protected storage.
     */
    persistIncremental(store: ClientKeyValueStore, key: string): void;
    persistIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<void>;
    hydrateIncremental(store: ClientKeyValueStore, key: string): number;
    hydrateIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<number>;
    search(query: string, options?: {
        limit?: number;
        maxChars?: number;
    }): ClientSearchResponse;
    private unindex;
}
//# sourceMappingURL=client-search.d.ts.map