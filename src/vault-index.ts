import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { FrontmatterHandler } from './frontmatter.js';
import type { PathFilter } from './pathfilter.js';
import type { VaultFileCatalog } from './vault-catalog.js';

const FULL_REFRESH_INTERVAL_MS = 60_000;
const READ_BATCH_SIZE = 32;
const QUERY_CACHE_TTL_MS = 2_000;
const QUERY_CACHE_MAX_ENTRIES = 128;
const QUERY_CACHE_MAX_ROWS = 100_000;
const SORTED_QUERY_CACHE_MAX_ENTRIES = 64;
const SORTED_QUERY_CACHE_MAX_ROWS = 100_000;
const TOP_K_MAX = 1_024;
const METADATA_SNAPSHOT_FILE = '.mcpvault/metadata-index.snapshot.bin';
const METADATA_SNAPSHOT_VERSION = 1;
const METADATA_SNAPSHOT_MAX_ENTRIES = 1_000_000;
const METADATA_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;
const METADATA_SNAPSHOT_SAVE_DEBOUNCE_MS = 1_000;
const METADATA_SNAPSHOT_MAGIC = Buffer.from('MCPVMETA', 'ascii');

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

function compareEntryToCursor(entry: VaultIndexEntry, cursor: { path: string; value?: unknown; missing?: boolean }, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  const entryValue = sortValue(entry, sortBy);
  const entryMissing = entryValue === undefined;
  const cursorMissing = cursor.missing === true;
  if (entryMissing !== cursorMissing) return entryMissing ? 1 : -1;
  const comparison = compareValues(entryValue, cursor.value);
  if (comparison !== 0) return sortOrder === 'asc' ? comparison : -comparison;
  return entry.path.localeCompare(cursor.path);
}

function encodeSnapshotString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function encodeMetadataSnapshot(entries: VaultIndexEntry[]): Buffer {
  const chunks: Buffer[] = [METADATA_SNAPSHOT_MAGIC];
  const header = Buffer.allocUnsafe(8);
  header.writeUInt32LE(METADATA_SNAPSHOT_VERSION, 0);
  header.writeUInt32LE(entries.length, 4);
  chunks.push(header);
  for (const entry of entries) {
    chunks.push(encodeSnapshotString(entry.path), encodeSnapshotString(entry.revision));
    const frontmatter = JSON.stringify(entry.frontmatter);
    if (frontmatter === undefined) throw new Error('frontmatter is not serializable');
    chunks.push(encodeSnapshotString(frontmatter));
    const numbers = Buffer.allocUnsafe(16);
    numbers.writeDoubleLE(entry.size, 0);
    numbers.writeDoubleLE(entry.mtimeMs, 8);
    chunks.push(numbers);
  }
  return Buffer.concat(chunks);
}

