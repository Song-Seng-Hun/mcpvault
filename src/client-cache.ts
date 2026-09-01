export interface ClientEndpointCaller {
  callEndpoint(endpointId: string, arguments_: Record<string, unknown>): Promise<unknown>;
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
      for (const entryPath of this.entries.keys()) this.dirtyPaths.add(entryPath);
      this.entries.clear();
    } else {
      this.entries.delete(path);
      this.dirtyPaths.add(path);
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
    const requested = normalizePaths(paths);
    const key = JSON.stringify({ paths: requested, options });
    const running = this.inFlight.get(key);
    if (running) return cloneReadNotesResult(await running);
    const computation = this.readNotesUncached(requested, options);
    this.inFlight.set(key, computation);
    try {
      return cloneReadNotesResult(await computation);
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
    const notes = new Map<string, CachedNote>();
    const unchanged: string[] = [];
    const missing = new Set<string>();
    const errors: Array<{ path: string; error: string }> = [];
    const includeContent = options.includeContent ?? true;
    const includeFrontmatter = options.includeFrontmatter ?? true;

    for (let start = 0; start < requested.length; start += 10) {
      const batch = requested.slice(start, start + 10);
      const knownRevisions = options.force ? {} : this.knownRevisions(batch);
      let decoded: unknown;
      try {
        decoded = decodeEndpointResult(await this.caller.callEndpoint('mcp.read_multiple_notes', {
          paths: batch,
          includeContent,
          includeFrontmatter,
          knownRevisions,
        }));
      } catch (error) {
        for (const path of batch) errors.push({ path, error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      const response = decoded as BatchResponse;
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
        this.put(merged);
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
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths.map(path => String(path).trim()).filter(Boolean))];
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
