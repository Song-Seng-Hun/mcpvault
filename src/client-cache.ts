import { gzipSnapshotCodec, type AsyncClientBinaryStore, type ClientBinaryStore, type ClientSnapshotCodec } from './client-compression.js';

export interface ClientEndpointCaller {
  callEndpoint(endpointId: string, arguments_: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ClientKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AsyncClientKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
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
  /** Maximum number of ten-note batches allowed in flight; defaults to 2. */
  maxConcurrentBatches?: number;
  signal?: AbortSignal;
}

export interface ClientReadNotesResult {
  notes: CachedNote[];
  unchanged: string[];
  missing: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface ClientStaleReadResult {
  /** Locally cached notes available immediately; they may be stale. */
  immediate: ClientReadNotesResult;
  /** Revision-checked refresh. Changed note bodies are fetched by the server. */
  refresh: Promise<ClientReadNotesResult>;
}

interface BatchNote {
  path: string;
  revision?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  obsidianUri?: string;
  unchanged?: boolean;
}

interface BatchResponse {
  ok?: BatchNote[];
  err?: Array<{ path?: string; error?: string }>;
}

interface IncrementalCacheManifest {
  version: 1;
  paths: string[];
}

const DEFAULT_MAX_CONCURRENT_BATCHES = 2;
const MAX_CONCURRENT_BATCHES = 8;

function decodeEndpointResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { content?: unknown }).content)) return value;
  const text = (value as { content: Array<{ text?: unknown }> }).content[0]?.text;
  if (typeof text !== 'string') return value;
  try { return JSON.parse(text); } catch { return value; }
}

/**
 * Small host-side cache for MCPVault note reads. It deliberately knows only
 * the public endpoint contract: authorization and visibility remain inside
 * MCPVault, while this class owns LRU eviction and conditional batch reads.
 */
export class McpVaultClientCache {
  private readonly entries = new Map<string, CachedNote>();
  private readonly inFlight = new Map<string, Promise<ClientReadNotesResult>>();
  private readonly pathGenerations = new Map<string, number>();
  private readonly dirtyPaths = new Set<string>();
  private readonly maxEntries: number;

  constructor(
    private readonly caller: ClientEndpointCaller,
    options: { maxEntries?: number } = {},
  ) {
    const maxEntries = options.maxEntries ?? 256;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be a positive integer');
    this.maxEntries = maxEntries;
  }

  get(path: string): CachedNote | undefined {
    const cached = this.entries.get(path);
    if (!cached) return undefined;
    this.entries.delete(path);
    this.entries.set(path, cached);
    return cloneNote(cached);
  }

  values(): CachedNote[] {
    return [...this.entries.values()].map(cloneNote);
  }

  snapshot(): string {
    return JSON.stringify(this.values());
  }

