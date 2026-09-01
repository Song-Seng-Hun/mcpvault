export interface ClientEndpointCaller {
  callEndpoint(endpointId: string, arguments_: Record<string, unknown>): Promise<unknown>;
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

  invalidate(path?: string): void {
    if (path === undefined) this.entries.clear();
    else this.entries.delete(path);
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
    const key = JSON.stringify({ paths, options });
    const running = this.inFlight.get(key);
    if (running) return cloneReadNotesResult(await running);
    const computation = this.readNotesUncached(paths, options);
    this.inFlight.set(key, computation);
    try {
      return cloneReadNotesResult(await computation);
    } finally {
      if (this.inFlight.get(key) === computation) this.inFlight.delete(key);
    }
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
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
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
