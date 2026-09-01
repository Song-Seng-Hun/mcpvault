export interface ClientMcpCaller {
  callTool(toolName: string, arguments_: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ClientCapabilityCatalogCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface CatalogCacheEntry {
  partition: string;
  value: unknown;
  expiresAt: number;
}

const DEFAULT_CATALOG_TTL_MS = 30_000;
const DEFAULT_CATALOG_MAX_ENTRIES = 64;

/** Bounded TTL cache for the five stable MCP control-plane tools. */
export class ClientCapabilityCatalogCache {
  private readonly entries = new Map<string, CatalogCacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly caller: ClientMcpCaller, options: ClientCapabilityCatalogCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_CATALOG_MAX_ENTRIES;
    const ttlMs = options.ttlMs ?? DEFAULT_CATALOG_TTL_MS;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be a positive integer');
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error('ttlMs must be a positive integer');
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = options.now || Date.now;
  }

  listActive(arguments_: Record<string, unknown> = {}, cachePartition = 'public', signal?: AbortSignal): Promise<unknown> {
    return this.read('list_active_capabilities', arguments_, cachePartition, signal);
  }

  search(arguments_: Record<string, unknown>, cachePartition = 'public', signal?: AbortSignal): Promise<unknown> {
    return this.read('search_capabilities', arguments_, cachePartition, signal);
  }

  invalidate(cachePartition?: string): void {
    if (cachePartition === undefined) {
      this.entries.clear();
      return;
    }
    for (const [key, entry] of this.entries) if (entry.partition === cachePartition) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private async read(toolName: string, arguments_: Record<string, unknown>, cachePartition: string, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new Error('capability request was aborted');
    const partition = String(cachePartition || 'public');
    const key = JSON.stringify({ toolName, arguments: sortRecord(arguments_), partition });
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cloneJson(cached.value);
    }
    if (cached) this.entries.delete(key);
    const running = this.inFlight.get(key);
    if (running) return cloneJson(await waitForAbort(running, signal));
    const computation = (signal
      ? this.caller.callTool(toolName, arguments_, { signal })
      : this.caller.callTool(toolName, arguments_)).then(value => {
      if (!isErrorResult(value)) {
        this.entries.set(key, { partition, value: cloneJson(value), expiresAt: this.now() + this.ttlMs });
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      }
      return value;
    });
    this.inFlight.set(key, computation);
    try {
      return cloneJson(await waitForAbort(computation, signal));
    } finally {
      if (this.inFlight.get(key) === computation) this.inFlight.delete(key);
    }
  }
}

async function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error('capability request was aborted');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('capability request was aborted'));
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

export interface ClientHeartbeatBackoffOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  /** Randomized spread around each delay; defaults to 10%. */
  jitterRatio?: number;
  /** Injectable random source returning a value in [0, 1) for deterministic tests. */
  random?: () => number;
}

/** Calculates a bounded next heartbeat delay; it does not schedule model calls. */
export class ClientHeartbeatBackoff {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly multiplier: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private delayMs: number;

  constructor(options: ClientHeartbeatBackoffOptions = {}) {
    const minDelayMs = options.minDelayMs ?? 15_000;
    const maxDelayMs = options.maxDelayMs ?? 300_000;
    const multiplier = options.multiplier ?? 2;
    const jitterRatio = options.jitterRatio ?? 0.1;
    if (!Number.isInteger(minDelayMs) || minDelayMs < 1) throw new Error('minDelayMs must be a positive integer');
    if (!Number.isInteger(maxDelayMs) || maxDelayMs < minDelayMs) throw new Error('maxDelayMs must be at least minDelayMs');
    if (!Number.isFinite(multiplier) || multiplier <= 1) throw new Error('multiplier must be greater than 1');
    if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 0.5) throw new Error('jitterRatio must be between 0 and 0.5');
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.multiplier = multiplier;
    this.jitterRatio = jitterRatio;
    this.random = options.random || Math.random;
    this.delayMs = minDelayMs;
  }

  next(hasActivity: boolean): number {
    if (hasActivity) {
      this.reset();
      return this.withJitter(this.minDelayMs);
    }
    const nextDelay = this.delayMs;
    this.delayMs = Math.min(this.maxDelayMs, Math.ceil(this.delayMs * this.multiplier));
    return this.withJitter(nextDelay);
  }

  reset(): void {
    this.delayMs = this.minDelayMs;
  }

  current(): number {
    return this.delayMs;
  }

  private withJitter(delay: number): number {
    if (this.jitterRatio === 0) return delay;
    const random = Math.min(Math.max(Number(this.random()) || 0, 0), 1);
    const spread = (random * 2 - 1) * this.jitterRatio;
    return Math.min(this.maxDelayMs, Math.max(this.minDelayMs, Math.round(delay * (1 + spread))));
  }
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function isErrorResult(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { isError?: unknown }).isError === true);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
