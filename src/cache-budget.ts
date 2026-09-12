import { guidanceError } from './guidance-runtime.js';
/**
 * A process-wide budget for disposable, derived caches.
 *
 * Markdown/Git and the read models remain authoritative. This budget only
 * evicts values that can be rebuilt from those sources, so memory pressure
 * cannot change the visible data or search semantics.
 */
export const DEFAULT_DERIVED_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
export const DEFAULT_WORKING_SET_BUDGET_BYTES = 128 * 1024 * 1024;
let ownerSequence = 0;

export class DocumentWorkBudgetError extends Error {
  constructor() { super('Document work memory budget exceeded; narrow the document or retry after active work completes'); this.name = 'DocumentWorkBudgetError'; }
}

interface BudgetEntry {
  owner: string;
  bytes: number;
  lastUsed: number;
  allowOversized: boolean;
  onEvict: () => void;
  heapIndex: number;
}

interface LruHeapNode {
  id: string;
  lastUsed: number;
}

export interface DerivedCacheRegistrationOptions {
  /** Keep one bounded-but-large snapshot resident instead of rebuilding it per request. */
  allowOversized?: boolean;
}

export class DerivedCacheBudget {
  private readonly entries = new Map<string, BudgetEntry>();
  private readonly entriesByOwner = new Map<string, Set<string>>();
  private readonly lruHeap: LruHeapNode[] = [];
  // Intermediate sums can exceed MAX_SAFE_INTEGER before LRU eviction even
  // when every individual charge and the final public total are safe integers.
  private totalBytes = 0n;
  private activeBytes = 0n;
  private readonly maxAccountedBytes: bigint;
  private readonly maxWorkingAccountedBytes: bigint;
  private clock = 0;

