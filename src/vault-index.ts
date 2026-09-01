import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';

const FULL_REFRESH_INTERVAL_MS = 60_000;
const READ_BATCH_SIZE = 32;
const QUERY_CACHE_TTL_MS = 2_000;
const QUERY_CACHE_MAX_ENTRIES = 128;
const SORTED_QUERY_CACHE_MAX_ENTRIES = 64;

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

function pathKeys(path: string): string[] {
  const parts = path.split('/');
  const keys = [''];
  for (let index = 1; index <= parts.length; index += 1) keys.push(parts.slice(0, index).join('/'));
  return keys;
}

function revision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isFilterScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}

function encodeFilterValue(value: string | number | boolean | null): string {
  return JSON.stringify(value);
}

function flattenFilterValues(value: unknown, prefix = ''): Array<[string, Array<string | number | boolean | null>]> {
  if (isFilterScalar(value)) return prefix ? [[prefix, [value]]] : [];
  if (Array.isArray(value)) {
    const scalars = value.filter(isFilterScalar);
    return prefix && scalars.length === value.length && scalars.length > 0 ? [[prefix, scalars]] : [];
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => flattenFilterValues(child, prefix ? `${prefix}.${key}` : key));
}

function filterValues(value: unknown): Array<string | number | boolean | null> | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(isFilterScalar)) return undefined;
    return value;
  }
  return isFilterScalar(value) ? [value] : undefined;
}