function decodeMetadataSnapshot(buffer: Buffer): VaultIndexEntry[] | undefined {
  if (buffer.length < METADATA_SNAPSHOT_MAGIC.length + 8 || !buffer.subarray(0, METADATA_SNAPSHOT_MAGIC.length).equals(METADATA_SNAPSHOT_MAGIC)) return undefined;
  let offset = METADATA_SNAPSHOT_MAGIC.length;
  const version = buffer.readUInt32LE(offset);
  const count = buffer.readUInt32LE(offset + 4);
  offset += 8;
  if (version !== METADATA_SNAPSHOT_VERSION || count > METADATA_SNAPSHOT_MAX_ENTRIES) return undefined;
  const readString = (): string | undefined => {
    if (offset + 4 > buffer.length) return undefined;
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    if (length > buffer.length - offset) return undefined;
    const value = buffer.toString('utf8', offset, offset + length);
    offset += length;
    return value;
  };
  const entries: VaultIndexEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = readString();
    const revisionValue = readString();
    const frontmatterText = readString();
    if (path === undefined || revisionValue === undefined || frontmatterText === undefined || offset + 16 > buffer.length) return undefined;
    let frontmatter: unknown;
    try {
      frontmatter = JSON.parse(frontmatterText);
    } catch {
      return undefined;
    }
    if (!path || !isNote(path) || !frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return undefined;
    const size = buffer.readDoubleLE(offset);
    const mtimeMs = buffer.readDoubleLE(offset + 8);
    offset += 16;
    if (![size, mtimeMs].every(value => Number.isFinite(value))) return undefined;
    entries.push({ path, frontmatter: frontmatter as Record<string, any>, revision: revisionValue, size, mtimeMs });
  }
  return offset === buffer.length ? entries : undefined;
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
  private queryCacheRows = 0;
  private sortedQueryCacheRows = 0;
  private readonly dirty = new Set<string>();
  private readonly snapshotReady: Promise<void>;
  private ready: Promise<void>;
  private refreshPromise: Promise<void> | undefined;
  private snapshotWrite: Promise<void> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotPending = false;
  private watcher: FSWatcher | undefined;
  private watcherStarted = false;
  private readonly catalogUnsubscribe: (() => void) | undefined;
  private needsFullRefresh = true;
  private lastFullRefreshAt = 0;
  private firstList = true;

  constructor(
    vaultPath: string,
    private readonly pathFilter: PathFilter,
    private readonly frontmatter: FrontmatterHandler,
    private readonly catalog?: VaultFileCatalog,
  ) {
    this.vaultPath = resolve(vaultPath);
    this.snapshotReady = this.loadSnapshot();
    this.ready = this.initialize();
    if (catalog) {
      this.catalogUnsubscribe = catalog.subscribe((path, kind) => {
        if (path && kind) this.invalidate(path, kind);
        else {
          this.clearQueryCaches();
          this.needsFullRefresh = true;
        }
      });
    }
  }

  invalidate(path: string, kind: 'upsert' | 'delete'): void {
    const normalized = normalizePath(path);
    if (!isNote(normalized) || !this.pathFilter.isAllowed(normalized)) return;
    this.clearQueryCaches();
    if (kind === 'delete') {
      const existing = this.entries.get(normalized);
      if (existing) this.removeFilterEntry(existing);
      if (existing) this.removePathEntry(existing);
      this.entries.delete(normalized);
    }
    this.dirty.add(normalized);
  }

  private clearQueryCaches(): void {
    this.queryCache.clear();
    this.sortedQueryCache.clear();
    this.queryCacheRows = 0;
    this.sortedQueryCacheRows = 0;
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
    if (cached) {
      this.queryCache.delete(cacheKey);
      this.queryCacheRows -= cached.paths.length;
    }

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
    if (paths.length <= QUERY_CACHE_MAX_ROWS) {
      this.queryCache.set(cacheKey, { expiresAt: Date.now() + QUERY_CACHE_TTL_MS, paths });
      this.queryCacheRows += paths.length;
      while (this.queryCache.size > QUERY_CACHE_MAX_ENTRIES || this.queryCacheRows > QUERY_CACHE_MAX_ROWS) {
        const oldest = this.queryCache.keys().next();
        if (oldest.done) break;
        const removed = this.queryCache.get(oldest.value);
        this.queryCache.delete(oldest.value);
        this.queryCacheRows -= removed?.paths.length || 0;
      }
    }
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
    if (entries.length <= SORTED_QUERY_CACHE_MAX_ROWS) {
      this.sortedQueryCache.set(cacheKey, entries);
      this.sortedQueryCacheRows += entries.length;
      while (this.sortedQueryCache.size > SORTED_QUERY_CACHE_MAX_ENTRIES || this.sortedQueryCacheRows > SORTED_QUERY_CACHE_MAX_ROWS) {
        const oldest = this.sortedQueryCache.keys().next();
        if (oldest.done) break;
        const removed = this.sortedQueryCache.get(oldest.value);
        this.sortedQueryCache.delete(oldest.value);
        this.sortedQueryCacheRows -= removed?.length || 0;
      }
    }
    return entries;
  }

  /**
   * Select a bounded page without materializing a fully sorted candidate list.
   * Exact totals intentionally stay on listSorted/queryNotes' older path;
   * page-only callers only need limit+1 to determine truncation.
   */
  async listSortedPage(params: {
    filters?: Record<string, unknown>;
    pathPrefix?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit: number;
    offset?: number;
    after?: { path: string; value?: unknown; missing?: boolean };
    canAccessPath?: (path: string) => boolean;
  }): Promise<{ entries: VaultIndexEntry[]; truncated: boolean }> {
    const limit = Math.min(Math.max(params.limit, 1), 500);
    const offset = Math.max(params.offset || 0, 0);
    const sortBy = params.sortBy || 'path';
    const sortOrder = params.sortOrder || 'asc';
    const candidates = await this.list(params.filters || {}, params.pathPrefix || '');
    const needed = offset + limit + 1;
    const compare = (a: VaultIndexEntry, b: VaultIndexEntry) => compareEntries(a, b, sortBy, sortOrder);
    if (needed > TOP_K_MAX) {
      const eligible = candidates.filter(entry =>
        this.pathFilter.isAllowed(entry.path)
        && (!params.canAccessPath || params.canAccessPath(entry.path))
        && (!params.after || compareEntryToCursor(entry, params.after, sortBy, sortOrder) > 0));
      const sorted = eligible.sort(compare);
      return { entries: sorted.slice(offset, offset + limit), truncated: sorted.length > offset + limit };
    }

    const heap: VaultIndexEntry[] = [];
    const siftUp = (index: number) => {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compare(heap[parent]!, heap[index]!) >= 0) break;
        [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
        index = parent;
      }
    };
    const siftDown = (index: number) => {
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let worst = index;
        if (left < heap.length && compare(heap[left]!, heap[worst]!) > 0) worst = left;
        if (right < heap.length && compare(heap[right]!, heap[worst]!) > 0) worst = right;
        if (worst === index) break;
        [heap[index], heap[worst]] = [heap[worst]!, heap[index]!];
        index = worst;
      }
    };
    for (const entry of candidates) {
      if (!this.pathFilter.isAllowed(entry.path)
        || (params.canAccessPath && !params.canAccessPath(entry.path))
        || (params.after && compareEntryToCursor(entry, params.after, sortBy, sortOrder) <= 0)) continue;
      if (heap.length < needed) {
        heap.push(entry);
        siftUp(heap.length - 1);
      } else if (compare(entry, heap[0]!) < 0) {
        heap[0] = entry;
        siftDown(0);
      }
    }
    const sorted = heap.sort(compare);
    return { entries: sorted.slice(offset, offset + limit), truncated: heap.length > offset + limit };
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
    this.catalogUnsubscribe?.();
    this.watcher?.close();
    this.watcher = undefined;
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = undefined;
  }

  private startWatcher(): void {
    if (this.catalog) return;
    if (this.watcherStarted) return;
    this.watcherStarted = true;
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        if (!filename) {
          this.clearQueryCaches();
          this.needsFullRefresh = true;
          return;
        }
        const normalized = normalizePath(String(filename));
        this.clearQueryCaches();
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
      const paths = this.catalog ? await this.catalog.listNotePaths() : await this.findNotePaths(this.vaultPath);
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
      this.clearQueryCaches();
      this.lastFullRefreshAt = Date.now();
      this.scheduleSnapshotSave();
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
      this.clearQueryCaches();
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
      this.scheduleSnapshotSave();
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

  private async initialize(): Promise<void> {
    await this.snapshotReady;
    await this.refreshAll();
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const snapshotPath = join(this.vaultPath, METADATA_SNAPSHOT_FILE);
      const info = await stat(snapshotPath);
      if (!info.isFile() || info.size > METADATA_SNAPSHOT_MAX_BYTES) return;
      const parsed = decodeMetadataSnapshot(await readFile(snapshotPath));
      if (!parsed) return;
      for (const entry of parsed) {
        const normalized = normalizePath(entry.path);
        if (normalized && this.pathFilter.isAllowed(normalized)) this.entries.set(normalized, { ...entry, path: normalized });
      }
    } catch {
      // A missing, corrupt, or stale snapshot is harmless; refreshAll rebuilds
      // the metadata read model from Markdown and replaces it atomically.
    }
  }

  private scheduleSnapshotSave(): void {
    this.snapshotPending = true;
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      void this.flushSnapshot();
    }, METADATA_SNAPSHOT_SAVE_DEBOUNCE_MS);
    this.snapshotTimer.unref?.();
  }

  private async flushSnapshot(): Promise<void> {
    if (this.snapshotWrite || !this.snapshotPending) return;
    this.snapshotPending = false;
    let encoded: Buffer;
    try {
      encoded = encodeMetadataSnapshot([...this.entries.values()]);
    } catch {
      return;
    }
    this.snapshotWrite = (async () => {
      const snapshotPath = join(this.vaultPath, METADATA_SNAPSHOT_FILE);
      await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
      const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, encoded);
      await rename(temporaryPath, snapshotPath);
    })().catch(() => {
      // The snapshot is optional acceleration state; Markdown remains authoritative.
    });
    try {
      await this.snapshotWrite;
    } finally {
      this.snapshotWrite = undefined;
      if (this.snapshotPending) this.scheduleSnapshotSave();
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
