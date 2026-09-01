const DEFAULT_MAX_ENTRIES = 256;
function decodeEndpointResult(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.content))
        return value;
    const text = value.content[0]?.text;
    if (typeof text !== 'string')
        return value;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return value;
    }
}
/**
 * Bounded host-side cache for authorized reference resolution. The source
 * revision is mandatory so edits naturally invalidate a cached resolution.
 */
export class ClientReferenceCache {
    caller;
    entries = new Map();
    inFlight = new Map();
    maxEntries;
    constructor(caller, options = {}) {
        this.caller = caller;
        const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        if (!Number.isInteger(maxEntries) || maxEntries < 1)
            throw new Error('maxEntries must be a positive integer');
        this.maxEntries = maxEntries;
    }
    async read(path, revision, options = {}) {
        const normalizedPath = String(path || '').trim();
        const normalizedRevision = String(revision || '').trim();
        if (!normalizedPath)
            throw new Error('path is required');
        if (!normalizedRevision)
            throw new Error('revision is required for reference caching');
        const includeContent = options.includeContent === true;
        const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 50);
        const maxChars = Math.min(Math.max(Math.floor(options.maxChars ?? 4000), 1), 20000);
        const partition = String(options.cachePartition || 'public');
        const key = JSON.stringify({ path: normalizedPath, revision: normalizedRevision, includeContent, limit, maxChars, partition });
        const cached = this.entries.get(key);
        if (cached) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            return cloneValue(cached.value);
        }
        const running = this.inFlight.get(key);
        if (running)
            return cloneValue(await running);
        const computation = this.readUncached(key, normalizedPath, normalizedRevision, partition, { includeContent, limit, maxChars, ...(options.accessToken && { accessToken: options.accessToken }) });
        this.inFlight.set(key, computation);
        try {
            return cloneValue(await computation);
        }
        finally {
            if (this.inFlight.get(key) === computation)
                this.inFlight.delete(key);
        }
    }
    invalidate(path, revision) {
        const normalizedPath = path === undefined ? undefined : String(path).trim();
        for (const [key, entry] of this.entries) {
            if (normalizedPath !== undefined && entry.path !== normalizedPath)
                continue;
            if (revision !== undefined && entry.revision !== String(revision).trim())
                continue;
            this.entries.delete(key);
        }
    }
    clear() {
        this.entries.clear();
    }
    size() {
        return this.entries.size;
    }
    async readUncached(key, path, revision, partition, options) {
        const arguments_ = {
            path,
            includeContent: options.includeContent,
            limit: options.limit,
            maxChars: options.maxChars,
            ...(options.accessToken && { accessToken: options.accessToken }),
        };
        const value = decodeEndpointResult(await this.caller.callEndpoint('mcp.read_references', arguments_));
        this.entries.delete(key);
        this.entries.set(key, { path, revision, partition, value: cloneValue(value) });
        while (this.entries.size > this.maxEntries)
            this.entries.delete(this.entries.keys().next().value);
        return value;
    }
}
function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}
