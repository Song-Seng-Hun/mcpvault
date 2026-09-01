import { watch, type FSWatcher } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { PathFilter } from './pathfilter.js';

const WATCH_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;

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
    if (path) this.needsRefresh = true;
  }

  async listNotePaths(): Promise<string[]> {
    const inventory = await this.listInventory();
    return [...inventory.notes];
  }

  async listAllPaths(): Promise<string[]> {
    const inventory = await this.listInventory();
    return [...inventory.all];
  }

  private async listInventory(): Promise<{ notes: string[]; all: string[] }> {
    this.startWatcher();
    const interval = this.watcher ? WATCH_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
    if (!this.needsRefresh && this.paths && this.allPaths && Date.now() - this.lastRefreshAt < interval) {
      return { notes: [...this.paths], all: [...this.allPaths] };
    }
    if (!this.refreshPromise) this.refreshPromise = this.refresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.listeners.clear();
    this.paths = undefined;
    this.allPaths = undefined;
    this.refreshPromise = undefined;
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
      this.emit();
      return;
    }
    const path = normalizePath(filename);
    // Ignore the catalog's own hidden state and other restricted files. Their
    // writes must not trigger a full public-vault refresh.
    if (!path || !this.pathFilter.isAllowedForListing(path)) return;
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
    if (generation === this.changeGeneration) {
      this.paths = inventory.notes;
      this.allPaths = inventory.all;
      this.needsRefresh = false;
      this.lastRefreshAt = Date.now();
    }
    return inventory;
  }

  private async findPaths(directory: string): Promise<{ notes: string[]; all: string[] }> {
    const notes: string[] = [];
    const all: string[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return { notes, all };
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = normalizePath(relative(this.vaultPath, fullPath));
      if (entry.isDirectory()) {
        if (this.pathFilter.isAllowedForListing(relativePath)) {
          const nested = await this.findPaths(fullPath);
          notes.push(...nested.notes);
          all.push(...nested.all);
        }
      } else if (entry.isFile() && this.pathFilter.isAllowedForListing(relativePath)) {
        all.push(relativePath);
        if (isNote(relativePath) && this.pathFilter.isAllowed(relativePath)) notes.push(relativePath);
      }
    }
    notes.sort((a, b) => a.localeCompare(b));
    all.sort((a, b) => a.localeCompare(b));
    return { notes, all };
  }
}
