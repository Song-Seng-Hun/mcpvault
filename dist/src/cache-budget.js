/**
 * A process-wide budget for disposable, derived caches.
 *
 * Markdown/Git and the read models remain authoritative. This budget only
 * evicts values that can be rebuilt from those sources, so memory pressure
 * cannot change the visible data or search semantics.
 */
export const DEFAULT_DERIVED_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
let ownerSequence = 0;
export class DerivedCacheBudget {
    maxBytes;
    entries = new Map();
    entriesByOwner = new Map();
    lruHeap = [];
    // Intermediate sums can exceed MAX_SAFE_INTEGER before LRU eviction even
    // when every individual charge and the final public total are safe integers.
    totalBytes = 0n;
    maxAccountedBytes;
    clock = 0;
    constructor(maxBytes = DEFAULT_DERIVED_CACHE_BUDGET_BYTES) {
        this.maxBytes = maxBytes;
        if (!Number.isFinite(maxBytes) || maxBytes <= 0 || maxBytes > Number.MAX_SAFE_INTEGER) {
            throw new Error('maxBytes must be a positive finite number no greater than Number.MAX_SAFE_INTEGER');
        }
        this.maxAccountedBytes = BigInt(Math.floor(maxBytes));
    }
    register(owner, key, bytes, onEvict, options = {}) {
        const id = this.id(owner, key);
        this.removeById(id);
        const boundedBytes = Number.isFinite(bytes) && bytes >= 0 ? Math.ceil(bytes) : NaN;
        if (!Number.isSafeInteger(boundedBytes)) {
            // Callers store the new value before registration. Do not leave it
            // untracked by throwing or treating an invalid estimate as zero bytes.
            try {
                onEvict();
            }
            catch { /* Disposal cannot break authoritative work. */ }
            return;
        }
        const entry = { owner, bytes: boundedBytes, lastUsed: ++this.clock, allowOversized: options.allowOversized === true, onEvict, heapIndex: this.lruHeap.length };
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
    touch(owner, key) {
        const entry = this.entries.get(this.id(owner, key));
        if (!entry)
            return;
        entry.lastUsed = ++this.clock;
        const node = this.lruHeap[entry.heapIndex];
        if (node)
            node.lastUsed = entry.lastUsed;
        this.heapMoveDown(entry.heapIndex);
    }
    remove(owner, key) {
        this.removeById(this.id(owner, key));
    }
    clearOwner(owner) {
        const ownerEntries = this.entriesByOwner.get(owner);
        if (!ownerEntries)
            return;
        for (const id of [...ownerEntries])
            this.removeById(id);
    }
    snapshot() {
        return { maxBytes: this.maxBytes, totalBytes: Number(this.totalBytes), entries: this.entries.size };
    }
    id(owner, key) {
        return `${owner}\u0000${key}`;
    }
    removeById(id) {
        const entry = this.entries.get(id);
        if (!entry)
            return;
        this.entries.delete(id);
        const ownerEntries = this.entriesByOwner.get(entry.owner);
        ownerEntries?.delete(id);
        if (ownerEntries?.size === 0)
            this.entriesByOwner.delete(entry.owner);
        this.totalBytes -= BigInt(entry.bytes);
        const lastIndex = this.lruHeap.length - 1;
        if (entry.heapIndex !== lastIndex) {
            const replacement = this.lruHeap[lastIndex];
            this.lruHeap[entry.heapIndex] = replacement;
            const replacementEntry = this.entries.get(replacement.id);
            if (replacementEntry)
                replacementEntry.heapIndex = entry.heapIndex;
            this.heapMoveUp(entry.heapIndex);
            this.heapMoveDown(entry.heapIndex);
        }
        this.lruHeap.pop();
    }
    enforce() {
        while (this.totalBytes > this.maxAccountedBytes && this.entries.size > 0) {
            const oldestId = this.lruHeap[0]?.id;
            if (!oldestId)
                break;
            const entry = this.entries.get(oldestId);
            if (this.entries.size === 1 && entry?.allowOversized)
                break;
            this.removeById(oldestId);
            try {
                entry?.onEvict();
            }
            catch {
                // Cache eviction is best effort; a faulty disposer must not affect
                // the authoritative server path.
            }
        }
    }
    heapMoveUp(index) {
        let child = index;
        while (child > 0) {
            const parent = Math.floor((child - 1) / 2);
            if (this.lruHeap[parent].lastUsed <= this.lruHeap[child].lastUsed)
                break;
            this.heapSwap(parent, child);
            child = parent;
        }
    }
    heapMoveDown(index) {
        let parent = index;
        while (true) {
            const left = parent * 2 + 1;
            const right = left + 1;
            let smallest = parent;
            if (left < this.lruHeap.length && this.lruHeap[left].lastUsed < this.lruHeap[smallest].lastUsed)
                smallest = left;
            if (right < this.lruHeap.length && this.lruHeap[right].lastUsed < this.lruHeap[smallest].lastUsed)
                smallest = right;
            if (smallest === parent)
                break;
            this.heapSwap(parent, smallest);
            parent = smallest;
        }
    }
    heapSwap(left, right) {
        const value = this.lruHeap[left];
        this.lruHeap[left] = this.lruHeap[right];
        this.lruHeap[right] = value;
        const leftEntry = this.entries.get(this.lruHeap[left].id);
        const rightEntry = this.entries.get(this.lruHeap[right].id);
        if (leftEntry)
            leftEntry.heapIndex = left;
        if (rightEntry)
            rightEntry.heapIndex = right;
    }
}
export const derivedCacheBudget = new DerivedCacheBudget();
export function createDerivedCacheOwner(prefix) {
    ownerSequence += 1;
    return `${prefix}#${ownerSequence}`;
}
export function estimateCacheBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value) || '', 'utf8');
    }
    catch {
        return 0;
    }
}
