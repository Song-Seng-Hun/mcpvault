import { watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
const WATCH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const WATCH_EVENT_BATCH_DELAY_MS = 50;
const WATCH_EVENT_STAT_BATCH_SIZE = 32;
const DIRECTORY_SCAN_BATCH_SIZE = 8;
const DIRECTORY_CACHE_MAX_ENTRIES = 4096;
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
    cacheOwner = createDerivedCacheOwner('vault.directories');
    vaultPath;
    listeners = new Set();
    paths;
    allPaths;
    refreshPromise;
    watcher;
    watcherStarted = false;
    needsRefresh = true;
    lastRefreshAt = 0;
    changeGeneration = 0;
    pendingChanges = new Map();
    pendingFullRefresh = false;
    pendingTimer;
    flushPromise = Promise.resolve();
    closed = false;
    directoryCache = new Map();
    dirtyDirectories = new Set();
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
            this.markDirtyDirectories(path);
        else {
            this.directoryCache.clear();
            this.dirtyDirectories.clear();
            derivedCacheBudget.clearOwner(this.cacheOwner);
        }
    }
    async listNotePaths() {
        const inventory = await this.listInventory();
        return [...inventory.notes];
    }
    async listAllPaths() {
        const inventory = await this.listInventory();
        return [...inventory.all];
    }
    async listInventory() {
        this.startWatcher();
        const interval = this.watcher ? WATCH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
        if (!this.needsRefresh && this.paths && this.allPaths && Date.now() - this.lastRefreshAt < interval) {
            return { notes: [...this.paths], all: [...this.allPaths] };
        }
        if (!this.refreshPromise)
            this.refreshPromise = this.refresh();
        try {
            return await this.refreshPromise;
        }
        finally {
            this.refreshPromise = undefined;
        }
    }
    close() {
        this.closed = true;
        if (this.pendingTimer)
            clearTimeout(this.pendingTimer);
        this.pendingTimer = undefined;
        this.pendingChanges.clear();
        this.pendingFullRefresh = false;
        this.watcher?.close();
        this.watcher = undefined;
        this.listeners.clear();
        this.paths = undefined;
        this.allPaths = undefined;
        this.refreshPromise = undefined;
        this.directoryCache.clear();
        this.dirtyDirectories.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
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
            this.queueFullRefreshEvent();
            return;
        }
        const path = normalizePath(filename);
        // Ignore the catalog's own hidden state and other restricted files. Their
        // writes must not trigger a full public-vault refresh.
        if (!path || !this.pathFilter.isAllowedForListing(path))
            return;
        if (!isNote(path) || !this.pathFilter.isAllowed(path)) {
            this.invalidate();
            this.queueFullRefreshEvent();
            return;
        }
        this.invalidate(path);
        this.pendingChanges.set(path, true);
        this.scheduleFlush();
    }
    queueFullRefreshEvent() {
        this.pendingFullRefresh = true;
        this.pendingChanges.clear();
        this.directoryCache.clear();
        this.dirtyDirectories.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
        this.scheduleFlush();
    }
    scheduleFlush() {
        if (this.pendingTimer || this.closed)
            return;
        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = undefined;
            this.flushPromise = this.flushPromise.then(() => this.flushPendingChanges()).catch(() => undefined);
        }, WATCH_EVENT_BATCH_DELAY_MS);
        this.pendingTimer.unref?.();
    }
    async flushPendingChanges() {
        if (this.closed)
            return;
        const fullRefresh = this.pendingFullRefresh;
        const paths = fullRefresh ? [] : [...this.pendingChanges.keys()];
        this.pendingFullRefresh = false;
        this.pendingChanges.clear();
        if (fullRefresh) {
            this.emit();
            return;
        }
        for (let start = 0; start < paths.length; start += WATCH_EVENT_STAT_BATCH_SIZE) {
            const batch = paths.slice(start, start + WATCH_EVENT_STAT_BATCH_SIZE);
            const states = await Promise.all(batch.map(async (path) => {
                try {
                    const info = await stat(join(this.vaultPath, path));
                    return { path, kind: info.isFile() ? 'upsert' : 'delete' };
                }
                catch {
                    return { path, kind: 'delete' };
                }
            }));
            if (this.closed)
                return;
            for (const state of states)
                this.emit(state.path, state.kind);
        }
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
        const inventory = await this.findPaths(this.vaultPath);
        inventory.notes.sort((a, b) => a.localeCompare(b));
        inventory.all.sort((a, b) => a.localeCompare(b));
        if (generation === this.changeGeneration) {
            this.paths = inventory.notes;
            this.allPaths = inventory.all;
            this.needsRefresh = false;
            this.lastRefreshAt = Date.now();
        }
        return inventory;
    }
    async findPaths(directory) {
        const notes = [];
        const all = [];
        const entries = await this.readDirectoryEntries(directory);
        const directories = [];
        for (const entry of entries) {
            const fullPath = join(directory, entry.name);
            const relativePath = normalizePath(relative(this.vaultPath, fullPath));
            if (entry.directory) {
                if (this.pathFilter.isAllowedForListing(relativePath)) {
                    directories.push({ fullPath, relativePath });
                }
            }
            else if (entry.file && this.pathFilter.isAllowedForListing(relativePath)) {
                all.push(relativePath);
                if (isNote(relativePath) && this.pathFilter.isAllowed(relativePath))
                    notes.push(relativePath);
            }
        }
        for (let start = 0; start < directories.length; start += DIRECTORY_SCAN_BATCH_SIZE) {
            const batch = directories.slice(start, start + DIRECTORY_SCAN_BATCH_SIZE);
            const nested = await Promise.all(batch.map(item => this.findPaths(item.fullPath)));
            for (const result of nested) {
                notes.push(...result.notes);
                all.push(...result.all);
            }
        }
        return { notes, all };
    }
    async readDirectoryEntries(directory) {
        // Keep full reconciliation when recursive watching is unavailable. The
        // cache is safe only when watcher events can mark changed ancestors.
        if (!this.watcher) {
            try {
                const entries = await readdir(directory, { withFileTypes: true });
                return entries.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
            }
            catch {
                return [];
            }
        }
        let info;
        try {
            info = await stat(directory);
        }
        catch {
            return [];
        }
        const cached = this.directoryCache.get(directory);
        if (!this.dirtyDirectories.has(directory) && cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
            this.directoryCache.delete(directory);
            this.directoryCache.set(directory, cached);
            derivedCacheBudget.touch(this.cacheOwner, directory);
            return cached.entries;
        }
        let entries;
        try {
            const listed = await readdir(directory, { withFileTypes: true });
            entries = listed.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
        }
        catch {
            return [];
        }
        this.dirtyDirectories.delete(directory);
        const cacheEntry = { mtimeMs: info.mtimeMs, size: info.size, entries };
        this.directoryCache.set(directory, cacheEntry);
        derivedCacheBudget.register(this.cacheOwner, directory, estimateCacheBytes(cacheEntry) + 64, () => {
            if (this.directoryCache.get(directory) !== cacheEntry)
                return;
            this.directoryCache.delete(directory);
        });
        while (this.directoryCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
            const oldest = this.directoryCache.keys().next();
            if (oldest.done)
                break;
            this.directoryCache.delete(oldest.value);
            derivedCacheBudget.remove(this.cacheOwner, oldest.value);
        }
        return entries;
    }
    markDirtyDirectories(path) {
        let current = resolve(this.vaultPath, path).replace(/[\\/][^\\/]+$/, '');
        const root = this.vaultPath.toLowerCase();
        while (current.toLowerCase().startsWith(root) && current.length >= this.vaultPath.length) {
            this.dirtyDirectories.add(current);
            if (current.length === this.vaultPath.length)
                break;
            current = resolve(current, '..');
        }
    }
}