  constructor(public readonly maxBytes = DEFAULT_DERIVED_CACHE_BUDGET_BYTES, public readonly maxWorkingBytes = maxBytes) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || maxBytes > Number.MAX_SAFE_INTEGER) {
      throw guidanceError(new Error('maxBytes must be a positive finite number no greater than Number.MAX_SAFE_INTEGER'), 'guid-73767f404babc2c2');
    }
    this.maxAccountedBytes = BigInt(Math.floor(maxBytes));
    if (!Number.isFinite(maxWorkingBytes) || maxWorkingBytes <= 0 || maxWorkingBytes > Number.MAX_SAFE_INTEGER) throw new Error('Invalid working memory budget');
    this.maxWorkingAccountedBytes = BigInt(Math.floor(maxWorkingBytes));
  }

  /** Pinned work cannot be evicted or overbooked. Reserve before allocating. */
  reserveWork(bytes: number): { release(): void } {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.activeBytes + BigInt(bytes) > this.maxWorkingAccountedBytes) {
      throw new DocumentWorkBudgetError();
    }
    const charge = BigInt(bytes);
    this.activeBytes += charge;
    this.enforce();
    let released = false;
    return { release: () => { if (!released) { released = true; this.activeBytes -= charge; } } };
  }

  workSnapshot(): { maxBytes: number; activeBytes: number; totalBytes: number } {
    return { maxBytes: this.maxWorkingBytes, activeBytes: Number(this.activeBytes), totalBytes: Number(this.activeBytes + this.totalBytes) };
  }

  register(owner: string, key: string, bytes: number, onEvict: () => void, options: DerivedCacheRegistrationOptions = {}): void {
    const id = this.id(owner, key);
    this.removeById(id);
    const boundedBytes = Number.isFinite(bytes) && bytes >= 0 ? Math.ceil(bytes) : NaN;
    if (!Number.isSafeInteger(boundedBytes)) {
      // Callers store the new value before registration. Do not leave it
      // untracked by throwing or treating an invalid estimate as zero bytes.
      try { onEvict(); } catch { /* Disposal cannot break authoritative work. */ }
      return;
    }
    const entry: BudgetEntry = { owner, bytes: boundedBytes, lastUsed: ++this.clock, allowOversized: options.allowOversized === true, onEvict, heapIndex: this.lruHeap.length };
    this.entries.set(id, entry);
    let ownerEntries = this.entriesByOwner.get(owner);
    if (!ownerEntries) {
      ownerEntries = new Set();
      this.entriesByOwner.set(owner, ownerEntries);
    }
    ownerEntries.add(id);
    this.lruHeap.push({ id, lastUsed: entry.lastUsed });
    this.heapMoveUp(entry.heapIndex);
    this.totalBytes += BigInt(boundedBytes);
    this.enforce();
  }

  touch(owner: string, key: string): void {
    const entry = this.entries.get(this.id(owner, key));
    if (!entry) return;
    entry.lastUsed = ++this.clock;
    const node = this.lruHeap[entry.heapIndex];
    if (node) node.lastUsed = entry.lastUsed;
    this.heapMoveDown(entry.heapIndex);
  }

  remove(owner: string, key: string): void {
    this.removeById(this.id(owner, key));
  }

  clearOwner(owner: string): void {
    const ownerEntries = this.entriesByOwner.get(owner);
    if (!ownerEntries) return;
    for (const id of [...ownerEntries]) this.removeById(id);
  }

  snapshot(): { maxBytes: number; totalBytes: number; entries: number } {
    return { maxBytes: this.maxBytes, totalBytes: Number(this.totalBytes), entries: this.entries.size };
  }

  private id(owner: string, key: string): string {
    return `${owner}\u0000${key}`;
  }

  private removeById(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const ownerEntries = this.entriesByOwner.get(entry.owner);
    ownerEntries?.delete(id);
    if (ownerEntries?.size === 0) this.entriesByOwner.delete(entry.owner);
    this.totalBytes -= BigInt(entry.bytes);
    const lastIndex = this.lruHeap.length - 1;
    if (entry.heapIndex !== lastIndex) {
      const replacement = this.lruHeap[lastIndex]!;
      this.lruHeap[entry.heapIndex] = replacement;
      const replacementEntry = this.entries.get(replacement.id);
      if (replacementEntry) replacementEntry.heapIndex = entry.heapIndex;
      this.heapMoveUp(entry.heapIndex);
      this.heapMoveDown(entry.heapIndex);
    }
    this.lruHeap.pop();
  }

  private enforce(): void {
    while ((this.totalBytes > this.maxAccountedBytes || this.totalBytes + this.activeBytes > this.maxWorkingAccountedBytes) && this.entries.size > 0) {
      const oldestId = this.lruHeap[0]?.id;
      if (!oldestId) break;
      const entry = this.entries.get(oldestId);
      if (this.entries.size === 1 && entry?.allowOversized
        && (this.activeBytes === 0n || this.totalBytes + this.activeBytes <= this.maxWorkingAccountedBytes)) break;
      this.removeById(oldestId);
      try {
        entry?.onEvict();
      } catch {
        // Cache eviction is best effort; a faulty disposer must not affect
        // the authoritative server path.
      }
    }
  }

  private heapMoveUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.lruHeap[parent]!.lastUsed <= this.lruHeap[child]!.lastUsed) break;
      this.heapSwap(parent, child);
      child = parent;
    }
  }

  private heapMoveDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.lruHeap.length && this.lruHeap[left]!.lastUsed < this.lruHeap[smallest]!.lastUsed) smallest = left;
      if (right < this.lruHeap.length && this.lruHeap[right]!.lastUsed < this.lruHeap[smallest]!.lastUsed) smallest = right;
      if (smallest === parent) break;
      this.heapSwap(parent, smallest);
      parent = smallest;
    }
  }

  private heapSwap(left: number, right: number): void {
    const value = this.lruHeap[left]!;
    this.lruHeap[left] = this.lruHeap[right]!;
    this.lruHeap[right] = value;
    const leftEntry = this.entries.get(this.lruHeap[left]!.id);
    const rightEntry = this.entries.get(this.lruHeap[right]!.id);
    if (leftEntry) leftEntry.heapIndex = left;
    if (rightEntry) rightEntry.heapIndex = right;
  }
}

export const derivedCacheBudget = new DerivedCacheBudget(DEFAULT_DERIVED_CACHE_BUDGET_BYTES, DEFAULT_WORKING_SET_BUDGET_BYTES);

export function createDerivedCacheOwner(prefix: string): string {
  ownerSequence += 1;
  return `${prefix}#${ownerSequence}`;
}

export function estimateCacheBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    // Unknown size must reject admission, including after caller overhead.
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : Infinity;
  } catch {
    return Infinity;
  }
}
