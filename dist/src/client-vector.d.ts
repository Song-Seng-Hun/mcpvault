import type { AsyncClientKeyValueStore, ClientKeyValueStore } from './client-cache.js';
export interface ClientVectorSearchResult {
    path: string;
    score: number;
    revision: string;
}
export interface ClientVectorSearchResponse {
    /** False because this index contains only vectors explicitly supplied by the host. */
    complete: false;
    indexedDocuments: number;
    dimension: number;
    results: ClientVectorSearchResult[];
}
export interface ClientVectorIndexOptions {
    maxDocuments?: number;
    dimension?: number;
}
/**
 * Lightweight host-side vector ranking. The host owns embedding generation;
 * this class only stores bounded normalized vectors and ranks explicitly
 * supplied candidates. Callers must confirm results with authoritative server
 * search/read and scope checks before using them as current data.
 */
export declare class McpVaultClientVectorIndex {
    private readonly entries;
    private readonly dirtyPaths;
    private readonly maxDocuments;
    private readonly configuredDimension;
    private dimension;
    constructor(options?: ClientVectorIndexOptions);
    upsert(path: string, revision: string, vector: ArrayLike<number>): void;
    remove(path: string): boolean;
    clear(): void;
    size(): number;
    search(queryVector: ArrayLike<number>, options?: {
        limit?: number;
        minScore?: number;
    }): ClientVectorSearchResponse;
    snapshot(): string;
    restore(snapshot: string): number;
    persist(store: ClientKeyValueStore, key: string): void;
    hydrate(store: ClientKeyValueStore, key: string): number;
    persistAsync(store: AsyncClientKeyValueStore, key: string): Promise<void>;
    hydrateAsync(store: AsyncClientKeyValueStore, key: string): Promise<number>;
    persistIncremental(store: ClientKeyValueStore, key: string): void;
    persistIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<void>;
    hydrateIncremental(store: ClientKeyValueStore, key: string): number;
    hydrateIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<number>;
    private assertDimension;
}
//# sourceMappingURL=client-vector.d.ts.map