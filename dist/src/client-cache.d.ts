export interface ClientEndpointCaller {
    callEndpoint(endpointId: string, arguments_: Record<string, unknown>): Promise<unknown>;
}
export interface ClientKeyValueStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}
export interface CachedNote {
    path: string;
    revision: string;
    content?: string;
    frontmatter?: Record<string, unknown>;
    obsidianUri?: string;
}
export interface ClientReadNotesOptions {
    includeContent?: boolean;
    includeFrontmatter?: boolean;
    force?: boolean;
}
export interface ClientReadNotesResult {
    notes: CachedNote[];
    unchanged: string[];
    missing: string[];
    errors: Array<{
        path: string;
        error: string;
    }>;
}
export interface ClientStaleReadResult {
    /** Locally cached notes available immediately; they may be stale. */
    immediate: ClientReadNotesResult;
    /** Revision-checked refresh. Changed note bodies are fetched by the server. */
    refresh: Promise<ClientReadNotesResult>;
}
/**
 * Small host-side cache for MCPVault note reads. It deliberately knows only
 * the public endpoint contract: authorization and visibility remain inside
 * MCPVault, while this class owns LRU eviction and conditional batch reads.
 */
export declare class McpVaultClientCache {
    private readonly caller;
    private readonly entries;
    private readonly inFlight;
    private readonly dirtyPaths;
    private readonly maxEntries;
    constructor(caller: ClientEndpointCaller, options?: {
        maxEntries?: number;
    });
    get(path: string): CachedNote | undefined;
    values(): CachedNote[];
    snapshot(): string;
    restore(snapshot: string): number;
    persist(store: ClientKeyValueStore, key: string): void;
    persistIncremental(store: ClientKeyValueStore, key: string): void;
    hydrate(store: ClientKeyValueStore, key: string): number;
    hydrateIncremental(store: ClientKeyValueStore, key: string): number;
    invalidate(path?: string): void;
    knownRevisions(paths: string[]): Record<string, string>;
    readNotes(paths: string[], options?: ClientReadNotesOptions): Promise<ClientReadNotesResult>;
    readNotesStale(paths: string[], options?: ClientReadNotesOptions): ClientStaleReadResult;
    private readNotesUncached;
    private put;
}
//# sourceMappingURL=client-cache.d.ts.map