/**
 * A process-wide budget for disposable, derived caches.
 *
 * Markdown/Git and the read models remain authoritative. This budget only
 * evicts values that can be rebuilt from those sources, so memory pressure
 * cannot change the visible data or search semantics.
 */
export const DEFAULT_DERIVED_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
let ownerSequence = 0;

interface BudgetEntry {
  bytes: number;
  lastUsed: number;
  allowOversized: boolean;
  onEvict: () => void;
}

export interface DerivedCacheRegistrationOptions {
  /** Keep one bounded-but-large snapshot resident instead of rebuilding it per request. */
  allowOversized?: boolean;
}

export class DerivedCacheBudget {
  private readonly entries = new Map<string, BudgetEntry>();
  private totalBytes = 0;
  private clock = 0;

  constructor(public readonly maxBytes = DEFAULT_DERIVED_CACHE_BUDGET_BYTES) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive finite number');
  }

  register(owner: string, key: string, bytes: number, onEvict: () => void, options: DerivedCacheRegistrationOptions = {}): void {
    const id = this.id(owner, key);
    this.removeById(id);
    const boundedBytes = Math.max(0, Math.ceil(bytes));
    this.entries.set(id, { bytes: boundedBytes, lastUsed: ++this.clock, allowOversized: options.allowOversized === true, onEvict });
    this.totalBytes += boundedBytes;
    this.enforce();
  }

  touch(owner: string, key: string): void {
    const entry = this.entries.get(this.id(owner, key));
    if (entry) entry.lastUsed = ++this.clock;
  }

  remove(owner: string, key: string): void {
    this.removeById(this.id(owner, key));
  }

  clearOwner(owner: string): void {
    const prefix = `${owner}\u0000`;
    for (const id of [...this.entries.keys()]) {
      if (id.startsWith(prefix)) this.removeById(id);
    }
  }

  snapshot(): { maxBytes: number; totalBytes: number; entries: number } {
    return { maxBytes: this.maxBytes, totalBytes: this.totalBytes, entries: this.entries.size };
  }

  private id(owner: string, key: string): string {
    return `${owner}\u0000${key}`;
  }

  private removeById(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.totalBytes -= entry.bytes;
  }

  private enforce(): void {
    while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
      let oldestId: string | undefined;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.entries) {
        if (entry.lastUsed < oldestUse) {
          oldestId = id;
          oldestUse = entry.lastUsed;
        }
      }
      if (!oldestId) break;
      const entry = this.entries.get(oldestId);
      if (this.entries.size === 1 && entry?.allowOversized) break;
      this.removeById(oldestId);
      try {
        entry?.onEvict();
      } catch {
        // Cache eviction is best effort; a faulty disposer must not affect
        // the authoritative server path.
      }
    }
  }
}

export const derivedCacheBudget = new DerivedCacheBudget();

export function createDerivedCacheOwner(prefix: string): string {
  ownerSequence += 1;
  return `${prefix}#${ownerSequence}`;
}

export function estimateCacheBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) || '', 'utf8');
  } catch {
    return 0;
  }
}
