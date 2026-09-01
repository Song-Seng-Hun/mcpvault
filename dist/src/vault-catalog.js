import { watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
const WATCH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function isNote(path) {
    return /\.(?:md|markdown|txt)$/i.test(path);
}
/**
 * Shared, disposable vault file inventory for the read models.
 *
 * Markdown remains authoritative. This class only coalesces the recursive
 * directory walk and filesystem watcher that search, metadata, and semantic
 * indexing would otherwise each maintain independently.
 */
export class VaultFileCatalog {
    pathFilter;
    vaultPath;
    listeners = new Set();
    paths;
    refreshPromise;
    watcher;
    watcherStarted = false;
    needsRefresh = true;
    lastRefreshAt = 0;
    changeGeneration = 0;
    constructor(vaultPath, pathFilter) {
        this.pathFilter = pathFilter;
        this.vaultPath = resolve(vaultPath);
    }
    subscribe(listener) {
        this.listeners.add(listener);
        this.startWatcher();
        return () => this.listeners.delete(listener);
    }
    /** Mark a mutation already handled by the write path without broadcasting it twice. */
    invalidate(path) {
        this.changeGeneration += 1;
        this.paths = undefined;
        this.needsRefresh = true;
        if (path)
            this.needsRefresh = true;
    }
    async listNotePaths() {
        this.startWatcher();
        const interval = this.watcher ? WATCH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
        if (!this.needsRefresh && this.paths && Date.now() - this.lastRefreshAt < interval)
            return [...this.paths];
        if (!this.refreshPromise)
            this.refreshPromise = this.refresh();
        try {
            return [...await this.refreshPromise];
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    close() {
        this.watcher?.close();
        this.watcher = undefined;
        this.listeners.clear();
        this.paths = undefined;
        this.refreshPromise = undefined;
    }
    startWatcher() {
        if (this.watcherStarted)
            return;
        this.watcherStarted = true;
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
                this.onFilesystemEvent(filename ? String(filename) : undefined);
            });
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
                this.invalidate();
                this.emit();
            });
            this.watcher.unref?.();
        }
        catch {
            // Network mounts and some Windows filesystems do not support recursive
            // watchers. The shorter reconciliation interval remains authoritative.
            this.watcher = undefined;
        }
    }
    onFilesystemEvent(filename) {
        if (!filename) {
            this.invalidate();
            this.emit();
            return;
        }
        const path = normalizePath(filename);
        // Ignore the catalog's own hidden state and other restricted files. Their
        // writes must not trigger a full public-vault refresh.
        if (!path || !this.pathFilter.isAllowedForListing(path))
            return;
        if (!isNote(path) || !this.pathFilter.isAllowed(path)) {
            this.invalidate();
            this.emit();
            return;
        }
        this.invalidate(path);
        void stat(join(this.vaultPath, path)).then(info => {
            this.emit(path, info.isFile() ? 'upsert' : 'delete');
        }).catch(() => {
            this.emit(path, 'delete');
        });
    }
    emit(path, kind) {
        for (const listener of this.listeners) {
            try {
                listener(path, kind);
            }
            catch {
                // A read model must not be able to break the shared watcher.
            }
        }
    }
    async refresh() {
        const generation = this.changeGeneration;
        const paths = await this.findNotePaths(this.vaultPath);
        if (generation === this.changeGeneration) {
            this.paths = paths;
            this.needsRefresh = false;
            this.lastRefreshAt = Date.now();
        }
        return paths;
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
            const fullPath = join(directory, entry.name);
            const relativePath = normalizePath(relative(this.vaultPath, fullPath));
            if (entry.isDirectory()) {
                if (this.pathFilter.isAllowedForListing(relativePath))
                    output.push(...await this.findNotePaths(fullPath));
            }
            else if (entry.isFile() && isNote(relativePath) && this.pathFilter.isAllowed(relativePath)) {
                output.push(relativePath);
            }
        }
        return output.sort((a, b) => a.localeCompare(b));
    }
}