  restore(snapshot: string): number {
    let parsed: unknown;
    try { parsed = JSON.parse(snapshot); } catch { return 0; }
    if (!Array.isArray(parsed)) return 0;
    let restored = 0;
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Partial<CachedNote>;
      if (typeof item.path !== 'string' || !item.path || typeof item.revision !== 'string' || !item.revision) continue;
      this.put({
        path: item.path,
        revision: item.revision,
        ...(typeof item.content === 'string' && { content: item.content }),
        ...(item.frontmatter && typeof item.frontmatter === 'object' && { frontmatter: item.frontmatter as Record<string, unknown> }),
        ...(typeof item.obsidianUri === 'string' && { obsidianUri: item.obsidianUri }),
      });
      restored += 1;
    }
    return restored;
  }

  persist(store: ClientKeyValueStore, key: string): void {
    store.setItem(key, this.snapshot());
  }

  persistCompressed(store: ClientBinaryStore, key: string, codec: ClientSnapshotCodec = gzipSnapshotCodec): void {
    store.setItem(key, codec.compress(this.snapshot()));
  }

  persistIncremental(store: ClientKeyValueStore, key: string): void {
    const previous = readManifest(store.getItem(key));
    const currentPaths = [...this.entries.keys()];
    const previousPaths = new Set(previous?.paths || []);
    for (const path of currentPaths) {
      if (!this.dirtyPaths.has(path) && previousPaths.has(path)) continue;
      const note = this.entries.get(path);
      if (note) store.setItem(noteStorageKey(key, path), JSON.stringify(note));
    }
    for (const path of previous?.paths || []) {
      if (!this.entries.has(path)) store.removeItem?.(noteStorageKey(key, path));
    }
    store.setItem(key, JSON.stringify({ version: 1, paths: currentPaths } satisfies IncrementalCacheManifest));
    this.dirtyPaths.clear();
  }

  async persistIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<void> {
    const previous = readManifest(await store.getItem(key));
    const currentPaths = [...this.entries.keys()];
    const previousPaths = new Set(previous?.paths || []);
    for (const path of currentPaths) {
      if (!this.dirtyPaths.has(path) && previousPaths.has(path)) continue;
      const note = this.entries.get(path);
      if (note) await store.setItem(noteStorageKey(key, path), JSON.stringify(note));
    }
    for (const path of previous?.paths || []) {
      if (!this.entries.has(path)) await store.removeItem?.(noteStorageKey(key, path));
    }
    await store.setItem(key, JSON.stringify({ version: 1, paths: currentPaths } satisfies IncrementalCacheManifest));
    this.dirtyPaths.clear();
  }

  hydrate(store: ClientKeyValueStore, key: string): number {
    const snapshot = store.getItem(key);
    return snapshot ? this.restore(snapshot) : 0;
  }

  hydrateCompressed(store: ClientBinaryStore, key: string, codec: ClientSnapshotCodec = gzipSnapshotCodec): number {
    const snapshot = store.getItem(key);
    if (!snapshot) return 0;
    try { return this.restore(codec.decompress(snapshot)); } catch { return 0; }
  }

  async persistCompressedAsync(store: AsyncClientBinaryStore, key: string, codec: ClientSnapshotCodec = gzipSnapshotCodec): Promise<void> {
    await store.setItem(key, codec.compress(this.snapshot()));
  }

  async hydrateCompressedAsync(store: AsyncClientBinaryStore, key: string, codec: ClientSnapshotCodec = gzipSnapshotCodec): Promise<number> {
    const snapshot = await store.getItem(key);
    if (!snapshot) return 0;
    try { return this.restore(codec.decompress(snapshot)); } catch { return 0; }
  }

  hydrateIncremental(store: ClientKeyValueStore, key: string): number {
    const manifest = readManifest(store.getItem(key));
    if (!manifest) return 0;
    let restored = 0;
    for (const path of manifest.paths) {
      const snapshot = store.getItem(noteStorageKey(key, path));
      if (!snapshot) continue;
      try {
        const value = JSON.parse(snapshot) as Partial<CachedNote>;
        if (typeof value.path !== 'string' || value.path !== path || typeof value.revision !== 'string' || !value.revision) continue;
        this.put({
          path,
          revision: value.revision,
          ...(typeof value.content === 'string' && { content: value.content }),
          ...(value.frontmatter && typeof value.frontmatter === 'object' && { frontmatter: value.frontmatter as Record<string, unknown> }),
          ...(typeof value.obsidianUri === 'string' && { obsidianUri: value.obsidianUri }),
        });
        restored += 1;
      } catch {
        // Ignore one corrupt entry and keep the remaining cache usable.
      }
    }
    this.dirtyPaths.clear();
    return restored;
  }

  async hydrateIncrementalAsync(store: AsyncClientKeyValueStore, key: string): Promise<number> {
    const manifest = readManifest(await store.getItem(key));
    if (!manifest) return 0;
    let restored = 0;
    for (const path of manifest.paths) {
      const snapshot = await store.getItem(noteStorageKey(key, path));
      if (!snapshot) continue;
      try {
        const value = JSON.parse(snapshot) as Partial<CachedNote>;
        if (typeof value.path !== 'string' || value.path !== path || typeof value.revision !== 'string' || !value.revision) continue;
        this.put({
          path,
          revision: value.revision,
          ...(typeof value.content === 'string' && { content: value.content }),
          ...(value.frontmatter && typeof value.frontmatter === 'object' && { frontmatter: value.frontmatter as Record<string, unknown> }),
          ...(typeof value.obsidianUri === 'string' && { obsidianUri: value.obsidianUri }),
        });
        restored += 1;
      } catch {
        // Ignore one corrupt entry and keep the remaining cache usable.
      }
    }
    this.dirtyPaths.clear();
    return restored;
  }

  invalidate(path?: string): void {
    if (path === undefined) {
      for (const entryPath of this.entries.keys()) {
        this.dirtyPaths.add(entryPath);
        this.bumpGeneration(entryPath);
      }
      this.entries.clear();
    } else {
      this.entries.delete(path);
      this.dirtyPaths.add(path);
      this.bumpGeneration(path);
    }
  }

  knownRevisions(paths: string[]): Record<string, string> {
    const known: Record<string, string> = {};
    for (const path of paths) {
      const cached = this.entries.get(path);
      if (cached) known[path] = cached.revision;
    }
    return known;
  }

  async readNotes(paths: string[], options: ClientReadNotesOptions = {}): Promise<ClientReadNotesResult> {
    if (options.signal?.aborted) throw new Error('request was aborted');
    const requested = normalizePaths(paths);
    const key = JSON.stringify({ paths: requested, options });
    const running = this.inFlight.get(key);
    if (running) return cloneReadNotesResult(await waitForAbort(running, options.signal));
    const computation = this.readNotesUncached(requested, options);
    this.inFlight.set(key, computation);
    try {
      return cloneReadNotesResult(await waitForAbort(computation, options.signal));
    } finally {
      if (this.inFlight.get(key) === computation) this.inFlight.delete(key);
    }
  }

  readNotesStale(paths: string[], options: ClientReadNotesOptions = {}): ClientStaleReadResult {
    const requested = normalizePaths(paths);
    const cached = new Map(requested.map(path => [path, this.get(path)]));
    const immediate: ClientReadNotesResult = {
      notes: requested.map(path => cached.get(path)).filter((note): note is CachedNote => Boolean(note)).map(cloneNote),
      unchanged: [],
      missing: [],
      errors: [],
    };
    return { immediate, refresh: this.readNotes(requested, options) };
  }

  private async readNotesUncached(paths: string[], options: ClientReadNotesOptions): Promise<ClientReadNotesResult> {
    const requested = [...new Set(paths.map(path => String(path).trim()).filter(Boolean))];
    const maxConcurrentBatches = normalizeBatchConcurrency(options.maxConcurrentBatches);
    const generations = new Map(requested.map(path => [path, this.bumpGeneration(path)]));
    const notes = new Map<string, CachedNote>();
    const unchanged: string[] = [];
    const missing = new Set<string>();
    const errors: Array<{ path: string; error: string }> = [];
    const includeContent = options.includeContent ?? true;
    const includeFrontmatter = options.includeFrontmatter ?? true;
    const batches: string[][] = [];
    for (let start = 0; start < requested.length; start += 10) batches.push(requested.slice(start, start + 10));
    const responses: Array<{ response?: BatchResponse; error?: string }> = batches.map(() => ({}));
    let nextBatch = 0;
    const readBatch = async (): Promise<void> => {
      while (nextBatch < batches.length) {
        const batchIndex = nextBatch++;
        const batch = batches[batchIndex]!;
        const knownRevisions = options.force ? {} : this.knownRevisions(batch);
        try {
          const arguments_ = { paths: batch, includeContent, includeFrontmatter, knownRevisions };
          const decoded = decodeEndpointResult(options.signal
            ? await this.caller.callEndpoint('mcp.read_multiple_notes', arguments_, { signal: options.signal })
            : await this.caller.callEndpoint('mcp.read_multiple_notes', arguments_));
          responses[batchIndex] = { response: decoded as BatchResponse };
        } catch (error) {
          responses[batchIndex] = { error: error instanceof Error ? error.message : String(error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrentBatches, batches.length) }, () => readBatch()));

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;
      const result = responses[batchIndex]!;
      if (result.error) {
        for (const path of batch) errors.push({ path, error: result.error });
        continue;
      }
      const response = result.response || {};
      for (const item of Array.isArray(response.ok) ? response.ok : []) {
        const path = String(item.path || '').trim();
        if (!path) continue;
        const cached = this.entries.get(path);
        if (item.unchanged) {
          if (cached) {
            notes.set(path, cloneNote(cached));
            unchanged.push(path);
          } else {
            errors.push({ path, error: 'server reported unchanged but the client has no cached note' });
          }
          continue;
        }
        if (!item.revision) {
          errors.push({ path, error: 'server response omitted revision while using the client cache' });
          continue;
        }
        const note: CachedNote = {
          path,
          revision: item.revision,
          ...(item.content !== undefined && { content: item.content }),
          ...(item.frontmatter !== undefined && { frontmatter: item.frontmatter }),
          ...(item.obsidianUri !== undefined && { obsidianUri: item.obsidianUri }),
        };
        const merged = cached ? { ...cached, ...note } : note;
        if (this.pathGenerations.get(path) === generations.get(path)) this.put(merged);
        notes.set(path, cloneNote(merged));
      }
      for (const item of Array.isArray(response.err) ? response.err : []) {
        const path = String(item.path || '').trim();
        const error = String(item.error || 'read failed');
        if (path && /not found|missing|hidden|moderation/i.test(error)) missing.add(path);
        else if (path) errors.push({ path, error });
      }
    }

    return {
      notes: requested.map(path => notes.get(path)).filter((note): note is CachedNote => Boolean(note)),
      unchanged: [...new Set(unchanged)],
      missing: [...missing],
      errors,
    };
  }

  private put(note: CachedNote): void {
    this.entries.delete(note.path);
    this.entries.set(note.path, cloneNote(note));
    this.dirtyPaths.add(note.path);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  private bumpGeneration(path: string): number {
    const generation = (this.pathGenerations.get(path) || 0) + 1;
    this.pathGenerations.set(path, generation);
    return generation;
  }
}

