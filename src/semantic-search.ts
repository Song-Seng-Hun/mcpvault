import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { PathFilter } from './pathfilter.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import type { SearchParams, SearchResult } from './types.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { generateObsidianUri } from './uri.js';
import { VaultIoCoordinator } from './vault-io.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const EMBEDDING_DIMENSIONS = 384;
const INDEX_DIR = '.mcpvault/semantic-index';
const MANIFEST_FILE = 'manifest.snapshot.gz';
const LEGACY_MANIFEST_FILE = 'manifest.json';
const PENDING_FILE = 'pending.snapshot.gz';
const WORKER_LOCK_FILE = 'worker.lock';
const MAX_CHUNK_CHARS = 1200;
const MAX_CHUNKS_PER_NOTE = 64;
const MAX_EXCERPT_CHARS = 600;
const IDLE_DELAY_MS = 15_000;
const UNAVAILABLE_RETRY_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 30_000;
const MAX_PENDING_CHANGES = 5_000;
const EMBED_BATCH_SIZE = 8;
const SEMANTIC_QUERY_CACHE_TTL_MS = 5_000;
const SEMANTIC_QUERY_CACHE_MAX_ENTRIES = 64;
const SEMANTIC_VECTOR_CACHE_TTL_MS = 60_000;
const SEMANTIC_VECTOR_CACHE_MAX_ENTRIES = 32;
const TABLE_CACHE_MAX_ENTRIES = 32;
const FALLBACK_SCAN_BATCH_SIZE = 8;
const PENDING_SNAPSHOT_DEBOUNCE_MS = 1_000;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type ChangeKind = 'upsert' | 'delete';
type PendingChange = { kind: ChangeKind; attempt?: number; retryAt?: number };

interface ManifestEntry {
  hash: string;
  scope: string;
  size?: number;
  mtimeMs?: number;
}

interface IndexRow {
  id: string;
  vector: number[];
  path: string;
  hash: string;
  title: string;
  line: number;
  wiki: boolean;
  updatedAt: string;
}

interface SemanticChunk {
  id: string;
  text: string;
  line: number;
}

interface PreparedIndex {
  path: string;
  scope: string;
  contentHash: string;
  size: number;
  mtimeMs: number;
  rows: IndexRow[];
}

interface IndexBatchGroup {
  paths: Set<string>;
  rows: IndexRow[];
}

interface SemanticSearchParams extends SearchParams {
  principal?: ScopePrincipal | undefined;
}

export interface SemanticSearchOutcome {
  results: SearchResult[];
  available: boolean;
  indexed: number;
  pending: number;
  error?: string | undefined;
}

export interface SemanticIndexStatus {
  enabled: true;
  model: string;
  available: boolean;
  indexed: number;
  pending: number;
  worker: 'process-shared';
  indexWorker: 'leader' | 'standby';
  indexingActive: boolean;
  lastError?: string | undefined;
}

type LanceDb = {
  connect(uri: string): Promise<any>;
};

type Embedder = ((text: string | string[], options?: { pooling?: 'mean'; normalize?: boolean }) => Promise<{ tolist(): unknown }>) & {
  dispose?: () => void | Promise<void>;
};

interface SharedEmbedderEntry {
  embedder: Embedder | undefined;
  loading: Promise<Embedder> | undefined;
  users: number;
  disposeTimer: ReturnType<typeof setTimeout> | undefined;
}

interface SharedEmbedderLease {
  embedder: Embedder;
  release: () => void;
}

// One model per Node process, regardless of how many vault/server instances or
// agent sessions share that process.
const EMBEDDER_POOL = new Map<string, SharedEmbedderEntry>();

