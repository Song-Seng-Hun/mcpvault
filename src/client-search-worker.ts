import type { CachedNote } from './client-cache.js';
import { McpVaultClientSearchIndex, type ClientSearchIndexBuildOptions, type ClientSearchResponse } from './client-search.js';

export interface ClientSearchWorkerRuntime {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
}

type WorkerOperation = 'upsertMany' | 'remove' | 'clear' | 'search' | 'snapshot' | 'restore';

interface WorkerRequest {
  id: string;
  op: WorkerOperation | 'cancel';
  notes?: CachedNote[];
  path?: string;
  query?: string;
  searchOptions?: { limit?: number; maxChars?: number };
  snapshot?: string;
  buildOptions?: Pick<ClientSearchIndexBuildOptions, 'batchSize'>;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Installs the worker-side handler on any browser Worker or worker_threads
 * adapter that exposes the small runtime contract above. Requests are
 * serialized so index mutations cannot race one another.
 */
export function attachClientSearchWorker(
  runtime: ClientSearchWorkerRuntime,
  options: { maxDocuments?: number } = {},
): () => void {
  const index = new McpVaultClientSearchIndex(options);
  const controllers = new Map<string, AbortController>();
  let queue = Promise.resolve();
  const listener = (event: { data: unknown }) => {
    const request = parseRequest(event.data);
    if (!request) return;
    if (request.op === 'cancel') {
      controllers.get(request.id)?.abort();
      return;
    }
    queue = queue.then(async () => {
      const controller = new AbortController();
      controllers.set(request.id, controller);
      try {
        const result = await execute(index, request, controller.signal);
        runtime.postMessage({ id: request.id, ok: true, result } satisfies WorkerResponse);
      } catch (error) {
        runtime.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
      } finally {
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
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private readonly listener: (event: { data: unknown }) => void;

  constructor(private readonly runtime: ClientSearchWorkerRuntime) {
    this.listener = event => {
      const response = parseResponse(event.data);
      if (!response) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || 'worker operation failed'));
    };
    runtime.addEventListener('message', this.listener);
  }

  upsertMany(notes: CachedNote[], options: Pick<ClientSearchIndexBuildOptions, 'batchSize' | 'signal'> = {}): Promise<void> {
    return this.request<void>({
      op: 'upsertMany',
      notes,
      ...(options.batchSize === undefined ? {} : { buildOptions: { batchSize: options.batchSize } }),
    }, options.signal);
  }

  remove(path: string, signal?: AbortSignal): Promise<void> {
    return this.request<void>({ op: 'remove', path }, signal);
  }

  clear(signal?: AbortSignal): Promise<void> {
    return this.request<void>({ op: 'clear' }, signal);
  }

  search(query: string, options: { limit?: number; maxChars?: number } = {}, signal?: AbortSignal): Promise<ClientSearchResponse> {
    return this.request<ClientSearchResponse>({ op: 'search', query, searchOptions: options }, signal);
  }

  snapshot(signal?: AbortSignal): Promise<string> {
    return this.request<string>({ op: 'snapshot' }, signal);
  }

  restore(snapshot: string, signal?: AbortSignal): Promise<number> {
    return this.request<number>({ op: 'restore', snapshot }, signal);
  }

  close(): void {
    this.runtime.removeEventListener?.('message', this.listener);
    for (const pending of this.pending.values()) pending.reject(new Error('search worker client closed'));
    this.pending.clear();
  }

  private request<T>(request: Omit<WorkerRequest, 'id'>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error('search worker request was aborted'));
    const id = `search-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        this.runtime.postMessage({ id, op: 'cancel' } satisfies WorkerRequest);
        reject(new Error('search worker request was aborted'));
      };
      this.pending.set(id, {
        resolve: value => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
        reject: error => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      this.runtime.postMessage({ ...request, id } satisfies WorkerRequest);
    });
  }
}

async function execute(index: McpVaultClientSearchIndex, request: WorkerRequest, signal: AbortSignal): Promise<unknown> {
  switch (request.op) {
    case 'upsertMany':
      await index.upsertMany(request.notes || [], { ...request.buildOptions, signal });
      return undefined;
    case 'remove':
      if (!request.path) throw new Error('path is required');
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

function parseRequest(value: unknown): WorkerRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const request = value as Partial<WorkerRequest>;
  if (typeof request.id !== 'string' || (request.op !== 'cancel' && !['upsertMany', 'remove', 'clear', 'search', 'snapshot', 'restore'].includes(request.op || ''))) return undefined;
  return request as WorkerRequest;
}

function parseResponse(value: unknown): WorkerResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as Partial<WorkerResponse>;
  if (typeof response.id !== 'string' || typeof response.ok !== 'boolean') return undefined;
  return response as WorkerResponse;
}
