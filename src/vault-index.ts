import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';

const FULL_REFRESH_INTERVAL_MS = 60_000;
const READ_BATCH_SIZE = 32;

export interface VaultIndexEntry {
  path: string;
  frontmatter: Record<string, any>;
  revision: string;
  size: number;
  mtimeMs: number;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isNote(path: string): boolean {
  return /\.(?:md|markdown|txt)$/i.test(path);
}

function revision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * A disposable, metadata-only read model for repeated structured queries.
 * Markdown remains authoritative; this index only avoids reopening and
 * reparsing every note for every pulse/community query.
 */
export class VaultMetadataIndex {
  private readonly vaultPath: string;
  private readonly entries = new Map<string, VaultIndexEntry>();
  private readonly dirty = new Set<string>();
  private ready: Promise<void>;
  private refreshPromise: Promise<void> | undefined;
  private watcher: FSWatcher | undefined;
  private needsFullRefresh = true;
  private lastFullRefreshAt = 0;
  private firstList = true;

  constructor(
    vaultPath: string,
    private readonly pathFilter: PathFilter,
    private readonly frontmatter: FrontmatterHandler,
  ) {
    this.vaultPath = resolve(vaultPath);
    this.ready = this.refreshAll();
  }

  invalidate(path: string, kind: 'upsert' | 'delete'): void {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return;
    if (kind === 'delete') this.entries.delete(normalized);
    this.dirty.add(normalized);
  }

  async list(): Promise<VaultIndexEntry[]> {
    await this.ready;
    this.startWatcher();
    // The server may have been constructed before Obsidian or a direct
    // filesystem writer created notes. Reconcile once at first use so the
    // initial async refresh cannot produce a false empty result.
    if (this.firstList) {
      this.firstList = false;
      this.needsFullRefresh = true;
    }
    if (this.refreshPromise) await this.refreshPromise;
    if (this.needsFullRefresh || Date.now() - this.lastFullRefreshAt >= FULL_REFRESH_INTERVAL_MS) {
      await this.refreshAll();
    }
    if (this.dirty.size > 0) {
      await this.refreshDirty();
    }
    return [...this.entries.values()];
  }

  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        if (!filename) {
          this.needsFullRefresh = true;
          return;
        }
        const normalized = normalizePath(String(filename));
        if (isNote(normalized) && this.pathFilter.isAllowed(normalized)) this.dirty.add(normalized);
        else this.needsFullRefresh = true;
      });
      this.watcher.on('error', () => {
        this.needsFullRefresh = true;
      });
      this.watcher.unref?.();
    } catch {
      // Some filesystems (notably network mounts) do not support recursive
      // watching. Periodic full refreshes preserve correctness there.
      this.watcher = undefined;
    }
  }

  private async refreshAll(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      this.dirty.clear();
      this.needsFullRefresh = false;
      const next = new Map<string, VaultIndexEntry>();
      const paths = await this.findNotePaths(this.vaultPath);
      for (let start = 0; start < paths.length; start += READ_BATCH_SIZE) {
        const batch = paths.slice(start, start + READ_BATCH_SIZE);
        const metadata = await Promise.all(batch.map(path => this.readEntry(path)));
        for (const entry of metadata) {
          if (entry) next.set(entry.path, entry);
        }
      }
      this.entries.clear();
      for (const [path, entry] of next) this.entries.set(path, entry);
      this.lastFullRefreshAt = Date.now();
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshDirty(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const paths = [...this.dirty];
      this.dirty.clear();
      const metadata = await Promise.all(paths.map(path => this.readEntry(path)));
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index]!;
        const entry = metadata[index];
        if (entry) this.entries.set(path, entry);
        else this.entries.delete(path);
      }
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async readEntry(path: string): Promise<VaultIndexEntry | undefined> {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return undefined;
    try {
      const fullPath = join(this.vaultPath, normalized);
      const [raw, info] = await Promise.all([readFile(fullPath, 'utf8'), stat(fullPath)]);
      if (!info.isFile()) return undefined;
      return {
        path: normalized,
        frontmatter: this.frontmatter.parse(raw).frontmatter,
        revision: revision(raw),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    } catch {
      return undefined;
    }
  }

  private async findNotePaths(directory: string): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return output;
    }
    for (const entry of entries) {
      if (entry.name === '.mcpvault' || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules') continue;
      const fullPath = join(directory, entry.name);
      const relativePath = normalizePath(relative(this.vaultPath, fullPath));
      if (entry.isDirectory()) output.push(...await this.findNotePaths(fullPath));
      else if (entry.isFile() && isNote(relativePath) && this.pathFilter.isAllowed(relativePath)) output.push(relativePath);
    }
    return output;
  }
}
