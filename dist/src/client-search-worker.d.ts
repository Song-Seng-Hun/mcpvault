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
export interface ClientSearchWorkerPoolOptions {
    workerCount?: number;
    createRuntime: () => ClientSearchWorkerRuntime;
}
/**
 * Shards local search documents across a bounded Worker set. A stable path
 * hash keeps updates and removals on the same shard; queries fan out and
 * merge only each worker's bounded top-K results.
 */
export declare class ClientSearchWorkerPool {
    private readonly workers;
    constructor(options: ClientSearchWorkerPoolOptions);
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
    private partition;
    private workerFor;
    private shardFor;
}
//# sourceMappingURL=client-search-worker.d.ts.map