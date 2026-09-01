import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
const FULL_REFRESH_INTERVAL_MS = 60_000;
const READ_BATCH_SIZE = 32;
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function isNote(path) {
    return /\.(?:md|markdown|txt)$/i.test(path);
}
function revision(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function isFilterScalar(value) {
    return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}
function encodeFilterValue(value) {
    return JSON.stringify(value);
}
function flattenFilterValues(value, prefix = '') {
    if (isFilterScalar(value))
        return prefix ? [[prefix, [value]]] : [];
    if (Array.isArray(value)) {
        const scalars = value.filter(isFilterScalar);
        return prefix && scalars.length === value.length && scalars.length > 0 ? [[prefix, scalars]] : [];
    }
    if (!value || typeof value !== 'object')
        return [];
    return Object.entries(value).flatMap(([key, child]) => flattenFilterValues(child, prefix ? `${prefix}.${key}` : key));
}
function filterValues(value) {
    if (Array.isArray(value)) {
        if (value.length === 0 || !value.every(isFilterScalar))
            return undefined;
        return value;
    }
    return isFilterScalar(value) ? [value] : undefined;
}
/**
 * A disposable, metadata-only read model for repeated structured queries.
 * Markdown remains authoritative; this index only avoids reopening and
 * reparsing every note for every pulse/community query.
 */
export class VaultMetadataIndex {
    pathFilter;
    frontmatter;
    vaultPath;
    entries = new Map();
    filterIndex = new Map();
    dirty = new Set();
    ready;
    refreshPromise;
    watcher;
    needsFullRefresh = true;
    lastFullRefreshAt = 0;
    firstList = true;
    constructor(vaultPath, pathFilter, frontmatter) {
        this.pathFilter = pathFilter;
        this.frontmatter = frontmatter;
        this.vaultPath = resolve(vaultPath);
        this.ready = this.refreshAll();
    }
    invalidate(path, kind) {
        const normalized = normalizePath(path);
        if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized))
            return;
        if (kind === 'delete') {
            const existing = this.entries.get(normalized);
            if (existing)
                this.removeFilterEntry(existing);
            this.entries.delete(normalized);
        }
        this.dirty.add(normalized);
    }
    async list(filters) {
        await this.ready;
        this.startWatcher();
        // The server may have been constructed before Obsidian or a direct
        // filesystem writer created notes. Reconcile once at first use so the
        // initial async refresh cannot produce a false empty result.
        if (this.firstList) {
            this.firstList = false;
            this.needsFullRefresh = true;
        }
        if (this.refreshPromise)
            await this.refreshPromise;
        if (this.needsFullRefresh || Date.now() - this.lastFullRefreshAt >= FULL_REFRESH_INTERVAL_MS) {
            await this.refreshAll();
        }
        if (this.dirty.size > 0) {
            await this.refreshDirty();
        }
        const candidates = filters && Object.keys(filters).length > 0 ? this.filterCandidates(filters) : undefined;
        if (!candidates)
            return [...this.entries.values()];
        return [...candidates].map(path => this.entries.get(path)).filter((entry) => entry !== undefined);
    }
    /**
     * Check a previously returned revision without reopening the note body.
     * The stat check keeps the answer fresh even when a filesystem watcher is
     * unavailable; a later full refresh repairs metadata and hash state.
     */
    async matchesRevision(path, expectedRevision) {
        const normalized = normalizePath(path);
        if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized))
            return false;
        await this.list();
        const entry = this.entries.get(normalized);
        if (!entry || entry.revision !== expectedRevision)
            return false;
        try {
            const info = await stat(join(this.vaultPath, normalized));
            if (!info.isFile() || info.size !== entry.size || info.mtimeMs !== entry.mtimeMs) {
                this.dirty.add(normalized);
                return false;
            }
            return true;
        }
        catch {
            this.dirty.add(normalized);
            return false;
        }
    }
    close() {
        this.watcher?.close();
        this.watcher = undefined;
    }
    startWatcher() {
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
                if (!filename) {
                    this.needsFullRefresh = true;
                    return;
                }
                const normalized = normalizePath(String(filename));
                if (isNote(normalized) && this.pathFilter.isAllowed(normalized))
                    this.dirty.add(normalized);
                else
                    this.needsFullRefresh = true;
            });
            this.watcher.on('error', () => {
                this.needsFullRefresh = true;
            });
            this.watcher.unref?.();
        }
        catch {
            // Some filesystems (notably network mounts) do not support recursive
            // watching. Periodic full refreshes preserve correctness there.
            this.watcher = undefined;
        }
    }
    async refreshAll() {
        if (this.refreshPromise)
            return this.refreshPromise;
        this.refreshPromise = (async () => {
            this.dirty.clear();
            this.needsFullRefresh = false;
            const next = new Map();
            const paths = await this.findNotePaths(this.vaultPath);
            for (let start = 0; start < paths.length; start += READ_BATCH_SIZE) {
                const batch = paths.slice(start, start + READ_BATCH_SIZE);
                const metadata = await Promise.all(batch.map(path => this.readEntry(path, this.entries.get(path))));
                for (const entry of metadata) {
                    if (entry)
                        next.set(entry.path, entry);
                }
            }
            this.entries.clear();
            for (const [path, entry] of next)
                this.entries.set(path, entry);
            this.rebuildFilterIndex();
            this.lastFullRefreshAt = Date.now();
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    async refreshDirty() {
        if (this.refreshPromise)
            return this.refreshPromise;
        this.refreshPromise = (async () => {
            const paths = [...this.dirty];
            this.dirty.clear();
            const metadata = await Promise.all(paths.map(path => this.readEntry(path)));
            for (let index = 0; index < paths.length; index += 1) {
                const path = paths[index];
                const entry = metadata[index];
                const previous = this.entries.get(path);
                if (previous)
                    this.removeFilterEntry(previous);
                if (entry)
                    this.entries.set(path, entry);
                else
                    this.entries.delete(path);
                if (entry)
                    this.addFilterEntry(entry);
            }
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    async readEntry(path, existing) {
        const normalized = normalizePath(path);
        if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized))
            return undefined;
        try {
            const fullPath = join(this.vaultPath, normalized);
            const info = await stat(fullPath);
            if (!info.isFile())
                return undefined;
            // Full reconciliation is intentionally stat-only for unchanged notes.
            // This keeps repeated pulse/community reads from reopening and reparsing
            // the whole vault while preserving the existing metadata object.
            if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs)
                return existing;
            const raw = await readFile(fullPath, 'utf8');
            return {
                path: normalized,
                frontmatter: this.frontmatter.parse(raw).frontmatter,
                revision: revision(raw),
                size: info.size,
                mtimeMs: info.mtimeMs,
            };
        }
        catch {
            return undefined;
        }
    }
    rebuildFilterIndex() {
        this.filterIndex.clear();
        for (const entry of this.entries.values())
            this.addFilterEntry(entry);
    }
    addFilterEntry(entry) {
        for (const [key, values] of flattenFilterValues(entry.frontmatter)) {
            for (const value of values) {
                const encoded = encodeFilterValue(value);
                let valueIndex = this.filterIndex.get(key);
                if (!valueIndex) {
                    valueIndex = new Map();
                    this.filterIndex.set(key, valueIndex);
                }
                let paths = valueIndex.get(encoded);
                if (!paths) {
                    paths = new Set();
                    valueIndex.set(encoded, paths);
                }
                paths.add(entry.path);
            }
        }
    }
    removeFilterEntry(entry) {
        for (const [key, values] of flattenFilterValues(entry.frontmatter)) {
            const valueIndex = this.filterIndex.get(key);
            if (!valueIndex)
                continue;
            for (const value of values) {
                const encoded = encodeFilterValue(value);
                const paths = valueIndex.get(encoded);
                paths?.delete(entry.path);
                if (paths && paths.size === 0)
                    valueIndex.delete(encoded);
            }
            if (valueIndex.size === 0)
                this.filterIndex.delete(key);
        }
    }
    filterCandidates(filters) {
        let candidates;
        for (const [key, expected] of Object.entries(filters)) {
            const expectedValues = filterValues(expected);
            if (expectedValues === undefined)
                return undefined;
            const valueIndex = this.filterIndex.get(key);
            const matching = new Set();
            for (const value of expectedValues) {
                for (const path of valueIndex?.get(encodeFilterValue(value)) || [])
                    matching.add(path);
            }
            // An array filter means every requested value must be present in the
            // note's array, so intersect its per-value posting sets rather than
            // unioning them.
            if (Array.isArray(expected)) {
                const required = expectedValues.map(value => valueIndex?.get(encodeFilterValue(value)) || new Set());
                const intersection = new Set(required[0] || []);
                for (const paths of required.slice(1)) {
                    for (const path of intersection)
                        if (!paths.has(path))
                            intersection.delete(path);
                }
                if (candidates) {
                    for (const path of candidates)
                        if (!intersection.has(path))
                            candidates.delete(path);
                }
                else {
                    candidates = intersection;
                }
            }
            else if (candidates) {
                for (const path of candidates)
                    if (!matching.has(path))
                        candidates.delete(path);
            }
            else {
                candidates = matching;
            }
            if (candidates && candidates.size === 0)
                return candidates;
        }
        return candidates || new Set();
    }
    async findNotePaths(directory) {
        const output = [];
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return output;
        }
        for (const entry of entries) {
            if (entry.name === '.mcpvault' || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules')
                continue;
            const fullPath = join(directory, entry.name);
            const relativePath = normalizePath(relative(this.vaultPath, fullPath));
            if (entry.isDirectory())
                output.push(...await this.findNotePaths(fullPath));
            else if (entry.isFile() && isNote(relativePath) && this.pathFilter.isAllowed(relativePath))
                output.push(relativePath);
        }
        return output;
    }
}