async function acquireSharedEmbedder(): Promise<SharedEmbedderLease> {
  let entry = EMBEDDER_POOL.get(MODEL_ID);
  if (!entry) {
    entry = { embedder: undefined, loading: undefined, users: 0, disposeTimer: undefined };
    EMBEDDER_POOL.set(MODEL_ID, entry);
  }
  if (entry.disposeTimer) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = undefined;
  }
  if (!entry.embedder) {
    if (!entry.loading) {
      entry.loading = (async () => {
        const module = await import('@huggingface/transformers');
        const pipeline = module.pipeline as unknown as (task: string, model: string, options?: Record<string, unknown>) => Promise<Embedder>;
        return pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
      })().then(embedder => {
        entry!.embedder = embedder;
        return embedder;
      }).catch(error => {
        if (EMBEDDER_POOL.get(MODEL_ID) === entry) EMBEDDER_POOL.delete(MODEL_ID);
        throw error;
      });
    }
    await entry.loading;
  }
  const embedder = entry.embedder;
  if (!embedder) throw new Error('Embedding model did not initialize');
  entry.users += 1;
  return {
    embedder,
    release: () => {
      if (entry!.users > 0) entry!.users -= 1;
      if (entry!.users !== 0 || entry!.disposeTimer) return;
      entry!.disposeTimer = setTimeout(() => {
        entry!.disposeTimer = undefined;
        if (entry!.users !== 0 || !entry!.embedder) return;
        const current = entry!.embedder;
        entry!.embedder = undefined;
        entry!.loading = undefined;
        if (EMBEDDER_POOL.get(MODEL_ID) === entry) EMBEDDER_POOL.delete(MODEL_ID);
        void Promise.resolve(current.dispose?.()).catch(() => undefined);
      }, IDLE_DELAY_MS * 4);
      entry!.disposeTimer.unref?.();
    },
  };
}

function normalizePath(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function scopeForPath(path: string): string {
  const normalized = normalizePath(path).toLowerCase();
  const model = /^_scopes\/models\/([^/]+)(?:\/|$)/.exec(normalized);
  if (model) return `model:${model[1]}`;
  const agent = /^_scopes\/agents\/([^/]+)(?:\/|$)/.exec(normalized);
  if (agent) return `agent:${agent[1]}`;
  return 'global';
}

function tableName(scope: string): string {
  return `chunks_${scope.replace(/[^a-z0-9_-]/g, '_')}`;
}

function isWikiPath(path: string, content: string): boolean {
  const normalized = path.toLowerCase();
  if (normalized === '_wiki' || normalized.startsWith('_wiki/') || normalized === '_sources' || normalized.startsWith('_sources/')) return true;
  if (/^_scopes\/(models|agents)\/[^/]+\/(?:_wiki|_sources)(?:\/|$)/.test(normalized)) return true;
  return /^---\r?\n[\s\S]*?\r?\nllm_wiki_type\s*:/im.test(content);
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function compactExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > MAX_EXCERPT_CHARS ? `${compact.slice(0, MAX_EXCERPT_CHARS - 1)}…` : compact;
}

function chunkNote(path: string, content: string): SemanticChunk[] {
  const body = stripFrontmatter(content);
  const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
  const source = `${title}\n${body}`.trim();
  if (!source) return [];

  const chunks: SemanticChunk[] = [];
  let offset = 0;
  for (const paragraph of source.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      offset += paragraph.length + 2;
      continue;
    }
    for (let start = 0; start < trimmed.length && chunks.length < MAX_CHUNKS_PER_NOTE; start += MAX_CHUNK_CHARS) {
      const text = trimmed.slice(start, start + MAX_CHUNK_CHARS);
      const id = `${path}#${chunks.length}`;
      chunks.push({
        id,
        text,
        line: source.slice(0, offset + start).split('\n').length,
      });
    }
    offset += paragraph.length + 2;
  }
  return chunks;
}

async function resultFromRow(row: IndexRow, vaultPath: string, includeRevision: boolean, vaultIo?: VaultIoCoordinator): Promise<SearchResult> {
  let excerpt = '';
  try {
    const content = stripFrontmatter(await (vaultIo ? vaultIo.readUtf8(join(vaultPath, row.path)) : readFile(join(vaultPath, row.path), 'utf8')));
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, row.line - 2);
    excerpt = compactExcerpt(lines.slice(start, start + 3).join(' '));
  } catch {
    // The source may have been removed between vector query and response.
  }
  return {
    p: row.path,
    t: row.title,
    ex: excerpt,
    mc: 0,
    ln: row.line,
    uri: generateObsidianUri(vaultPath, row.path),
    ...(row.wiki && { wk: true as const }),
    vs: true,
    ...(includeRevision && { rv: row.hash }),
  };
}

/**
 * Optional semantic search cache. It is deliberately a cache, not a second
 * source of truth: Markdown and Git remain authoritative. All failures are
 * contained here so lexical search and the MCP server keep working.
 */
