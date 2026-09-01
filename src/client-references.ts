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

interface ReferenceCacheEntry {
  path: string;
  revision: string;
  partition: string;
  value: Record<string, unknown>;
}

const DEFAULT_MAX_ENTRIES = 256;

function decodeEndpointResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { content?: unknown }).content)) return value as Record<string, unknown>;
  const text = (value as { content: Array<{ text?: unknown }> }).content[0]?.text;
  if (typeof text !== 'string') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return value as Record<string, unknown>;
  }
}

/**
 * Bounded host-side cache for authorized reference resolution. The source
 * revision is mandatory so edits naturally invalidate a cached resolution.
 */
export class ClientReferenceCache {
  private readonly entries = new Map<string, ReferenceCacheEntry>();
  private readonly inFlight = new Map<string, Promise<Record<string, unknown>>>();
  private readonly maxEntries: number;

  constructor(private readonly caller: ClientEndpointCaller, options: ClientReferenceCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be a positive integer');
    this.maxEntries = maxEntries;
  }

  async read(path: string, revision: string, options: ClientReferenceReadOptions = {}): Promise<Record<string, unknown>> {
    const normalizedPath = String(path || '').trim();
    const normalizedRevision = String(revision || '').trim();
    if (!normalizedPath) throw new Error('path is required');
    if (!normalizedRevision) throw new Error('revision is required for reference caching');
    const includeContent = options.includeContent === true;
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 50);
    const maxChars = Math.min(Math.max(Math.floor(options.maxChars ?? 4000), 1), 20000);
    const partition = String(options.cachePartition || 'public');
    const key = JSON.stringify({ path: normalizedPath, revision: normalizedRevision, includeContent, limit, maxChars, partition });
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cloneValue(cached.value);
    }
    const running = this.inFlight.get(key);
    if (options.signal?.aborted) throw new Error('reference request was aborted');
    if (running) return cloneValue(await waitForAbort(running, options.signal));
    const computation = this.readUncached(key, normalizedPath, normalizedRevision, partition, {
      includeContent,
      limit,
      maxChars,
      ...(options.accessToken && { accessToken: options.accessToken }),
      ...(options.signal && { signal: options.signal }),
    });
    this.inFlight.set(key, computation);
    try {
      return cloneValue(await waitForAbort(computation, options.signal));
    } finally {
      if (this.inFlight.get(key) === computation) this.inFlight.delete(key);
    }
  }

  invalidate(path?: string, revision?: string): void {
    const normalizedPath = path === undefined ? undefined : String(path).trim();
    for (const [key, entry] of this.entries) {
      if (normalizedPath !== undefined && entry.path !== normalizedPath) continue;
      if (revision !== undefined && entry.revision !== String(revision).trim()) continue;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private async readUncached(
    key: string,
    path: string,
    revision: string,
    partition: string,
    options: { includeContent: boolean; limit: number; maxChars: number; accessToken?: string; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const arguments_: Record<string, unknown> = {
      path,
      includeContent: options.includeContent,
      limit: options.limit,
      maxChars: options.maxChars,
      ...(options.accessToken && { accessToken: options.accessToken }),
    };
    const value = decodeEndpointResult(options.signal
      ? await this.caller.callEndpoint('mcp.read_references', arguments_, { signal: options.signal })
      : await this.caller.callEndpoint('mcp.read_references', arguments_));
    this.entries.delete(key);
    this.entries.set(key, { path, revision, partition, value: cloneValue(value) });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}

async function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error('reference request was aborted');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('reference request was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function cloneValue<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
