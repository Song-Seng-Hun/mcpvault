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
        if (kind === 'delete')
            this.entries.delete(normalized);
        this.dirty.add(normalized);
    }
    async list() {
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
        return [...this.entries.values()];
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
                const metadata = await Promise.all(batch.map(path => this.readEntry(path)));
                for (const entry of metadata) {
                    if (entry)
                        next.set(entry.path, entry);
                }
            }
            this.entries.clear();
            for (const [path, entry] of next)
                this.entries.set(path, entry);
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
                if (entry)
                    this.entries.set(path, entry);
                else
                    this.entries.delete(path);
            }
        })();
        try {
            await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    async readEntry(path) {
        const normalized = normalizePath(path);
        if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized))
            return undefined;
        try {
            const fullPath = join(this.vaultPath, normalized);
            const [raw, info] = await Promise.all([readFile(fullPath, 'utf8'), stat(fullPath)]);
            if (!info.isFile())
                return undefined;
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
