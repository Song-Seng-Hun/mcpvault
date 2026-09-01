const DEFAULT_MAX_ENTRIES = 500;
/**
 * Host-side bounded cache for cursor-paginated chat or community timelines.
 * It deduplicates context overlap locally; server authorization and freshness
 * remain authoritative.
 */
export class ClientTimelineCache {
    options;
    entries = new Map();
    maxEntries;
    constructor(options) {
        this.options = options;
        const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        if (!Number.isInteger(maxEntries) || maxEntries < 1)
            throw new Error('maxEntries must be a positive integer');
        this.maxEntries = maxEntries;
    }
    merge(items) {
        const merged = [];
        const addedIds = [];
        const updatedIds = [];
        const duplicateIds = [];
        for (const item of items) {
            const id = this.idFor(item);
            if (!id)
                continue;
            const existing = this.entries.get(id);
            if (!existing) {
                this.entries.set(id, cloneItem(item));
                addedIds.push(id);
                merged.push(cloneItem(item));
            }
            else if (this.isSame(existing, item)) {
                duplicateIds.push(id);
                merged.push(cloneItem(existing));
            }
            else {
                this.entries.delete(id);
                this.entries.set(id, cloneItem(item));
                updatedIds.push(id);
                merged.push(cloneItem(item));
            }
        }
        while (this.entries.size > this.maxEntries)
            this.entries.delete(this.entries.keys().next().value);
        return { items: merged, addedIds, updatedIds, duplicateIds };
    }
    get(id) {
        const item = this.entries.get(id);
        return item === undefined ? undefined : cloneItem(item);
    }
    values() {
        return [...this.entries.values()].map(cloneItem);
    }
    size() {
        return this.entries.size;
    }
    remove(id) {
        return this.entries.delete(id);
    }
    clear() {
        this.entries.clear();
    }
    idFor(item) {
        return String(this.options.getId(item) || '').trim();
    }
    isSame(left, right) {
        const leftRevision = this.options.getRevision?.(left);
        const rightRevision = this.options.getRevision?.(right);
        if (leftRevision !== undefined && rightRevision !== undefined)
            return leftRevision === rightRevision;
        return JSON.stringify(left) === JSON.stringify(right);
    }
}
function cloneItem(item) {
    if (!item || typeof item !== 'object')
        return item;
    return { ...item };
}