function sortValue(entry: VaultIndexEntry, sortBy: string): unknown {
  if (sortBy === 'path') return entry.path;
  let current: unknown = entry.frontmatter;
  for (const segment of sortBy.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

function compareEntries(a: VaultIndexEntry, b: VaultIndexEntry, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  const aValue = sortValue(a, sortBy);
  const bValue = sortValue(b, sortBy);
  const aMissing = aValue === undefined;
  const bMissing = bValue === undefined;
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  const comparison = compareValues(aValue, bValue);
  if (comparison !== 0) return sortOrder === 'asc' ? comparison : -comparison;
  return a.path.localeCompare(b.path);
}

/**
 * A disposable, metadata-only read model for repeated structured queries.
 * Markdown remains authoritative; this index only avoids reopening and
 * reparsing every note for every pulse/community query.
 */
export class VaultMetadataIndex {
  private readonly vaultPath: string;
  private readonly entries = new Map<string, VaultIndexEntry>();
  private readonly filterIndex = new Map<string, Map<string, Set<string>>>();
  private readonly pathIndex = new Map<string, Set<string>>();
  private readonly queryCache = new Map<string, { expiresAt: number; paths: string[] }>();
  private readonly sortedQueryCache = new Map<string, VaultIndexEntry[]>();
  private readonly dirty = new Set<string>();
  private ready: Promise<void>;
  private refreshPromise: Promise<void> | undefined;
  private watcher: FSWatcher | undefined;
  private watcherStarted = false;
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
    this.queryCache.clear();
    this.sortedQueryCache.clear();
    if (kind === 'delete') {
      const existing = this.entries.get(normalized);
      if (existing) this.removeFilterEntry(existing);
      if (existing) this.removePathEntry(existing);
      this.entries.delete(normalized);
    }
    this.dirty.add(normalized);
  }

  async list(filters?: Record<string, unknown>, pathPrefix = ''): Promise<VaultIndexEntry[]> {
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
    const hasFilters = Boolean(filters && Object.keys(filters).length > 0);
    const normalizedPrefix = normalizePath(pathPrefix);
    if (!hasFilters && !normalizedPrefix) return [...this.entries.values()];
    const cacheKey = JSON.stringify([normalizedPrefix, filters || {}]);
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.queryCache.delete(cacheKey);
      this.queryCache.set(cacheKey, cached);
      return cached.paths.map(path => this.entries.get(path)).filter((entry): entry is VaultIndexEntry => entry !== undefined);
    }
    if (cached) this.queryCache.delete(cacheKey);

    const filterCandidates = hasFilters ? this.filterCandidates(filters!) : undefined;
    const prefixCandidates = normalizedPrefix ? this.pathIndex.get(normalizedPrefix) : undefined;
    let candidates: Set<string> | undefined;
    if (filterCandidates && prefixCandidates) {
      candidates = new Set(filterCandidates);
      for (const path of candidates) if (!prefixCandidates.has(path)) candidates.delete(path);
    } else {
      candidates = filterCandidates || prefixCandidates;
    }
    if (!candidates) return [...this.entries.values()];
    const paths = [...candidates];
    this.queryCache.set(cacheKey, { expiresAt: Date.now() + QUERY_CACHE_TTL_MS, paths });
    while (this.queryCache.size > QUERY_CACHE_MAX_ENTRIES) this.queryCache.delete(this.queryCache.keys().next().value!);
    return paths.map(path => this.entries.get(path)).filter((entry): entry is VaultIndexEntry => entry !== undefined);
  }

  async listSorted(filters: Record<string, unknown> = {}, pathPrefix = '', sortBy = 'path', sortOrder: 'asc' | 'desc' = 'asc'): Promise<VaultIndexEntry[]> {
    const cacheKey = JSON.stringify([pathPrefix, filters, sortBy, sortOrder]);
    const cached = this.sortedQueryCache.get(cacheKey);
    if (cached) {
      this.sortedQueryCache.delete(cacheKey);
      this.sortedQueryCache.set(cacheKey, cached);
      return cached;
    }
    const entries = [...await this.list(filters, pathPrefix)].sort((a, b) => compareEntries(a, b, sortBy, sortOrder));
    this.sortedQueryCache.set(cacheKey, entries);
    while (this.sortedQueryCache.size > SORTED_QUERY_CACHE_MAX_ENTRIES) this.sortedQueryCache.delete(this.sortedQueryCache.keys().next().value!);
    return entries;
  }

  /**
   * Check a previously returned revision without reopening the note body.
   * The stat check keeps the answer fresh even when a filesystem watcher is
   * unavailable; a later full refresh repairs metadata and hash state.
   */
  async matchesRevision(path: string, expectedRevision: string): Promise<boolean> {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return false;
    await this.list();
    const entry = this.entries.get(normalized);
    if (!entry || entry.revision !== expectedRevision) return false;
    try {
      const info = await stat(join(this.vaultPath, normalized));
      if (!info.isFile() || info.size !== entry.size || info.mtimeMs !== entry.mtimeMs) {
        this.dirty.add(normalized);
        return false;
      }
      return true;
    } catch {
      this.dirty.add(normalized);
      return false;
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private startWatcher(): void {
    if (this.watcherStarted) return;
    this.watcherStarted = true;
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        if (!filename) {
          this.queryCache.clear();
          this.sortedQueryCache.clear();
          this.needsFullRefresh = true;
          return;
        }
        const normalized = normalizePath(String(filename));
        this.queryCache.clear();
        this.sortedQueryCache.clear();
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
        const metadata = await Promise.all(batch.map(path => this.readEntry(path, this.entries.get(path))));
        for (const entry of metadata) {
          if (entry) next.set(entry.path, entry);
        }
      }
      this.entries.clear();
      for (const [path, entry] of next) this.entries.set(path, entry);
      this.rebuildFilterIndex();
      this.rebuildPathIndex();
      this.queryCache.clear();
      this.sortedQueryCache.clear();
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
      this.queryCache.clear();
      this.sortedQueryCache.clear();
      const metadata = await Promise.all(paths.map(path => this.readEntry(path)));
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index]!;
        const entry = metadata[index];
        const previous = this.entries.get(path);
        if (previous) this.removeFilterEntry(previous);
        if (previous) this.removePathEntry(previous);
        if (entry) this.entries.set(path, entry);
        else this.entries.delete(path);
        if (entry) this.addFilterEntry(entry);
        if (entry) this.addPathEntry(entry);
      }
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async readEntry(path: string, existing?: VaultIndexEntry): Promise<VaultIndexEntry | undefined> {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return undefined;
    try {
      const fullPath = join(this.vaultPath, normalized);
      const info = await stat(fullPath);
      if (!info.isFile()) return undefined;
      // Full reconciliation is intentionally stat-only for unchanged notes.
      // This keeps repeated pulse/community reads from reopening and reparsing
      // the whole vault while preserving the existing metadata object.
      if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs) return existing;
      const raw = await readFile(fullPath, 'utf8');
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

  private rebuildFilterIndex(): void {
    this.filterIndex.clear();
    for (const entry of this.entries.values()) this.addFilterEntry(entry);
  }

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const entry of this.entries.values()) this.addPathEntry(entry);
  }

  private addPathEntry(entry: VaultIndexEntry): void {
    for (const key of pathKeys(entry.path)) {
      let paths = this.pathIndex.get(key);
      if (!paths) {
        paths = new Set<string>();
        this.pathIndex.set(key, paths);
      }
      paths.add(entry.path);
    }
  }

  private removePathEntry(entry: VaultIndexEntry): void {
    for (const key of pathKeys(entry.path)) {
      const paths = this.pathIndex.get(key);
      paths?.delete(entry.path);
      if (paths && paths.size === 0) this.pathIndex.delete(key);
    }
  }

  private addFilterEntry(entry: VaultIndexEntry): void {
    for (const [key, values] of flattenFilterValues(entry.frontmatter)) {
      for (const value of values) {
        const encoded = encodeFilterValue(value);
        let valueIndex = this.filterIndex.get(key);
        if (!valueIndex) {
          valueIndex = new Map<string, Set<string>>();
          this.filterIndex.set(key, valueIndex);
        }
        let paths = valueIndex.get(encoded);
        if (!paths) {
          paths = new Set<string>();
          valueIndex.set(encoded, paths);
        }
        paths.add(entry.path);
      }
    }
  }

  private removeFilterEntry(entry: VaultIndexEntry): void {
    for (const [key, values] of flattenFilterValues(entry.frontmatter)) {
      const valueIndex = this.filterIndex.get(key);
      if (!valueIndex) continue;
      for (const value of values) {
        const encoded = encodeFilterValue(value);
        const paths = valueIndex.get(encoded);
        paths?.delete(entry.path);
        if (paths && paths.size === 0) valueIndex.delete(encoded);
      }
      if (valueIndex.size === 0) this.filterIndex.delete(key);
    }
  }

  private filterCandidates(filters: Record<string, unknown>): Set<string> | undefined {
    let candidates: Set<string> | undefined;
    for (const [key, expected] of Object.entries(filters)) {
      const expectedValues = filterValues(expected);
      if (expectedValues === undefined) return undefined;
      const valueIndex = this.filterIndex.get(key);
      const matching = new Set<string>();
      for (const value of expectedValues) {
        for (const path of valueIndex?.get(encodeFilterValue(value)) || []) matching.add(path);
      }
      // An array filter means every requested value must be present in the
      // note's array, so intersect its per-value posting sets rather than
      // unioning them.
      if (Array.isArray(expected)) {
        const required = expectedValues.map(value => valueIndex?.get(encodeFilterValue(value)) || new Set<string>());
        const intersection = new Set(required[0] || []);
        for (const paths of required.slice(1)) {
          for (const path of intersection) if (!paths.has(path)) intersection.delete(path);
        }
        if (candidates) {
          for (const path of candidates) if (!intersection.has(path)) candidates.delete(path);
        } else {
          candidates = intersection;
        }
      } else if (candidates) {
        for (const path of candidates) if (!matching.has(path)) candidates.delete(path);
      } else {
        candidates = matching;
      }
      if (candidates && candidates.size === 0) return candidates;
    }
    return candidates || new Set<string>();
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
