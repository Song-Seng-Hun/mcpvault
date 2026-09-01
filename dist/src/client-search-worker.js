import { McpVaultClientSearchIndex } from './client-search.js';
/**
 * Installs the worker-side handler on any browser Worker or worker_threads
 * adapter that exposes the small runtime contract above. Requests are
 * serialized so index mutations cannot race one another.
 */
export function attachClientSearchWorker(runtime, options = {}) {
    const index = new McpVaultClientSearchIndex(options);
    const controllers = new Map();
    let queue = Promise.resolve();
    const listener = (event) => {
        const request = parseRequest(event.data);
        if (!request)
            return;
        if (request.op === 'cancel') {
            controllers.get(request.id)?.abort();
            return;
        }
        queue = queue.then(async () => {
            const controller = new AbortController();
            controllers.set(request.id, controller);
            try {
                const result = await execute(index, request, controller.signal);
                runtime.postMessage({ id: request.id, ok: true, result });
            }
            catch (error) {
                runtime.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
            }
            finally {
                controllers.delete(request.id);
            }
        });
    };
    runtime.addEventListener('message', listener);
    return () => runtime.removeEventListener?.('message', listener);
}
/**
 * Main-thread adapter for the worker protocol. It transfers notes and search
 * work to the supplied runtime; authorization and authoritative freshness
 * checks remain outside this local optimization.
 */
export class ClientSearchWorkerClient {
    runtime;
    pending = new Map();
    sequence = 0;
    listener;
    constructor(runtime) {
        this.runtime = runtime;
        this.listener = event => {
            const response = parseResponse(event.data);
            if (!response)
                return;
            const pending = this.pending.get(response.id);
            if (!pending)
                return;
            this.pending.delete(response.id);
            if (response.ok)
                pending.resolve(response.result);
            else
                pending.reject(new Error(response.error || 'worker operation failed'));
        };
        runtime.addEventListener('message', this.listener);
    }
    upsertMany(notes, options = {}) {
        return this.request({
            op: 'upsertMany',
            notes,
            ...(options.batchSize === undefined ? {} : { buildOptions: { batchSize: options.batchSize } }),
        }, options.signal);
    }
    remove(path, signal) {
        return this.request({ op: 'remove', path }, signal);
    }
    clear(signal) {
        return this.request({ op: 'clear' }, signal);
    }
    search(query, options = {}, signal) {
        return this.request({ op: 'search', query, searchOptions: options }, signal);
    }
    snapshot(signal) {
        return this.request({ op: 'snapshot' }, signal);
    }
    restore(snapshot, signal) {
        return this.request({ op: 'restore', snapshot }, signal);
    }
    close() {
        this.runtime.removeEventListener?.('message', this.listener);
        for (const pending of this.pending.values())
            pending.reject(new Error('search worker client closed'));
        this.pending.clear();
    }
    request(request, signal) {
        if (signal?.aborted)
            return Promise.reject(new Error('search worker request was aborted'));
        const id = `search-${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                this.pending.delete(id);
                this.runtime.postMessage({ id, op: 'cancel' });
                reject(new Error('search worker request was aborted'));
            };
            this.pending.set(id, {
                resolve: value => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                reject: error => {
                    signal?.removeEventListener('abort', onAbort);
                    reject(error);
                },
            });
            signal?.addEventListener('abort', onAbort, { once: true });
            this.runtime.postMessage({ ...request, id });
        });
    }
}
/**
 * Shards local search documents across a bounded Worker set. A stable path
 * hash keeps updates and removals on the same shard; queries fan out and
 * merge only each worker's bounded top-K results.
 */
export class ClientSearchWorkerPool {
    workers;
    constructor(options) {
        const workerCount = options.workerCount ?? 2;
        if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8)
            throw new Error('workerCount must be between 1 and 8');
        this.workers = Array.from({ length: workerCount }, () => new ClientSearchWorkerClient(options.createRuntime()));
    }
    async upsertMany(notes, options = {}) {
        const shards = this.partition(notes);
        await Promise.all(this.workers.map((worker, index) => worker.upsertMany(shards[index], options)));
    }
    remove(path, signal) {
        return this.workerFor(path).remove(path, signal);
    }
    async clear(signal) {
        await Promise.all(this.workers.map(worker => worker.clear(signal)));
    }
    async search(query, options = {}, signal) {
        const responses = await Promise.all(this.workers.map(worker => worker.search(query, options, signal)));
        const limit = Math.min(Math.max(Math.floor(options.limit ?? 5), 1), 50);
        const results = responses.flatMap(response => response.results)
            .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
            .slice(0, limit);
        return {
            complete: false,
            indexedDocuments: responses.reduce((total, response) => total + response.indexedDocuments, 0),
            results,
        };
    }
    async snapshot(signal) {
        const snapshots = await Promise.all(this.workers.map(worker => worker.snapshot(signal)));
        return JSON.stringify({ version: 1, shards: snapshots });
    }
    async restore(snapshot, signal) {
        let parsed;
        try {
            parsed = JSON.parse(snapshot);
        }
        catch {
            return 0;
        }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.shards))
            return 0;
        const shards = parsed.shards;
        if (shards.length !== this.workers.length || !shards.every(shard => typeof shard === 'string'))
            throw new Error('search worker snapshot shard count does not match the pool');
        const restored = await Promise.all(this.workers.map((worker, index) => worker.restore(shards[index], signal)));
        return restored.reduce((total, count) => total + count, 0);
    }
    close() {
        for (const worker of this.workers)
            worker.close();
    }
    partition(notes) {
        const shards = this.workers.map(() => []);
        for (const note of notes)
            shards[this.shardFor(note.path)].push(note);
        return shards;
    }
    workerFor(path) {
        return this.workers[this.shardFor(path)];
    }
    shardFor(path) {
        return hashPath(path) % this.workers.length;
    }
}
async function execute(index, request, signal) {
    switch (request.op) {
        case 'upsertMany':
            await index.upsertMany(request.notes || [], { ...request.buildOptions, signal });
            return undefined;
        case 'remove':
            if (!request.path)
                throw new Error('path is required');
            index.remove(request.path);
            return undefined;
        case 'clear':
            index.clear();
            return undefined;
        case 'search':
            return index.search(request.query || '', request.searchOptions);
        case 'snapshot':
            return index.snapshot();
        case 'restore':
            return index.restore(request.snapshot || '');
        default:
            throw new Error('unsupported worker operation');
    }
}
function parseRequest(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const request = value;
    if (typeof request.id !== 'string' || (request.op !== 'cancel' && !['upsertMany', 'remove', 'clear', 'search', 'snapshot', 'restore'].includes(request.op || '')))
        return undefined;
    return request;
}
function parseResponse(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const response = value;
    if (typeof response.id !== 'string' || typeof response.ok !== 'boolean')
        return undefined;
    return response;
}
function hashPath(path) {
    let hash = 2166136261;
    for (const character of String(path)) {
        hash ^= character.codePointAt(0) || 0;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