export class SemanticSearchService {
  private readonly vaultPath: string;
  private readonly queryCacheOwner = createDerivedCacheOwner('semantic.results');
  private readonly vectorCacheOwner = createDerivedCacheOwner('semantic.vectors');
  private readonly queryCache = new Map<string, { expiresAt: number; generation: number; results: SearchResult[] }>();
  private readonly vectorCache = new Map<string, { expiresAt: number; vector: number[] }>();
  private readonly vectorInFlight = new Map<string, Promise<number[]>>();
  private queryGeneration = 0;
  private readonly indexPath: string;
  private readonly manifestPath: string;
  private readonly workerLockPath: string;
  private manifest: Record<string, ManifestEntry> = {};
  private manifestReady: Promise<void>;
  private pendingReady: Promise<void>;
  private db: any;
  private readonly tableCache = new Map<string, any>();
  private readonly tableLastUsed = new Map<string, number>();
  private readonly tableOpening = new Map<string, Promise<any>>();
  private embedder: Embedder | undefined;
  private embedderLease: SharedEmbedderLease | undefined;
  private pending = new Map<string, PendingChange>();
  private pendingSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSnapshotWrite: Promise<void> | undefined;
  private pendingSnapshotPending = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private unloadTimer: ReturnType<typeof setTimeout> | undefined;
  private syncPromise: Promise<void> | undefined;
  private scanPromise: Promise<void> | undefined;
  private dbPromise: Promise<any> | undefined;
  private semanticActive = false;
  private indexLease: FileHandle | undefined;
  private indexWorker: 'leader' | 'standby' = 'standby';
  private lastScanAt = 0;
  private tableNamesCache: Set<string> | undefined;
  private tableNamesCachedAt = 0;
  private unavailableUntil = 0;
  private lastError: string | undefined;
  private readonly catalogUnsubscribe: (() => void) | undefined;

  constructor(
    vaultPath: string,
    private readonly pathFilter: PathFilter,
    private readonly accessPolicy = new ScopeAccessPolicy(),
    private readonly catalog?: VaultFileCatalog,
    private readonly vaultIo = new VaultIoCoordinator(),
  ) {
    this.vaultPath = resolve(vaultPath);
    this.indexPath = join(this.vaultPath, INDEX_DIR);
    this.manifestPath = join(this.indexPath, MANIFEST_FILE);
    this.workerLockPath = join(this.indexPath, WORKER_LOCK_FILE);
    this.manifestReady = this.loadManifest();
    this.pendingReady = this.loadPendingSnapshot();
    if (catalog) {
      this.catalogUnsubscribe = catalog.subscribe((path, kind) => {
        if (path && kind) this.notifyChange(path, kind);
        else {
          this.lastScanAt = 0;
          this.queryGeneration += 1;
          this.clearQueryCache();
          if (this.semanticActive) this.scheduleIdleWork();
        }
      });
    }
  }

