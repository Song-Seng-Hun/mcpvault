import type { CachedNote } from './client-cache.js';
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
/**
 * Lightweight host-side first-pass search over explicitly cached notes. It is
 * an optimization only: callers must use the server search/revision contract
 * before treating a result as current or authoritative.
 */
export declare class McpVaultClientSearchIndex {
    private readonly documents;
    upsert(note: CachedNote): void;
    remove(path: string): void;
    clear(): void;
    size(): number;
    search(query: string, options?: {
        limit?: number;
        maxChars?: number;
    }): ClientSearchResponse;
}
//# sourceMappingURL=client-search.d.ts.map