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
    lruHeap = [];
    totalBytes = 0;
    clock = 0;
    constructor(maxBytes = DEFAULT_DERIVED_CACHE_BUDGET_BYTES) {
        this.maxBytes = maxBytes;
        if (!Number.isFinite(maxBytes) || maxBytes <= 0)
            throw new Error('maxBytes must be a positive finite number');
    }
    register(owner, key, bytes, onEvict, options = {}) {
        const id = this.id(owner, key);
        this.removeById(id);
        const boundedBytes = Math.max(0, Math.ceil(bytes));
        const entry = { bytes: boundedBytes, lastUsed: ++this.clock, allowOversized: options.allowOversized === true, onEvict, heapIndex: this.lruHeap.length };
        this.entries.set(id, entry);
        this.lruHeap.push({ id, lastUsed: entry.lastUsed });
        this.heapMoveUp(entry.heapIndex);
        this.totalBytes += boundedBytes;
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
        const prefix = `${owner}\u0000`;
        for (const id of [...this.entries.keys()]) {
            if (id.startsWith(prefix))
                this.removeById(id);
        }
    }
    snapshot() {
        return { maxBytes: this.maxBytes, totalBytes: this.totalBytes, entries: this.entries.size };
    }
    id(owner, key) {
        return `${owner}\u0000${key}`;
    }
    removeById(id) {
        const entry = this.entries.get(id);
        if (!entry)
            return;
        this.entries.delete(id);
        this.totalBytes -= entry.bytes;
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
        while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
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