  notifyChange(path: string, kind: ChangeKind): void {
    const normalized = normalizePath(path);
    if (!isMarkdown(normalized) || !this.pathFilter.isAllowed(normalized)) return;
    this.queryGeneration += 1;
    this.clearQueryCache();
    if (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized)) {
      this.pending.set(normalized, { kind });
      this.queuePendingSnapshotSave();
    }
    if (this.semanticActive) this.scheduleIdleWork();
  }

  close(): void {
    this.catalogUnsubscribe?.();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    if (this.pendingSnapshotTimer) clearTimeout(this.pendingSnapshotTimer);
    this.idleTimer = undefined;
    this.unloadTimer = undefined;
    this.pendingSnapshotTimer = undefined;
    // Do not start a new asynchronous write during shutdown. The queue is
    // disposable and scanForChanges reconstructs it after a restart; avoiding
    // a late write also lets callers safely remove a temporary test vault.
    this.pendingSnapshotPending = false;
    this.clearQueryCache();
    this.clearVectorCache();
    this.vectorInFlight.clear();
    this.tableCache.clear();
    this.tableLastUsed.clear();
    this.tableOpening.clear();
  }

  private clearQueryCache(): void {
    this.queryCache.clear();
    derivedCacheBudget.clearOwner(this.queryCacheOwner);
  }

  private clearVectorCache(): void {
    this.vectorCache.clear();
    derivedCacheBudget.clearOwner(this.vectorCacheOwner);
  }

  async search(params: SemanticSearchParams): Promise<SemanticSearchOutcome> {
    const limit = normalizeSearchLimit(params.limit);
    const maxChars = normalizeSearchMaxChars(params.maxChars);
    if (!params.query?.trim()) throw new Error('Search query cannot be empty');
    const cacheKey = JSON.stringify({
      query: params.query.trim(),
      limit,
      maxChars,
      includeRevision: params.includeRevisions === true,
      pathPrefix: params.pathPrefix || '',
      excludePaths: params.excludePaths || [],
      principal: params.principal ? {
        accountId: params.principal.accountId,
        modelId: params.principal.modelId,
        agentId: params.principal.agentId,
        role: params.principal.role,
      } : null,
    });
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.generation === this.queryGeneration && cached.expiresAt > Date.now()) {
      this.queryCache.delete(cacheKey);
      this.queryCache.set(cacheKey, cached);
      derivedCacheBudget.touch(this.queryCacheOwner, cacheKey);
      return {
        results: cached.results.map(result => ({ ...result })),
        available: true,
        indexed: this.indexedCount(),
        pending: this.pending.size,
      };
    }
    if (cached) {
      this.queryCache.delete(cacheKey);
      derivedCacheBudget.remove(this.queryCacheOwner, cacheKey);
    }
    if (Date.now() < this.unavailableUntil) {
      return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: this.lastError };
    }

    try {
      await this.manifestReady;
      // The first server process owns background indexing. Other server
      // processes may still perform bounded foreground queries against the
      // shared derived index, but never start a second indexing worker.
      if (await this.acquireIndexLease()) {
        this.semanticActive = true;
        this.scheduleIdleWork();
      }
      // Semantic search must not turn a user query into a full-vault indexing
      // job. The bounded idle worker discovers and indexes changes separately;
      // this request only queries the currently available derived cache.
      const names = await this.getTableNames();
      if (names.size === 0) {
        return { results: [], available: true, indexed: this.indexedCount(), pending: this.pending.size };
      }
      const vector = await this.embedQuery(params.query.trim());
      const scopes = this.accessPolicy.scopeRoots(params.principal).map(root => root.kind === 'global' ? 'global' : `${root.kind}:${root.root.split('/').pop()}`);
      const bestByPath = new Map<string, { row: IndexRow; distance: number }>();
      for (const scope of scopes) {
        const name = tableName(scope);
        if (!names.has(name)) continue;
        const table = await this.getTable(name);
        const rows = await table.vectorSearch(vector).distanceType('cosine').limit(limit * 2).toArray();
        for (const row of rows as Array<IndexRow & { _distance?: number }>) {
          const path = normalizePath(row.path);
          if (!this.pathIsVisible(path, params)) continue;
          const distance = Number(row._distance ?? 1);
          const old = bestByPath.get(path);
          if (!old || distance < old.distance) bestByPath.set(path, { row, distance });
        }
      }

      const ordered = [...bestByPath.values()]
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map(item => item.row);
      const results = boundSearchResults(
        await Promise.all(ordered.map(row => resultFromRow(row, this.vaultPath, params.includeRevisions === true, this.vaultIo))),
        maxChars,
      );
      this.queryCache.set(cacheKey, {
        expiresAt: Date.now() + SEMANTIC_QUERY_CACHE_TTL_MS,
        generation: this.queryGeneration,
        results: results.map(result => ({ ...result })),
      });
      derivedCacheBudget.register(
        this.queryCacheOwner,
        cacheKey,
        estimateCacheBytes(results) + Buffer.byteLength(cacheKey, 'utf8') + 128,
        () => this.queryCache.delete(cacheKey),
      );
      while (this.queryCache.size > SEMANTIC_QUERY_CACHE_MAX_ENTRIES) {
        const oldest = this.queryCache.keys().next();
        if (oldest.done) break;
        this.queryCache.delete(oldest.value);
        derivedCacheBudget.remove(this.queryCacheOwner, oldest.value);
      }
      return {
        results,
        available: true,
        indexed: this.indexedCount(),
        pending: this.pending.size,
      };
    } catch (error) {
      this.markUnavailable(error);
      return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: this.lastError };
    }
  }

  status(): SemanticIndexStatus {
    return {
      enabled: true,
      model: MODEL_ID,
      available: Date.now() >= this.unavailableUntil,
      indexed: this.indexedCount(),
      pending: this.pending.size,
      worker: 'process-shared',
      indexWorker: this.indexWorker,
      indexingActive: this.semanticActive,
      ...(this.lastError && { lastError: this.lastError }),
    };
  }

  private indexedCount(): number {
    return Object.keys(this.manifest).length;
  }

  private async loadManifest(): Promise<void> {
    try {
      const compressed = await readFile(this.manifestPath);
      const raw = await gunzipAsync(compressed);
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (parsed && typeof parsed === 'object') this.manifest = parsed as Record<string, ManifestEntry>;
    } catch {
      try {
        // Read manifests written by older releases once; the next successful
        // index update stores the compact binary form.
        const raw = await readFile(join(this.indexPath, LEGACY_MANIFEST_FILE), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.manifest = parsed as Record<string, ManifestEntry>;
      } catch {
        this.manifest = {};
      }
    }
  }

  private async saveManifest(): Promise<void> {
    await mkdir(this.indexPath, { recursive: true });
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(this.manifest), 'utf8'));
    const temporaryPath = `${this.manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, compressed);
    await rename(temporaryPath, this.manifestPath);
  }

  private async loadPendingSnapshot(): Promise<void> {
    try {
      const raw = await gunzipAsync(await readFile(join(this.indexPath, PENDING_FILE)));
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed.slice(0, MAX_PENDING_CHANGES)) {
        if (!item || typeof item !== 'object') continue;
        const value = item as Record<string, unknown>;
        const path = normalizePath(String(value.path || ''));
        const kind = value.kind === 'delete' ? 'delete' : value.kind === 'upsert' ? 'upsert' : undefined;
        if (!kind || !isMarkdown(path) || !this.pathFilter.isAllowed(path) || this.pending.has(path)) continue;
        const attempt = Number.isInteger(value.attempt) ? Math.min(Math.max(Number(value.attempt), 0), 8) : 0;
        const retryAt = Number.isFinite(Number(value.retryAt)) ? Number(value.retryAt) : undefined;
        this.pending.set(path, { kind, ...(attempt > 0 && { attempt }), ...(retryAt && { retryAt }) });
      }
    } catch {
      // A missing or corrupt work queue is harmless; scanForChanges rebuilds it.
    }
  }

  private queuePendingSnapshotSave(): void {
    this.pendingSnapshotPending = true;
    if (this.pendingSnapshotTimer) return;
    this.pendingSnapshotTimer = setTimeout(() => {
      this.pendingSnapshotTimer = undefined;
      void this.flushPendingSnapshot();
    }, PENDING_SNAPSHOT_DEBOUNCE_MS);
    this.pendingSnapshotTimer.unref?.();
  }

  private async flushPendingSnapshot(): Promise<void> {
    if (this.pendingSnapshotWrite || !this.pendingSnapshotPending) return;
    this.pendingSnapshotPending = false;
    const entries = [...this.pending.entries()].slice(0, MAX_PENDING_CHANGES).map(([path, change]) => ({ path, ...change }));
    this.pendingSnapshotWrite = (async () => {
      await mkdir(this.indexPath, { recursive: true });
      const path = join(this.indexPath, PENDING_FILE);
      const temporaryPath = `${path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, await gzipAsync(Buffer.from(JSON.stringify(entries), 'utf8')));
      await rename(temporaryPath, path);
    })().catch(() => {
      // The queue is disposable; a later catalog scan can reconstruct it.
    });
    try {
      await this.pendingSnapshotWrite;
    } finally {
      this.pendingSnapshotWrite = undefined;
      if (this.pendingSnapshotPending) this.queuePendingSnapshotSave();
    }
  }

  private scheduleIdleWork(): void {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.runIdleWork();
    }, IDLE_DELAY_MS);
    this.idleTimer.unref?.();
  }

  private async runIdleWork(): Promise<void> {
    if (!this.semanticActive) return;
    if (!this.indexLease && !await this.acquireIndexLease()) return;
    try {
      await this.manifestReady;
      await this.pendingReady;
      await this.scanForChanges();
      await this.drain(4);
    } catch (error) {
      this.markUnavailable(error);
    } finally {
      if (this.pending.size > 0) this.scheduleIdleWork();
    }
  }

  private async scanForChanges(): Promise<void> {
    if (this.scanPromise) return this.scanPromise;
    if (Date.now() - this.lastScanAt < SCAN_INTERVAL_MS) return;
    this.scanPromise = (async () => {
      const seen = new Set<string>();
      let manifestChanged = false;
      const paths = this.catalog
        ? (await this.catalog.notePathsSnapshot()).filter(path => isMarkdown(path))
        : await this.findMarkdownFiles(this.vaultPath);
      for (const path of paths) {
        const normalized = normalizePath(path);
        seen.add(normalized);
        if (!this.pathFilter.isAllowed(normalized)) continue;
        const fullPath = join(this.vaultPath, normalized);
        const info = await stat(fullPath).catch(() => undefined);
        if (!info?.isFile()) continue;
        const entry = this.manifest[normalized];
        if (entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs) continue;
        const content = await this.vaultIo.readUtf8(fullPath, 'background').catch(() => undefined);
        if (content === undefined) continue;
        const hash = hashContent(content);
        if ((!entry || entry.hash !== hash) && (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized))) {
          // Preserve an in-flight retry's backoff. Re-scanning the catalog must
          // not turn one failing note into a hot loop by resetting its attempt.
          if (!this.pending.has(normalized)) this.pending.set(normalized, { kind: 'upsert' });
        } else if (entry) {
          // Timestamp-only changes do not require a new embedding. Persist the
          // refreshed metadata so future scans stay stat-only.
          this.manifest[normalized] = { ...entry, size: info.size, mtimeMs: info.mtimeMs };
          manifestChanged = true;
        }
      }
      for (const path of Object.keys(this.manifest)) {
        if (!seen.has(path) && (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(path)) && !this.pending.has(path)) {
          this.pending.set(path, { kind: 'delete' });
        }
      }
      if (manifestChanged && this.pending.size === 0) await this.saveManifest();
      this.lastScanAt = Date.now();
    })();
    try {
      await this.scanPromise;
    } finally {
      this.scanPromise = undefined;
    }
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return output;
    }
    const directories: string[] = [];
    for (const entry of entries) {
      if (entry.name === '.mcpvault' || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) directories.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(full.slice(this.vaultPath.length + 1));
    }
    for (let start = 0; start < directories.length; start += FALLBACK_SCAN_BATCH_SIZE) {
      const batch = directories.slice(start, start + FALLBACK_SCAN_BATCH_SIZE);
      const nested = await Promise.all(batch.map(directory => this.findMarkdownFiles(directory)));
      for (const paths of nested) output.push(...paths);
    }
    return output;
  }

  private async drain(maxFiles: number): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      const batch: Array<[string, PendingChange]> = [];
      const now = Date.now();
      while (this.pending.size > 0 && batch.length < maxFiles) {
        const first = [...this.pending.entries()].find(([, change]) => !change.retryAt || change.retryAt <= now) as [string, PendingChange] | undefined;
        if (!first) break;
        this.pending.delete(first[0]);
        batch.push(first);
      }
      if (batch.length === 0) return;
      this.queuePendingSnapshotSave();
      try {
        const prepared: PreparedIndex[] = [];
        const deleted: string[] = [];
        for (const [path, change] of batch) {
          if (change.kind === 'delete') deleted.push(path);
          else prepared.push(await this.prepareIndex(path));
        }
        await this.applyIndexBatch(prepared, deleted);
        await this.saveManifest();
        this.queuePendingSnapshotSave();
        this.lastError = undefined;
      } catch (error) {
        for (const [path, change] of batch) {
          // A watcher may have queued a newer change while this batch was
          // preparing or writing. Preserve that newer event for the retry.
          if (!this.pending.has(path)) {
            const attempt = Math.min((change.attempt || 0) + 1, 8);
            const retryDelay = Math.min(UNAVAILABLE_RETRY_MS, 1_000 * 2 ** (attempt - 1));
            this.pending.set(path, { kind: change.kind, attempt, retryAt: Date.now() + retryDelay });
          }
        }
        this.queuePendingSnapshotSave();
        throw error;
      }
    })();
    try {
      await this.syncPromise;
    } finally {
      this.syncPromise = undefined;
    }
  }

  private async getDb(): Promise<any> {
    if (this.db) return this.db;
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const module = await import('@lancedb/lancedb') as unknown as LanceDb;
        await mkdir(this.indexPath, { recursive: true });
        this.db = await module.connect(this.indexPath);
        return this.db;
      })();
    }
    try {
      return await this.dbPromise;
    } finally {
      this.dbPromise = undefined;
    }
  }

  private async getTable(name: string): Promise<any> {
    const cached = this.tableCache.get(name);
    if (cached) {
      this.tableLastUsed.delete(name);
      this.tableLastUsed.set(name, Date.now());
      return cached;
    }
    const opening = this.tableOpening.get(name);
    if (opening) return opening;
    const promise = this.getDb().then(db => db.openTable(name));
    this.tableOpening.set(name, promise);
    try {
      const table = await promise;
      this.tableCache.set(name, table);
      this.tableLastUsed.set(name, Date.now());
      while (this.tableCache.size > TABLE_CACHE_MAX_ENTRIES) {
        const oldest = this.tableLastUsed.keys().next();
        if (oldest.done) break;
        this.tableLastUsed.delete(oldest.value);
        this.tableCache.delete(oldest.value);
      }
      return table;
    } finally {
      if (this.tableOpening.get(name) === promise) this.tableOpening.delete(name);
    }
  }

  /**
   * Coordinate document indexing across separately spawned MCP processes.
   * The first process that opts into server-side semantic search becomes the
   * leader. Other processes can query the shared derived cache, but never
   * start a second indexing worker.
   */
  private async acquireIndexLease(): Promise<boolean> {
    if (this.indexLease) return true;
    await mkdir(this.indexPath, { recursive: true });
    const createLease = async (): Promise<boolean> => {
      try {
        const handle = await open(this.workerLockPath, 'wx');
        await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
        this.indexLease = handle;
        this.indexWorker = 'leader';
        return true;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
        return false;
      }
    };
    if (await createLease()) return true;
    const owner = await readFile(this.workerLockPath, 'utf8').catch(() => '');
    const pid = Number(/\"pid\"\s*:\s*(\d+)/.exec(owner)?.[1] || 0);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      this.indexWorker = 'standby';
      return false;
    }
    await unlink(this.workerLockPath).catch(() => undefined);
    const acquired = await createLease();
    if (!acquired) this.indexWorker = 'standby';
    return acquired;
  }

  private async getTableNames(): Promise<Set<string>> {
    if (this.tableNamesCache && Date.now() - this.tableNamesCachedAt < SCAN_INTERVAL_MS) return this.tableNamesCache;
    const db = await this.getDb();
    this.tableNamesCache = new Set(await db.tableNames());
    this.tableNamesCachedAt = Date.now();
    return this.tableNamesCache;
  }

  private async getEmbedder(): Promise<Embedder> {
    if (!this.embedder) {
      this.embedderLease = await acquireSharedEmbedder();
      this.embedder = this.embedderLease.embedder;
    }
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => {
      this.embedder = undefined;
      this.embedderLease?.release();
      this.embedderLease = undefined;
      try {
        this.db?.close?.();
      } catch {
        // Releasing the disposable cache is best-effort.
      }
      this.db = undefined;
      this.tableNamesCache = undefined;
      this.tableNamesCachedAt = 0;
      this.tableCache.clear();
      this.tableLastUsed.clear();
      this.tableOpening.clear();
      this.unloadTimer = undefined;
    }, IDLE_DELAY_MS * 4);
    this.unloadTimer.unref?.();
    return this.embedder;
  }

  private async embed(text: string, prefix: 'query' | 'passage'): Promise<number[]> {
    const embedder = await this.getEmbedder();
    const output = await embedder(`${prefix}: ${text}`, { pooling: 'mean', normalize: true });
    const values: unknown = output.tolist();
    const valueList = values as unknown[];
    const row: unknown = Array.isArray(valueList?.[0]) ? valueList[0] : values;
    if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSIONS || !row.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error(`Embedding model returned an invalid ${EMBEDDING_DIMENSIONS}-dimensional vector`);
    return row as number[];
  }

  private async embedQuery(query: string): Promise<number[]> {
    const cached = this.vectorCache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      this.vectorCache.delete(query);
      this.vectorCache.set(query, cached);
      derivedCacheBudget.touch(this.vectorCacheOwner, query);
      return cached.vector.slice();
    }
    if (cached) {
      this.vectorCache.delete(query);
      derivedCacheBudget.remove(this.vectorCacheOwner, query);
    }
    const running = this.vectorInFlight.get(query);
    if (running) return (await running).slice();
    const computation = this.embed(query, 'query');
    this.vectorInFlight.set(query, computation);
    let vector: number[];
    try {
      vector = await computation;
    } finally {
      if (this.vectorInFlight.get(query) === computation) this.vectorInFlight.delete(query);
    }
    const entry = { expiresAt: Date.now() + SEMANTIC_VECTOR_CACHE_TTL_MS, vector: vector.slice() };
    this.vectorCache.set(query, entry);
    derivedCacheBudget.register(this.vectorCacheOwner, query, vector.length * 8 + Buffer.byteLength(query, 'utf8') + 64, () => {
      if (this.vectorCache.get(query) === entry) this.vectorCache.delete(query);
    });
    while (this.vectorCache.size > SEMANTIC_VECTOR_CACHE_MAX_ENTRIES) {
      const oldest = this.vectorCache.keys().next();
      if (oldest.done) break;
      this.vectorCache.delete(oldest.value);
      derivedCacheBudget.remove(this.vectorCacheOwner, oldest.value);
    }
    return vector;
  }

  private async embedMany(texts: string[], prefix: 'query' | 'passage'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const embedder = await this.getEmbedder();
    try {
      const output = await embedder(texts.map(text => `${prefix}: ${text}`), { pooling: 'mean', normalize: true });
      const values = output.tolist() as unknown;
      if (!Array.isArray(values) || values.length !== texts.length) throw new Error('Embedding model returned an invalid batch');
      const rows = values.map(value => value as unknown[]);
      if (!rows.every(row => Array.isArray(row) && row.length === EMBEDDING_DIMENSIONS && row.every(item => typeof item === 'number' && Number.isFinite(item)))) {
        throw new Error(`Embedding model returned an invalid ${EMBEDDING_DIMENSIONS}-dimensional batch`);
      }
      return rows as number[][];
    } catch {
      // Older transformer runtimes may not implement array input. Keep the
      // semantic cache optional by falling back to the proven single-input
      // path instead of failing the whole idle indexing pass.
      const rows: number[][] = [];
      for (const text of texts) rows.push(await this.embed(text, prefix));
      return rows;
    }
  }

  private async prepareIndex(path: string): Promise<PreparedIndex> {
    const fullPath = join(this.vaultPath, path);
    const content = await this.vaultIo.readUtf8(fullPath, 'background');
    const info = await stat(fullPath);
    const contentHash = hashContent(content);
    const scope = scopeForPath(path);
    const chunks = chunkNote(path, content);
    const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
    const wiki = isWikiPath(path, content);
    const rows: IndexRow[] = [];
    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      const vectors = await this.embedMany(batch.map(chunk => chunk.text), 'passage');
      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index]!;
        rows.push({
          id: chunk.id,
          vector: vectors[index]!,
          path,
          hash: contentHash,
          title,
          line: chunk.line,
          wiki,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return { path, scope, contentHash, size: info.size, mtimeMs: info.mtimeMs, rows };
  }

  private async applyIndexBatch(prepared: PreparedIndex[], deleted: string[]): Promise<void> {
    const effectiveDeleted = deleted.filter(path => this.manifest[path] !== undefined);
    if (prepared.length === 0 && effectiveDeleted.length === 0) return;

    const db = await this.getDb();
    const names = await this.getTableNames();
    const groups = new Map<string, IndexBatchGroup>();
    const addPath = (scope: string, path: string): IndexBatchGroup => {
      const name = tableName(scope);
      let group = groups.get(name);
      if (!group) {
        group = { paths: new Set<string>(), rows: [] };
        groups.set(name, group);
      }
      group.paths.add(path);
      return group;
    };

    for (const item of prepared) {
      // A path normally keeps the same scope, but removing the old scope first
      // makes a moved/renamed scoped note safe as well.
      const previous = this.manifest[item.path];
      if (previous && previous.scope !== item.scope) addPath(previous.scope, item.path);
      addPath(item.scope, item.path).rows.push(...item.rows);
    }
    for (const path of effectiveDeleted) {
      const previous = this.manifest[path];
      if (previous) addPath(previous.scope, path);
    }

    for (const [name, group] of groups) {
      let table = names.has(name) ? await this.getTable(name) : undefined;
      if (table && group.paths.size > 0) {
        const predicate = [...group.paths]
          .map(path => `path = '${path.replace(/'/g, "''")}'`)
          .join(' OR ');
        await table.delete(predicate);
      }
      if (group.rows.length > 0) {
        if (table) await table.add(group.rows);
        else {
          table = await db.createTable(name, group.rows);
          names.add(name);
          this.tableCache.set(name, table);
        }
        this.tableNamesCache?.add(name);
      }
    }

    // The manifest is committed only after every table operation succeeds.
    // If LanceDB fails midway, drain() requeues the whole batch and a retry is
    // idempotent because each path is deleted before its replacement is added.
    for (const path of effectiveDeleted) delete this.manifest[path];
    for (const item of prepared) {
      this.manifest[item.path] = {
        hash: item.contentHash,
        scope: item.scope,
        size: item.size,
        mtimeMs: item.mtimeMs,
      };
    }
    this.queryGeneration += 1;
    this.clearQueryCache();
  }

  private pathIsVisible(path: string, params: SemanticSearchParams): boolean {
    if (!this.accessPolicy.canAccessPhysicalPath(path, params.principal)) return false;
    const prefix = normalizePath(params.pathPrefix || '');
    if (prefix && !isUnder(path, prefix)) return false;
    const excludes = (params.excludePaths || []).map(normalizePath).filter(Boolean);
    return !excludes.some(exclude => isUnder(path, exclude));
  }

  private markUnavailable(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.unavailableUntil = Date.now() + UNAVAILABLE_RETRY_MS;
  }
}
