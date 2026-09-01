function decodeEndpointResult(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.content))
        return value;
    const text = value.content[0]?.text;
    if (typeof text !== 'string')
        return value;
    try {
        return JSON.parse(text);
    }
    catch {
        return value;
    }
}
/**
 * Small host-side cache for MCPVault note reads. It deliberately knows only
 * the public endpoint contract: authorization and visibility remain inside
 * MCPVault, while this class owns LRU eviction and conditional batch reads.
 */
export class McpVaultClientCache {
    caller;
    entries = new Map();
    maxEntries;
    constructor(caller, options = {}) {
        this.caller = caller;
        const maxEntries = options.maxEntries ?? 256;
        if (!Number.isInteger(maxEntries) || maxEntries < 1)
            throw new Error('maxEntries must be a positive integer');
        this.maxEntries = maxEntries;
    }
    get(path) {
        const cached = this.entries.get(path);
        if (!cached)
            return undefined;
        this.entries.delete(path);
        this.entries.set(path, cached);
        return cloneNote(cached);
    }
    invalidate(path) {
        if (path === undefined)
            this.entries.clear();
        else
            this.entries.delete(path);
    }
    knownRevisions(paths) {
        const known = {};
        for (const path of paths) {
            const cached = this.entries.get(path);
            if (cached)
                known[path] = cached.revision;
        }
        return known;
    }
    async readNotes(paths, options = {}) {
        const requested = [...new Set(paths.map(path => String(path).trim()).filter(Boolean))];
        const notes = new Map();
        const unchanged = [];
        const missing = new Set();
        const errors = [];
        const includeContent = options.includeContent ?? true;
        const includeFrontmatter = options.includeFrontmatter ?? true;
        for (let start = 0; start < requested.length; start += 10) {
            const batch = requested.slice(start, start + 10);
            const knownRevisions = options.force ? {} : this.knownRevisions(batch);
            let decoded;
            try {
                decoded = decodeEndpointResult(await this.caller.callEndpoint('mcp.read_multiple_notes', {
                    paths: batch,
                    includeContent,
                    includeFrontmatter,
                    knownRevisions,
                }));
            }
            catch (error) {
                for (const path of batch)
                    errors.push({ path, error: error instanceof Error ? error.message : String(error) });
                continue;
            }
            const response = decoded;
            for (const item of Array.isArray(response.ok) ? response.ok : []) {
                const path = String(item.path || '').trim();
                if (!path)
                    continue;
                const cached = this.entries.get(path);
                if (item.unchanged) {
                    if (cached) {
                        notes.set(path, cloneNote(cached));
                        unchanged.push(path);
                    }
                    else {
                        errors.push({ path, error: 'server reported unchanged but the client has no cached note' });
                    }
                    continue;
                }
                if (!item.revision) {
                    errors.push({ path, error: 'server response omitted revision while using the client cache' });
                    continue;
                }
                const note = {
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
                if (path && /not found|missing|hidden|moderation/i.test(error))
                    missing.add(path);
                else if (path)
                    errors.push({ path, error });
            }
        }
        return {
            notes: requested.map(path => notes.get(path)).filter((note) => Boolean(note)),
            unchanged: [...new Set(unchanged)],
            missing: [...missing],
            errors,
        };
    }
    put(note) {
        this.entries.delete(note.path);
        this.entries.set(note.path, cloneNote(note));
        while (this.entries.size > this.maxEntries)
            this.entries.delete(this.entries.keys().next().value);
    }
}
function cloneNote(note) {
    return {
        ...note,
        ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }),
    };
}
