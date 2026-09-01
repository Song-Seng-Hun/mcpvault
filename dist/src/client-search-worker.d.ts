import type { CachedNote } from './client-cache.js';
import { type ClientSearchIndexBuildOptions, type ClientSearchResponse } from './client-search.js';
export interface ClientSearchWorkerRuntime {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
    removeEventListener?(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
}
/**
 * Installs the worker-side handler on any browser Worker or worker_threads
 * adapter that exposes the small runtime contract above. Requests are
 * serialized so index mutations cannot race one another.
 */
export declare function attachClientSearchWorker(runtime: ClientSearchWorkerRuntime, options?: {
    maxDocuments?: number;
}): () => void;
/**
 * Main-thread adapter for the worker protocol. It transfers notes and search
 * work to the supplied runtime; authorization and authoritative freshness
 * checks remain outside this local optimization.
 */
export declare class ClientSearchWorkerClient {
    private readonly runtime;
    private readonly pending;
    private sequence;
    private readonly listener;
    constructor(runtime: ClientSearchWorkerRuntime);
    upsertMany(notes: CachedNote[], options?: Pick<ClientSearchIndexBuildOptions, 'batchSize' | 'signal'>): Promise<void>;
    remove(path: string, signal?: AbortSignal): Promise<void>;
    clear(signal?: AbortSignal): Promise<void>;
    search(query: string, options?: {
        limit?: number;
        maxChars?: number;
    }, signal?: AbortSignal): Promise<ClientSearchResponse>;
    snapshot(signal?: AbortSignal): Promise<string>;
    restore(snapshot: string, signal?: AbortSignal): Promise<number>;
    close(): void;
    private request;
}
//# sourceMappingURL=client-search-worker.d.ts.map