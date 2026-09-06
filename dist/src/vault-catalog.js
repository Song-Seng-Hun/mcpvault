import { watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { isMissingVaultPath, VaultReadUnavailableError } from './vault-read-errors.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
import { forEachInventoryItem } from './inventory-work.js';
const WATCH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const WATCH_EVENT_BATCH_DELAY_MS = 50;
const WATCH_EVENT_STAT_BATCH_SIZE = 32;
const STAT_CACHE_TTL_MS = 1_000;
const STAT_CACHE_MAX_ENTRIES = 8_192;
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
    batchListeners = new Set();
    paths;
    allPaths;
    refreshPromise;
    watcher;
    watcherStarted = false;
    needsRefresh = true;
    lastReconciledAt = 0;
    forceReconcile = false;
    changeGeneration = 0;
    pendingChanges = new Map();
    pendingFullRefresh = false;
    pendingTimer;
    flushPromise = Promise.resolve();
    readBarrier;
    closed = false;
    directoryCache = new Map();
    dirtyDirectories = new Set();
    statInFlight = new Map();
    statCache = new Map();
    constructor(vaultPath, pathFilter) {
        this.pathFilter = pathFilter;
        this.vaultPath = resolve(vaultPath);
    }
    assertOpen() {
        if (this.closed)
            throw new Error('Vault catalog is closed.');
    }
    subscribe(listener) {
        if (this.closed)
            return () => undefined;
        this.listeners.add(listener);
        this.startWatcher();
        return () => this.listeners.delete(listener);
    }
    /** Subscribe to coalesced watcher changes so read models invalidate once per batch. */
    subscribeBatch(listener) {
        if (this.closed)
            return () => undefined;
        this.batchListeners.add(listener);
        this.startWatcher();
        return () => this.batchListeners.delete(listener);
    }
    /** Mark a mutation already handled by the write path without broadcasting it twice. */
    invalidate(path) {
        if (path) {
            this.invalidateMany([{ path, kind: 'upsert' }]);
            return;
        }
        this.invalidateMany();
    }
    /** Invalidate several direct mutations with one generation/cache update. */
    invalidateMany(changes) {
        if (this.closed)
            return;
        this.changeGeneration += 1;
        this.paths = undefined;
        this.needsRefresh = true;
        if (changes) {
            for (const change of changes) {
                const normalized = normalizePath(change.path);
                this.statCache.delete(normalized);
                this.markDirtyDirectories(normalized);
            }
        }
        else {
            this.directoryCache.clear();
            this.dirtyDirectories.clear();
            this.statCache.clear();
            derivedCacheBudget.clearOwner(this.cacheOwner);
        }
    }
    async listNotePaths() {
        const inventory = await this.listInventory();
        this.assertOpen();
        return [...inventory.notes];
    }
    /** Return the current immutable-by-convention note-path snapshot for read models. */
    async notePathsSnapshot() {
        const inventory = await this.listInventory();
        this.assertOpen();
        return inventory.notes;
    }
    async listAllPaths() {
        const inventory = await this.listInventory();
        this.assertOpen();
        return [...inventory.all];
    }
    /** Return the current immutable-by-convention all-path snapshot for read models. */
    async allPathsSnapshot() {
        const inventory = await this.listInventory();
        this.assertOpen();
        return inventory.all;
    }
    /** Drain received notifications before an index decides it is clean.
     * This joins the active batch; it neither sleeps for the debounce timer nor
     * waits indefinitely for future OS events/writers. Concurrent reads coalesce.
     */
    flushPendingEvents() {
        if (this.readBarrier)
            return this.readBarrier;
        const operation = (async () => {
            await this.flushPromise;
            if (this.closed)
                return;
            if (this.pendingTimer)
                clearTimeout(this.pendingTimer);
            this.pendingTimer = undefined;
            if (!this.pendingFullRefresh && this.pendingChanges.size === 0)
                return;
            const flush = this.flushPendingChanges();
            this.flushPromise = flush.catch(() => {
                if (this.closed)
                    return;
                // Keep the serialization chain usable and reconcile after a failed
                // batch. The reading caller still receives the original rejection.
                this.invalidate();
                if (!this.pendingChanges.size)
                    this.pendingFullRefresh = true;
            });
            await flush;
        })();
        const barrier = operation.finally(() => {
            if (this.readBarrier === barrier)
                this.readBarrier = undefined;
        });
        this.readBarrier = barrier;
        return barrier;
    }
    /** Share concurrent file stat calls between read models without retaining file metadata. */
    async statPaths(paths) {
        this.assertOpen();
        const unique = [...new Set(paths.map(normalizePath).filter(path => path && this.pathFilter.isAllowed(path)))];
        const result = new Map();
        for (let start = 0; start < unique.length; start += WATCH_EVENT_STAT_BATCH_SIZE) {
            const batch = unique.slice(start, start + WATCH_EVENT_STAT_BATCH_SIZE);
            const stats = await Promise.all(batch.map(path => this.statPath(path)));
            this.assertOpen();
            for (let index = 0; index < batch.length; index += 1) {
                const info = stats[index];
                if (info)
                    result.set(batch[index], info);
            }
        }
        return result;
    }
    async listInventory() {
        this.assertOpen();
        this.startWatcher();
        for (let attempt = 0; attempt < 3; attempt++) {
            await this.flushPendingEvents();
            this.assertOpen();
            const interval = this.watcher ? WATCH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
            const reconcile = this.forceReconcile || !this.allPaths || Date.now() - this.lastReconciledAt >= interval;
            if (!this.needsRefresh && this.paths && this.allPaths && !reconcile) {
                return { notes: this.paths, all: this.allPaths };
            }
            if (!this.refreshPromise) {
                const refresh = this.refresh(reconcile).finally(() => {
                    if (this.refreshPromise === refresh)
                        this.refreshPromise = undefined;
                });
                this.refreshPromise = refresh;
            }
            try {
                await this.refreshPromise;
            }
            catch (error) {
                // Aborted scans may have filled caches after consuming dirty flags.
                // Preserve the forced read requirement across failed requests too.
                this.forceReconcile = true;
                throw error;
            }
            await this.flushPendingEvents();
            this.assertOpen();
            if (!this.forceReconcile && !this.needsRefresh && this.paths && this.allPaths
                && Date.now() - this.lastReconciledAt < interval) {
                return { notes: this.paths, all: this.allPaths };
            }
            // A received change can invalidate entries while an older directory
            // read is filling the cache. Do not reuse that aborted scan on retry.
            this.forceReconcile = true;
        }
        throw new Error('Catalog changed during refresh; retry the query. No stable inventory was returned.');
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.changeGeneration += 1;
        if (this.pendingTimer)
            clearTimeout(this.pendingTimer);
        this.pendingTimer = undefined;
        this.pendingChanges.clear();
        this.pendingFullRefresh = false;
        this.watcher?.close();
        this.watcher = undefined;
        this.listeners.clear();
        this.batchListeners.clear();
        this.paths = undefined;
        this.allPaths = undefined;
        // Keep ownership until the active refresh's finally releases it. Native IO
        // may still finish, but closed guards discard its result before publication.
        this.directoryCache.clear();
        this.dirtyDirectories.clear();
        this.statInFlight.clear();
        this.statCache.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
    }
    statPath(path) {
        this.assertOpen();
        const normalized = normalizePath(path);
        const cached = this.statCache.get(normalized);
        if (cached && cached.generation === this.changeGeneration && cached.expiresAt > Date.now()) {
            this.statCache.delete(normalized);
            this.statCache.set(normalized, cached);
            return Promise.resolve(cached.value);
        }
        if (cached)
            this.statCache.delete(normalized);
        const running = this.statInFlight.get(normalized);
        if (running)
            return running;
        const generation = this.changeGeneration;
        const computation = stat(join(this.vaultPath, normalized))
            .then(info => info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : undefined)
            .then(value => {
            this.assertOpen();
            if (generation === this.changeGeneration) {
                this.statCache.set(normalized, { value, generation, expiresAt: Date.now() + STAT_CACHE_TTL_MS });
                while (this.statCache.size > STAT_CACHE_MAX_ENTRIES)
                    this.statCache.delete(this.statCache.keys().next().value);
            }
            return value;
        })
            .catch(error => {
            this.assertOpen();
            if (isMissingVaultPath(error))
                return undefined;
            throw new VaultReadUnavailableError();
        });
        this.statInFlight.set(normalized, computation);
        const cleanup = () => {
            if (this.statInFlight.get(normalized) === computation)
                this.statInFlight.delete(normalized);
        };
        void computation.then(cleanup, cleanup);
        return computation;
    }
    startWatcher() {
        if (this.closed || this.watcherStarted)
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
                this.emitBatch();
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
        if (this.closed)
            return;
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
            this.emitBatch();
            return;
        }
        for (let start = 0; start < paths.length; start += WATCH_EVENT_STAT_BATCH_SIZE) {
            // Notification callbacks may synchronously close the catalog after the
            // previous batch. Do not start a subsequent native stat batch in that case.
            if (this.closed)
                return;
            const batch = paths.slice(start, start + WATCH_EVENT_STAT_BATCH_SIZE);
            let states;
            try {
                states = await Promise.all(batch.map(async (path) => {
                    try {
                        const info = await stat(join(this.vaultPath, path));
                        return { path, kind: info.isFile() ? 'upsert' : 'delete' };
                    }
                    catch (error) {
                        if (!isMissingVaultPath(error))
                            throw new VaultReadUnavailableError();
                        return { path, kind: 'delete' };
                    }
                }));
            }
            catch (error) {
                // The batch was not delivered. Preserve its tail without scheduling
                // an automatic retry loop during a storage outage.
                if (!this.closed && !this.pendingFullRefresh) {
                    for (const path of paths.slice(start))
                        this.pendingChanges.set(path, true);
                }
                throw error;
            }
            if (this.closed)
                return;
            if (states.length > 0)
                this.emitBatch(states);
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
    emitBatch(changes) {
        for (const listener of this.batchListeners) {
            try {
                listener(changes);
            }
            catch {
                // A read model must not be able to break the shared watcher.
            }
        }
        if (changes) {
            for (const change of changes)
                this.emit(change.path, change.kind);
        }
        else {
            this.emit();
        }
    }
    async refresh(reconcile = false) {
        this.assertOpen();
        const generation = this.changeGeneration;
        const inventory = await this.findPaths(this.vaultPath, reconcile);
        this.assertOpen();
        inventory.notes.sort((a, b) => a.localeCompare(b));
        inventory.all.sort((a, b) => a.localeCompare(b));
        if (generation === this.changeGeneration) {
            this.paths = inventory.notes;
            this.allPaths = inventory.all;
            this.needsRefresh = false;
            // Incremental hot-folder refreshes must not postpone a full census.
            if (reconcile) {
                this.lastReconciledAt = Date.now();
                this.forceReconcile = false;
            }
        }
    }
    async findPaths(directory, reconcile = false, budget = DIRECTORY_SCAN_BATCH_SIZE) {
        this.assertOpen();
        // An unchanged ancestor's stat says nothing about nested membership.
        // Periodic reconciliation must bypass both subtree and entry caches.
        if (this.watcher && !reconcile) {
            try {
                const info = await stat(directory);
                this.assertOpen();
                const cached = this.directoryCache.get(directory);
                if (!this.dirtyDirectories.has(directory)
                    && cached
                    && cached.notes
                    && cached.all
                    && cached.mtimeMs === info.mtimeMs
                    && cached.size === info.size) {
                    this.directoryCache.delete(directory);
                    this.directoryCache.set(directory, cached);
                    derivedCacheBudget.touch(this.cacheOwner, directory);
                    return { notes: cached.notes, all: cached.all };
                }
            }
            catch (error) {
                this.assertOpen();
                if (directory !== this.vaultPath && isMissingVaultPath(error))
                    return { notes: [], all: [] };
                throw new VaultReadUnavailableError();
            }
        }
        const notes = [];
        const all = [];
        const entries = await this.readDirectoryEntries(directory, reconcile);
        this.assertOpen();
        const directories = [];
        await forEachInventoryItem(entries, entry => {
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
        }, () => this.assertOpen());
        this.assertOpen();
        for (let start = 0; start < directories.length; start += budget) {
            const batch = directories.slice(start, start + budget);
            // Failed scans must drain siblings before refreshPromise is released;
            // otherwise a retry races late writes into the shared directory cache.
            // Partition one tree-wide budget instead of granting eight new slots at
            // every depth. A branch owns its slots until its whole subtree settles.
            const nested = await Promise.allSettled(batch.map((item, index) => this.findPaths(item.fullPath, reconcile, Math.floor(budget / batch.length) + (index < budget % batch.length ? 1 : 0))));
            const failed = nested.find(result => result.status === 'rejected');
            if (failed?.status === 'rejected')
                throw failed.reason;
            this.assertOpen();
            for (const result of nested) {
                if (result.status !== 'fulfilled')
                    continue;
                await forEachInventoryItem(result.value.notes, path => { notes.push(path); }, () => this.assertOpen());
                await forEachInventoryItem(result.value.all, path => { all.push(path); }, () => this.assertOpen());
            }
        }
        this.assertOpen();
        const cached = this.directoryCache.get(directory);
        if (this.watcher && cached) {
            cached.notes = notes;
            cached.all = all;
            this.directoryCache.delete(directory);
            this.directoryCache.set(directory, cached);
            derivedCacheBudget.register(this.cacheOwner, directory, estimateCacheBytes(cached) + 64, () => {
                if (this.directoryCache.get(directory) !== cached)
                    return;
                this.directoryCache.delete(directory);
            });
            derivedCacheBudget.touch(this.cacheOwner, directory);
        }
        return { notes, all };
    }
    async readDirectoryEntries(directory, reconcile = false) {
        this.assertOpen();
        // Keep full reconciliation when recursive watching is unavailable. The
        // cache is safe only when watcher events can mark changed ancestors.
        if (!this.watcher) {
            try {
                const entries = await readdir(directory, { withFileTypes: true });
                this.assertOpen();
                return entries.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
            }
            catch (error) {
                this.assertOpen();
                if (directory !== this.vaultPath && isMissingVaultPath(error))
                    return [];
                throw new VaultReadUnavailableError();
            }
        }
        let info;
        try {
            info = await stat(directory);
        }
        catch (error) {
            this.assertOpen();
            if (directory !== this.vaultPath && isMissingVaultPath(error))
                return [];
            throw new VaultReadUnavailableError();
        }
        this.assertOpen();
        const cached = this.directoryCache.get(directory);
        if (!reconcile && !this.dirtyDirectories.has(directory) && cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
            this.directoryCache.delete(directory);
            this.directoryCache.set(directory, cached);
            derivedCacheBudget.touch(this.cacheOwner, directory);
            return cached.entries;
        }
        let entries;
        try {
            const listed = await readdir(directory, { withFileTypes: true });
            this.assertOpen();
            entries = listed.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
        }
        catch (error) {
            this.assertOpen();
            if (directory !== this.vaultPath && isMissingVaultPath(error))
                return [];
            throw new VaultReadUnavailableError();
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