function normalizeBatchConcurrency(value: number | undefined): number {
  const maxConcurrentBatches = value ?? DEFAULT_MAX_CONCURRENT_BATCHES;
  if (!Number.isInteger(maxConcurrentBatches) || maxConcurrentBatches < 1 || maxConcurrentBatches > MAX_CONCURRENT_BATCHES) {
    throw new Error(`maxConcurrentBatches must be between 1 and ${MAX_CONCURRENT_BATCHES}`);
  }
  return maxConcurrentBatches;
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map(path => String(path).trim()).filter(Boolean))];
}

async function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new Error('request was aborted');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('request was aborted'));
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

function noteStorageKey(key: string, path: string): string {
  return `${key}:note:${encodeURIComponent(path)}`;
}

function readManifest(value: string | null): IncrementalCacheManifest | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<IncrementalCacheManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.paths)) return undefined;
    const paths = parsed.paths.filter((path): path is string => typeof path === 'string' && path.length > 0);
    return { version: 1, paths: [...new Set(paths)] };
  } catch {
    return undefined;
  }
}

function cloneReadNotesResult(value: ClientReadNotesResult): ClientReadNotesResult {
  return {
    notes: value.notes.map(cloneNote),
    unchanged: [...value.unchanged],
    missing: [...value.missing],
    errors: value.errors.map(error => ({ ...error })),
  };
}

function cloneNote(note: CachedNote): CachedNote {
  return {
    ...note,
    ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }),
  };
}
