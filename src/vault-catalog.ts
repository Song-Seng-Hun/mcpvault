import { watch, type FSWatcher } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { PathFilter } from './pathfilter.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';

const WATCH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const WATCH_EVENT_BATCH_DELAY_MS = 50;
const WATCH_EVENT_STAT_BATCH_SIZE = 32;
const DIRECTORY_SCAN_BATCH_SIZE = 8;
const DIRECTORY_CACHE_MAX_ENTRIES = 4096;

interface DirectoryCacheEntry {
  mtimeMs: number;
  size: number;
  entries: Array<{ name: string; directory: boolean; file: boolean }>;
  notes?: string[];
  all?: string[];
}

export type VaultCatalogChangeKind = 'upsert' | 'delete';
export type VaultCatalogListener = (path?: string, kind?: VaultCatalogChangeKind) => void;

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isNote(path: string): boolean {
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
  private readonly cacheOwner = createDerivedCacheOwner('vault.directories');
  private readonly vaultPath: string;
  private readonly listeners = new Set<VaultCatalogListener>();
  private paths: string[] | undefined;
  private allPaths: string[] | undefined;
  private refreshPromise: Promise<{ notes: string[]; all: string[] }> | undefined;
  private watcher: FSWatcher | undefined;
  private watcherStarted = false;
  private needsRefresh = true;
  private lastRefreshAt = 0;
  private changeGeneration = 0;
  private pendingChanges = new Map<string, true>();
  private pendingFullRefresh = false;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly directoryCache = new Map<string, DirectoryCacheEntry>();
  private readonly dirtyDirectories = new Set<string>();

  constructor(vaultPath: string, private readonly pathFilter: PathFilter) {
    this.vaultPath = resolve(vaultPath);
  }

  subscribe(listener: VaultCatalogListener): () => void {
    this.listeners.add(listener);
    this.startWatcher();
    return () => this.listeners.delete(listener);
  }

  /** Mark a mutation already handled by the write path without broadcasting it twice. */
  invalidate(path?: string): void {
    this.changeGeneration += 1;
    this.paths = undefined;
    this.needsRefresh = true;
    if (path) this.markDirtyDirectories(path);
    else {
      this.directoryCache.clear();
      this.dirtyDirectories.clear();
      derivedCacheBudget.clearOwner(this.cacheOwner);
    }
  }

  async listNotePaths(): Promise<string[]> {
    const inventory = await this.listInventory();
    return [...inventory.notes];
  }

  /** Return the current immutable-by-convention note-path snapshot for read models. */
  async notePathsSnapshot(): Promise<readonly string[]> {
    return (await this.listInventory()).notes;
  }

  async listAllPaths(): Promise<string[]> {
    const inventory = await this.listInventory();
    return [...inventory.all];
  }

  /** Return the current immutable-by-convention all-path snapshot for read models. */
  async allPathsSnapshot(): Promise<readonly string[]> {
    return (await this.listInventory()).all;
  }

  private async listInventory(): Promise<{ notes: string[]; all: string[] }> {
    this.startWatcher();
    const interval = this.watcher ? WATCH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
    if (!this.needsRefresh && this.paths && this.allPaths && Date.now() - this.lastRefreshAt < interval) {
      return { notes: this.paths, all: this.allPaths };
    }
    if (!this.refreshPromise) this.refreshPromise = this.refresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  close(): void {
    this.closed = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
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

  private startWatcher(): void {
    if (this.watcherStarted) return;
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
    } catch {
      // Network mounts and some Windows filesystems do not support recursive
      // watchers. The shorter reconciliation interval remains authoritative.
      this.watcher = undefined;
    }
  }

  private onFilesystemEvent(filename: string | undefined): void {
    if (!filename) {
      this.invalidate();
      this.queueFullRefreshEvent();
      return;
    }
    const path = normalizePath(filename);
    // Ignore the catalog's own hidden state and other restricted files. Their
    // writes must not trigger a full public-vault refresh.
    if (!path || !this.pathFilter.isAllowedForListing(path)) return;
    if (!isNote(path) || !this.pathFilter.isAllowed(path)) {
      this.invalidate();
      this.queueFullRefreshEvent();
      return;
    }
    this.invalidate(path);
    this.pendingChanges.set(path, true);
    this.scheduleFlush();
  }

  private queueFullRefreshEvent(): void {
    this.pendingFullRefresh = true;
    this.pendingChanges.clear();
    this.directoryCache.clear();
    this.dirtyDirectories.clear();
    derivedCacheBudget.clearOwner(this.cacheOwner);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.pendingTimer || this.closed) return;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = undefined;
      this.flushPromise = this.flushPromise.then(() => this.flushPendingChanges()).catch(() => undefined);
    }, WATCH_EVENT_BATCH_DELAY_MS);
    this.pendingTimer.unref?.();
  }

  private async flushPendingChanges(): Promise<void> {
    if (this.closed) return;
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
      const states = await Promise.all(batch.map(async path => {
        try {
          const info = await stat(join(this.vaultPath, path));
          return { path, kind: info.isFile() ? 'upsert' as const : 'delete' as const };
        } catch {
          return { path, kind: 'delete' as const };
        }
      }));
      if (this.closed) return;
      for (const state of states) this.emit(state.path, state.kind);
    }
  }

  private emit(path?: string, kind?: VaultCatalogChangeKind): void {
    for (const listener of this.listeners) {
      try {
        listener(path, kind);
      } catch {
        // A read model must not be able to break the shared watcher.
      }
    }
  }

  private async refresh(): Promise<{ notes: string[]; all: string[] }> {
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

  private async findPaths(directory: string): Promise<{ notes: string[]; all: string[] }> {
    if (this.watcher) {
      try {
        const info = await stat(directory);
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
      } catch {
        return { notes: [], all: [] };
      }
    }
    const notes: string[] = [];
    const all: string[] = [];
    const entries = await this.readDirectoryEntries(directory);
    const directories: Array<{ fullPath: string; relativePath: string }> = [];
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = normalizePath(relative(this.vaultPath, fullPath));
      if (entry.directory) {
        if (this.pathFilter.isAllowedForListing(relativePath)) {
          directories.push({ fullPath, relativePath });
        }
      } else if (entry.file && this.pathFilter.isAllowedForListing(relativePath)) {
        all.push(relativePath);
        if (isNote(relativePath) && this.pathFilter.isAllowed(relativePath)) notes.push(relativePath);
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
    const cached = this.directoryCache.get(directory);
    if (this.watcher && cached) {
      cached.notes = notes;
      cached.all = all;
      this.directoryCache.delete(directory);
      this.directoryCache.set(directory, cached);
      derivedCacheBudget.register(this.cacheOwner, directory, estimateCacheBytes(cached) + 64, () => {
        if (this.directoryCache.get(directory) !== cached) return;
        this.directoryCache.delete(directory);
      });
      derivedCacheBudget.touch(this.cacheOwner, directory);
    }
    return { notes, all };
  }

  private async readDirectoryEntries(directory: string): Promise<Array<{ name: string; directory: boolean; file: boolean }>> {
    // Keep full reconciliation when recursive watching is unavailable. The
    // cache is safe only when watcher events can mark changed ancestors.
    if (!this.watcher) {
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
      } catch {
        return [];
      }
    }

    let info;
    try {
      info = await stat(directory);
    } catch {
      return [];
    }
    const cached = this.directoryCache.get(directory);
    if (!this.dirtyDirectories.has(directory) && cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      this.directoryCache.delete(directory);
      this.directoryCache.set(directory, cached);
      derivedCacheBudget.touch(this.cacheOwner, directory);
      return cached.entries;
    }
    let entries: Array<{ name: string; directory: boolean; file: boolean }>;
    try {
      const listed = await readdir(directory, { withFileTypes: true });
      entries = listed.map(entry => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() }));
    } catch {
      return [];
    }
    this.dirtyDirectories.delete(directory);
    const cacheEntry: DirectoryCacheEntry = { mtimeMs: info.mtimeMs, size: info.size, entries };
    this.directoryCache.set(directory, cacheEntry);
    derivedCacheBudget.register(this.cacheOwner, directory, estimateCacheBytes(cacheEntry) + 64, () => {
      if (this.directoryCache.get(directory) !== cacheEntry) return;
      this.directoryCache.delete(directory);
    });
    while (this.directoryCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
      const oldest = this.directoryCache.keys().next();
      if (oldest.done) break;
      this.directoryCache.delete(oldest.value);
      derivedCacheBudget.remove(this.cacheOwner, oldest.value);
    }
    return entries;
  }

  private markDirtyDirectories(path: string): void {
    let current = resolve(this.vaultPath, path).replace(/[\\/][^\\/]+$/, '');
    const root = this.vaultPath.toLowerCase();
    while (current.toLowerCase().startsWith(root) && current.length >= this.vaultPath.length) {
      this.dirtyDirectories.add(current);
      if (current.length === this.vaultPath.length) break;
      current = resolve(current, '..');
    }
  }
}
