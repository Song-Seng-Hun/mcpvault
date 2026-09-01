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
        this.entries.set(id, { bytes: boundedBytes, lastUsed: ++this.clock, allowOversized: options.allowOversized === true, onEvict });
        this.totalBytes += boundedBytes;
        this.enforce();
    }
    touch(owner, key) {
        const entry = this.entries.get(this.id(owner, key));
        if (entry)
            entry.lastUsed = ++this.clock;
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
    }
    enforce() {
        while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
            let oldestId;
            let oldestUse = Number.POSITIVE_INFINITY;
            for (const [id, entry] of this.entries) {
                if (entry.lastUsed < oldestUse) {
                    oldestId = id;
                    oldestUse = entry.lastUsed;
                }
            }
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
