import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { PathFilter } from './pathfilter.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { VaultCatalogChange, VaultFileCatalog } from './vault-catalog.js';
import type { SearchParams, SearchResult } from './types.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { generateObsidianUri } from './uri.js';
import { VaultIoCoordinator } from './vault-io.js';
import { isMissingVaultPath, VaultReadUnavailableError } from './vault-read-errors.js';
import { readSnapshotBytes } from './snapshot-read.js';
import { writeGzipSnapshot } from './snapshot-write.js';
import { chunkSemanticNote } from './semantic-chunks.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
import { SEMANTIC_MODEL_ID as MODEL_ID, SEMANTIC_MODEL_OPTIONS, SEMANTIC_EMBEDDING_PROFILE } from './semantic-profile.js';
import { semanticInferenceGate, SemanticInferenceBusyError, type SemanticInferencePriority } from './semantic-inference-gate.js';

const EMBEDDING_DIMENSIONS = 384;
const INDEX_DIR = '.mcpvault/semantic-index';
const MANIFEST_FILE = 'manifest.snapshot.gz';
const LEGACY_MANIFEST_FILE = 'manifest.json';
const PENDING_FILE = 'pending.snapshot.gz';
const WORKER_LOCK_FILE = 'worker.lock';
const MAX_EXCERPT_CHARS = 600;
const IDLE_DELAY_MS = 15_000;
const UNAVAILABLE_RETRY_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 30_000;
const SCAN_BATCH_SIZE = 16;
const MAX_PENDING_CHANGES = 5_000;
const EMBED_BATCH_SIZE = 8;
const SEMANTIC_QUERY_CACHE_TTL_MS = 5_000;
const SEMANTIC_QUERY_CACHE_MAX_ENTRIES = 64;
const SEMANTIC_VECTOR_CACHE_TTL_MS = 60_000;
const SEMANTIC_VECTOR_CACHE_MAX_ENTRIES = 32;
const TABLE_CACHE_MAX_ENTRIES = 32;
const FALLBACK_SCAN_BATCH_SIZE = 8;
const PENDING_SNAPSHOT_DEBOUNCE_MS = 1_000;
const MANIFEST_MAX_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_COMPRESSED_MAX_BYTES = 32 * 1024 * 1024;
const PENDING_MAX_BYTES = 8 * 1024 * 1024;

type ChangeKind = 'upsert' | 'delete';
type PendingChange = { kind: ChangeKind; attempt?: number; retryAt?: number };

interface ManifestEntry {
  hash: string;
  scope: string;
  embeddingProfile?: string;
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
  chunkHash: string;
  embeddingProfile: string;
}

type SemanticResultRow = Pick<IndexRow, 'id' | 'path' | 'hash'>;

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
        // Local directory overrides ignore revision in Transformers.js. Only
        // pinned Hub artifacts (or their revision-specific disk cache) qualify.
        module.env.allowLocalModels = false;
        const pipeline = module.pipeline as unknown as (task: string, model: string, options?: Record<string, unknown>) => Promise<Embedder>;
        return pipeline('feature-extraction', MODEL_ID, SEMANTIC_MODEL_OPTIONS);
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

function isCanonicalSemanticPath(path: unknown): path is string {
  return typeof path === 'string' && path === normalizePath(path) && isMarkdown(path)
    && !/[\\:\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
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

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function compactExcerpt(text: string): string {
  // Raw windows/chunk boundaries use UTF-16 offsets. Drop only pairs split by
  // the window, and never leave a dangling high surrogate before an ellipsis.
  const compact = text.replace(/\s+/g, ' ').trim().replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '');
  return compact.length > MAX_EXCERPT_CHARS
    ? `${compact.slice(0, MAX_EXCERPT_CHARS - 1).replace(/[\uD800-\uDBFF]$/, '')}…`
    : compact;
}

async function resultFromRow(row: SemanticResultRow, vaultPath: string, includeRevision: boolean, vaultIo?: VaultIoCoordinator): Promise<SearchResult | undefined> {
  try {
    const raw = await (vaultIo ? vaultIo.readUtf8(join(vaultPath, row.path)) : readFile(join(vaultPath, row.path), 'utf8'));
    // A vector row is disposable and may lag behind an Obsidian edit. Never
    // return a deleted note or an excerpt ranked from an older revision.
    if (hashContent(raw) !== row.hash || isMarkdownModerationHidden(raw)) return undefined;
    // Legacy rows carry lines from a synthetic title/body string. The same
    // text/ordinal contract resolves their actual source anchor without a
    // schema change, reembedding, or trusting persisted display metadata.
    const chunk = chunkSemanticNote(row.path, raw).find(value => value.id === row.id);
    if (!chunk) return undefined;
    const start = Math.max(chunk.bodyOffset, chunk.offset - 120);
    const wiki = isWikiPath(row.path, raw);
    return {
      p: row.path,
      t: row.path.split('/').pop()?.replace(/\.md$/i, '') || row.path,
      ex: compactExcerpt(raw.slice(start, chunk.offset + MAX_EXCERPT_CHARS - 120)),
      mc: 0,
      ln: chunk.line,
      uri: generateObsidianUri(vaultPath, row.path),
      ...(wiki && { wk: true as const }),
      vs: true,
      why: ['semantic_match'],
      fresh: 'verified' as const,
      next: wiki ? 'read_projection' as const : 'read_section' as const,
      ...(includeRevision && { rv: row.hash }),
    };
  } catch (error) {
    // The source may have been removed between vector query and response.
    if (isMissingVaultPath(error)) return undefined;
    throw new VaultReadUnavailableError();
  }
}

function fitSemanticExcerpt(result: SearchResult, maxChars: number): SearchResult {
  if (JSON.stringify([result]).length <= maxChars) return result;
  const original = result.ex;
  const fitted = { ...result, ex: '' };
  let low = 0;
  let high = original.length;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const prefix = original.slice(0, length).replace(/[\uD800-\uDBFF]$/, '');
    const candidate = { ...result, ex: prefix ? `${prefix}…` : '' };
    if (JSON.stringify([candidate]).length <= maxChars) { fitted.ex = candidate.ex; low = length + 1; }
    else high = length - 1;
  }
  return fitted;
}

/**
 * A nearest-neighbor query can otherwise spend its whole response budget on
 * one folder or series.  When the index contains several shelves, take one
 * strong candidate from each shelf first, then fill the remaining slots by
 * distance.  This is only a presentation rule; it never changes the vector
 * index or the authoritative Markdown placement.
 */
function diversifyRows(items: Array<{ row: IndexRow; distance: number }>, limit: number): Array<{ row: IndexRow; distance: number }> {
  const sorted = [...items].sort((a, b) => a.distance - b.distance || a.row.path.localeCompare(b.row.path));
  if (limit <= 1) return sorted.slice(0, limit);
  const groups = new Map<string, Array<{ row: IndexRow; distance: number }>>();
  for (const item of sorted) {
    const slash = item.row.path.lastIndexOf('/');
    const shelf = slash > 0 ? item.row.path.slice(0, slash).toLowerCase() : '(root)';
    const group = groups.get(shelf);
    if (group) group.push(item);
    else groups.set(shelf, [item]);
  }
  if (groups.size < 3) return sorted.slice(0, limit);
  const selected: Array<{ row: IndexRow; distance: number }> = [];
  const selectedIds = new Set<string>();
  for (const group of groups.values()) {
    const item = group[0];
    if (!item) continue;
    selected.push(item);
    selectedIds.add(item.row.id);
    if (selected.length >= limit) return selected;
  }
  for (const item of sorted) {
    if (selectedIds.has(item.row.id)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
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
  private readonly queryCache = new Map<string, { expiresAt: number; generation: number; rows: SemanticResultRow[] }>();
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
  private readonly inferenceAbort = new AbortController();
  private readonly inferenceTasks = new Set<Promise<unknown>>();
  private pending = new Map<string, PendingChange>();
  private pendingSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSnapshotWrite: Promise<void> | undefined;
  private pendingSnapshotPending = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private unloadTimer: ReturnType<typeof setTimeout> | undefined;
  private activeSearches = 0;
  private syncPromise: Promise<void> | undefined;
  private scanPromise: Promise<void> | undefined;
  private dbPromise: Promise<any> | undefined;
  private semanticActive = false;
  private indexLease: FileHandle | undefined;
  private indexLeaseNonce: string | undefined;
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
      this.catalogUnsubscribe = catalog.subscribeBatch(changes => {
        if (changes) this.notifyChanges(changes);
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
    this.notifyChanges([{ path, kind }]);
  }

  notifyChanges(changes: readonly VaultCatalogChange[]): void {
    this.queryGeneration += 1;
    this.clearQueryCache();
    for (const change of changes) {
      const normalized = normalizePath(change.path);
      if (change.path.replace(/\\/g, '/').trim() !== normalized || !this.pathCanBeIndexed(normalized)) continue;
      if (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized)) {
        this.pending.set(normalized, { kind: change.kind });
        this.queuePendingSnapshotSave();
      }
    }
    if (this.semanticActive) this.scheduleIdleWork();
  }

  async close(): Promise<void> {
    this.inferenceAbort.abort();
    this.catalogUnsubscribe?.();
    this.semanticActive = false;
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
    // Await the owning workers as well: admission cancellation still has to
    // unwind prepare/drain and restore pending intents before releasing storage.
    await Promise.allSettled([
      ...this.inferenceTasks,
      ...(this.syncPromise ? [this.syncPromise] : []),
      ...(this.scanPromise ? [this.scanPromise] : []),
    ]);
    if (this.pendingSnapshotWrite) await this.pendingSnapshotWrite.catch(() => undefined);
    this.clearQueryCache();
    this.clearVectorCache();
    this.vectorInFlight.clear();
    this.tableCache.clear();
    this.tableLastUsed.clear();
    this.tableOpening.clear();
    this.embedder = undefined;
    this.embedderLease?.release();
    this.embedderLease = undefined;
    const database = this.db || await this.dbPromise?.catch(() => undefined);
    this.db = undefined;
    this.dbPromise = undefined;
    try {
      await Promise.resolve(database?.close?.());
    } catch {
      // The vector database is a disposable read model; shutdown remains
      // best-effort after authoritative Markdown work has stopped.
    }
    await this.releaseIndexLease();
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
    if (this.inferenceAbort.signal.aborted) return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: 'Semantic service is closed.' };
    this.activeSearches++;
    try {
      return await this.searchCurrent(params);
    } finally {
      this.activeSearches--;
      if (this.db || this.embedder) this.scheduleResourceRelease();
    }
  }

  private async searchCurrent(params: SemanticSearchParams): Promise<SemanticSearchOutcome> {
    const limit = normalizeSearchLimit(params.limit);
    const maxChars = normalizeSearchMaxChars(params.maxChars);
    if (!params.query?.trim()) throw new Error('Search query cannot be empty');
    const cacheKey = JSON.stringify({
      query: params.query.trim(),
      queryVector: params.queryVector ? createHash('sha256').update(JSON.stringify(params.queryVector)).digest('hex') : undefined,
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
    try {
      await this.catalog?.flushPendingEvents();
      const generation = this.queryGeneration;
      const cached = this.queryCache.get(cacheKey);
      if (cached && cached.generation === this.queryGeneration && cached.expiresAt > Date.now()) {
        this.queryCache.delete(cacheKey);
        this.queryCache.set(cacheKey, cached);
        derivedCacheBudget.touch(this.queryCacheOwner, cacheKey);
        const results = await this.hydrateRows(cached.rows, params);
        if (generation !== this.queryGeneration) return this.changedQueryOutcome();
        return {
          results,
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
      let vector: number[];
      if (params.queryVector !== undefined) {
        if (params.queryVector.length !== EMBEDDING_DIMENSIONS || params.queryVector.some(value => !Number.isFinite(value))) {
          throw new Error(`queryVector must contain exactly ${EMBEDDING_DIMENSIONS} finite numbers`);
        }
        vector = params.queryVector.slice();
      } else {
        vector = await this.embedQuery(params.query.trim());
      }
      const scopes = this.accessPolicy.scopeRoots(params.principal).map(root => root.kind === 'global' ? 'global' : `${root.kind}:${root.root.split('/').pop()}`);
      const bestByPath = new Map<string, { row: IndexRow; distance: number }>();
      for (const scope of scopes) {
        const name = tableName(scope);
        if (!names.has(name)) continue;
        const table = await this.getTable(name);
        if (!(await table.schema()).fields.some((field: { name: string }) => field.name === 'embeddingProfile')) continue;
        const rows = await table.vectorSearch(vector).where(`embeddingProfile = '${SEMANTIC_EMBEDDING_PROFILE}'`).distanceType('cosine').limit(limit * 2).toArray();
        for (const row of rows as Array<IndexRow & { _distance?: number }>) {
          if (row.embeddingProfile !== SEMANTIC_EMBEDDING_PROFILE) continue;
          const path = normalizePath(row.path);
          if (!this.pathIsVisible(path, params)) continue;
          const distance = Number(row._distance ?? 1);
          const old = bestByPath.get(path);
          if (!old || distance < old.distance) bestByPath.set(path, { row, distance });
        }
      }

      const ordered: SemanticResultRow[] = diversifyRows([...bestByPath.values()], limit)
        .map(({ row }) => ({ id: row.id, path: row.path, hash: row.hash }));
      const results = await this.hydrateRows(ordered, params);
      if (generation !== this.queryGeneration) return this.changedQueryOutcome();
      this.queryCache.set(cacheKey, {
        expiresAt: Date.now() + SEMANTIC_QUERY_CACHE_TTL_MS,
        generation,
        rows: ordered,
      });
      derivedCacheBudget.register(
        this.queryCacheOwner,
        cacheKey,
        estimateCacheBytes(ordered) + Buffer.byteLength(cacheKey, 'utf8') + 128,
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
      if (error instanceof SemanticInferenceBusyError) return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: error.message };
      this.markUnavailable(error);
      return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: this.lastError };
    }
  }

  private async hydrateRows(rows: readonly SemanticResultRow[], params: SemanticSearchParams): Promise<SearchResult[]> {
    const visible = rows.filter(row => row.path === normalizePath(row.path) && this.pathIsVisible(row.path, params));
    const hydrated = await Promise.all(visible.map(row => resultFromRow(row, this.vaultPath, params.includeRevisions === true, this.vaultIo)));
    const maxChars = normalizeSearchMaxChars(params.maxChars);
    return boundSearchResults(hydrated.filter((result): result is SearchResult => result !== undefined)
      .map(result => fitSemanticExcerpt(result, maxChars)), maxChars);
  }

  private changedQueryOutcome(): SemanticSearchOutcome {
    return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size,
      error: 'Semantic index changed during search; retry the same query. Lexical search remains available.' };
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
      const raw = await readSnapshotBytes(this.manifestPath, { maxBytes: SNAPSHOT_COMPRESSED_MAX_BYTES, maxDecodedBytes: MANIFEST_MAX_BYTES });
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      this.manifest = this.validatedManifest(parsed);
    } catch {
      try {
        // Read manifests written by older releases once; the next successful
        // index update stores the compact binary form.
        const raw = await readSnapshotBytes(join(this.indexPath, LEGACY_MANIFEST_FILE), { maxBytes: MANIFEST_MAX_BYTES });
        const parsed: unknown = JSON.parse(raw.toString('utf8'));
        this.manifest = this.validatedManifest(parsed);
      } catch {
        this.manifest = {};
      }
    }
  }

  private validatedManifest(parsed: unknown): Record<string, ManifestEntry> {
    const result: Record<string, ManifestEntry> = Object.create(null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    for (const [path, value] of Object.entries(parsed)) {
      if (!this.pathCanBeIndexed(path) || !value || typeof value !== 'object') continue;
      const item = value as ManifestEntry;
      if (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) continue;
      result[path] = { hash: item.hash, scope: scopeForPath(path),
        ...(typeof item.embeddingProfile === 'string' && /^[a-f0-9]{64}$/.test(item.embeddingProfile) && { embeddingProfile: item.embeddingProfile }),
        ...(typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 && { size: item.size }),
        ...(typeof item.mtimeMs === 'number' && Number.isFinite(item.mtimeMs) && { mtimeMs: item.mtimeMs }) };
    }
    return result;
  }

  private async saveManifest(): Promise<void> {
    // Capture the inventory before IO: entries are replaced, never mutated by
    // reconciliation. Streaming must not mix generations from later changes.
    const entries = Object.entries(this.manifest);
    function* chunks() {
      yield '{';
      for (let i = 0; i < entries.length; i++) {
        const [path, entry] = entries[i]!;
        yield `${i ? ',' : ''}${JSON.stringify(path)}:${JSON.stringify(entry)}`;
      }
      yield '}';
    }
    try {
      await mkdir(this.indexPath, { recursive: true });
      await writeGzipSnapshot(this.manifestPath, chunks(), { maxBytes: SNAPSHOT_COMPRESSED_MAX_BYTES, maxDecodedBytes: MANIFEST_MAX_BYTES });
    } catch {
      // Optional restart acceleration must not turn a completed vector write
      // into reembedding/backoff when disk IO or snapshot size limits reject it.
      // Keep the current in-memory manifest; startup reconciliation repairs an
      // older on-disk generation from Markdown and existing vector rows.
    }
  }

  private async loadPendingSnapshot(): Promise<void> {
    try {
      const raw = await readSnapshotBytes(join(this.indexPath, PENDING_FILE), { maxBytes: PENDING_MAX_BYTES, maxDecodedBytes: PENDING_MAX_BYTES });
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed.slice(0, MAX_PENDING_CHANGES)) {
        if (!item || typeof item !== 'object') continue;
        const value = item as Record<string, unknown>;
        const path = value.path;
        const kind = value.kind === 'delete' ? 'delete' : value.kind === 'upsert' ? 'upsert' : undefined;
        if (typeof path !== 'string' || !kind || !this.pathCanBeIndexed(path) || this.pending.has(path)) continue;
        const attempt = Number.isInteger(value.attempt) ? Math.min(Math.max(Number(value.attempt), 0), 8) : 0;
        const retryAt = Number.isFinite(Number(value.retryAt)) ? Number(value.retryAt) : undefined;
        this.pending.set(path, { kind, ...(attempt > 0 && { attempt }), ...(retryAt && { retryAt }) });
      }
    } catch {
      // A missing or corrupt work queue is harmless; scanForChanges rebuilds it.
    }
  }

  private queuePendingSnapshotSave(): void {
    if (this.inferenceAbort.signal.aborted) return;
    this.pendingSnapshotPending = true;
    if (this.pendingSnapshotTimer) return;
    this.pendingSnapshotTimer = setTimeout(() => {
      this.pendingSnapshotTimer = undefined;
      void this.flushPendingSnapshot();
    }, PENDING_SNAPSHOT_DEBOUNCE_MS);
    this.pendingSnapshotTimer.unref?.();
  }

  private async flushPendingSnapshot(): Promise<void> {
    if (this.inferenceAbort.signal.aborted || this.pendingSnapshotWrite || !this.pendingSnapshotPending) return;
    this.pendingSnapshotPending = false;
    const entries = [...this.pending.entries()].slice(0, MAX_PENDING_CHANGES).map(([path, change]) => ({ path, ...change }));
    function* chunks() {
      yield '[';
      for (let i = 0; i < entries.length; i++) yield `${i ? ',' : ''}${JSON.stringify(entries[i])}`;
      yield ']';
    }
    this.pendingSnapshotWrite = (async () => {
      await mkdir(this.indexPath, { recursive: true });
      const path = join(this.indexPath, PENDING_FILE);
      await writeGzipSnapshot(path, chunks(), { maxBytes: PENDING_MAX_BYTES, maxDecodedBytes: PENDING_MAX_BYTES });
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
    if (this.idleTimer || this.inferenceAbort.signal.aborted) return;
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
      if (!(error instanceof SemanticInferenceBusyError)) this.markUnavailable(error);
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
      for (let start = 0; start < paths.length; start += SCAN_BATCH_SIZE) {
        const batch = paths.slice(start, start + SCAN_BATCH_SIZE);
        const sharedStats = this.catalog ? await this.catalog.statPaths(batch) : undefined;
        const observations = await Promise.all(batch.map(async path => {
          const normalized = normalizePath(path);
          if (!this.pathCanBeIndexed(normalized)) return { normalized };
          const fullPath = join(this.vaultPath, normalized);
          const info = sharedStats?.get(normalized) || await stat(fullPath).catch(error => {
            if (isMissingVaultPath(error)) return undefined;
            throw new VaultReadUnavailableError();
          });
          if (!info) return { normalized };
          const entry = this.manifest[normalized];
          if (entry && entry.embeddingProfile === SEMANTIC_EMBEDDING_PROFILE && entry.size === info.size && entry.mtimeMs === info.mtimeMs) return { normalized, info, entry };
          // A pending intent already requires current-source preparation at
          // drain time. Do not reread/hash it on every reconciliation scan or
          // advance the manifest before the authoritative validation succeeds.
          if (this.pending.has(normalized)) return { normalized, info, entry };
          const content = await this.vaultIo.readUtf8(fullPath, 'background').catch(error => {
            if (isMissingVaultPath(error)) return undefined;
            throw new VaultReadUnavailableError();
          });
          return content === undefined ? { normalized, info, entry } : { normalized, info, entry, hash: hashContent(content) };
        }));
        for (const observation of observations) {
          seen.add(observation.normalized);
          if (!observation.info || !observation.hash) continue;
          const { normalized, info, entry, hash } = observation;
          if ((!entry || entry.hash !== hash || entry.embeddingProfile !== SEMANTIC_EMBEDDING_PROFILE) && (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized))) {
            // Preserve an in-flight retry's backoff. Re-scanning the catalog must
            // not turn one failing note into a hot loop by resetting its attempt.
            if (!this.pending.has(normalized)) this.pending.set(normalized, { kind: 'upsert' });
          } else if (entry && entry.hash === hash && entry.embeddingProfile === SEMANTIC_EMBEDDING_PROFILE) {
            // Timestamp-only changes do not require a new embedding. Persist the
            // refreshed metadata so future scans stay stat-only.
            this.manifest[normalized] = { ...entry, size: info.size, mtimeMs: info.mtimeMs };
            manifestChanged = true;
          }
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

  private async findMarkdownFiles(dir: string, budget = FALLBACK_SCAN_BATCH_SIZE): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir !== this.vaultPath && isMissingVaultPath(error)) return output;
      throw new VaultReadUnavailableError();
    }
    const directories: string[] = [];
    for (const entry of entries) {
      if (entry.name === '.mcpvault' || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) directories.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(full.slice(this.vaultPath.length + 1));
    }
    for (let start = 0; start < directories.length; start += budget) {
      const batch = directories.slice(start, start + budget);
      // Bound the whole tree, not each sibling group. Keep scan ownership until
      // already-started siblings settle even when one storage read fails.
      const nested = await Promise.allSettled(batch.map((directory, index) => this.findMarkdownFiles(
        directory, Math.floor(budget / batch.length) + (index < budget % batch.length ? 1 : 0),
      )));
      const failed = nested.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      for (const result of nested) {
        if (result.status === 'fulfilled') for (const path of result.value) output.push(path);
      }
    }
    return output;
  }

  private async drain(maxFiles: number): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      const batch: Array<[string, PendingChange]> = [];
      const now = Date.now();
      for (const [path, change] of this.pending.entries()) {
        if (batch.length >= maxFiles) break;
        if (change.retryAt && change.retryAt > now) continue;
        this.pending.delete(path);
        batch.push([path, change]);
        if (batch.length >= maxFiles) break;
      }
      if (batch.length === 0) return;
      this.queuePendingSnapshotSave();
      try {
        const prepared: PreparedIndex[] = [];
        const deleted: string[] = [];
        for (const [path] of batch) {
          if (!this.pathCanBeIndexed(path)) continue;
          // Pending intents may survive a restart or race a recreated note.
          // Current Markdown existence, not the queued verb, chooses the write.
          try {
            const info = await stat(join(this.vaultPath, path));
            if (info.isFile()) prepared.push(await this.prepareIndex(path));
            else deleted.push(path);
          } catch (error) {
            if (error instanceof SemanticInferenceBusyError) throw error;
            if (!isMissingVaultPath(error)) throw new VaultReadUnavailableError();
            deleted.push(path);
          }
        }
        if (deleted.length) {
          try {
            if (!(await stat(this.vaultPath)).isDirectory()) throw new VaultReadUnavailableError();
          } catch {
            throw new VaultReadUnavailableError();
          }
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
            const busy = error instanceof SemanticInferenceBusyError;
            const attempt = busy ? (change.attempt || 0) : Math.min((change.attempt || 0) + 1, 8);
            const retryDelay = busy ? 1_000 : Math.min(UNAVAILABLE_RETRY_MS, 1_000 * 2 ** (attempt - 1));
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
    this.scheduleResourceRelease();
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
      const nonce = randomUUID();
      try {
        const handle = await open(this.workerLockPath, 'wx');
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() }), 'utf8');
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await unlink(this.workerLockPath).catch(() => undefined);
          throw error;
        }
        this.indexLease = handle;
        this.indexLeaseNonce = nonce;
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

  private async releaseIndexLease(): Promise<void> {
    const handle = this.indexLease;
    const nonce = this.indexLeaseNonce;
    this.indexLease = undefined;
    this.indexLeaseNonce = undefined;
    this.indexWorker = 'standby';
    if (!handle) return;
    await handle.close().catch(() => undefined);
    if (!nonce) return;
    const owner = await readFile(this.workerLockPath, 'utf8').catch(() => '');
    try {
      const record = JSON.parse(owner) as { pid?: unknown; nonce?: unknown };
      if (record.pid === process.pid && record.nonce === nonce) await unlink(this.workerLockPath).catch(() => undefined);
    } catch {
      // Never remove a corrupt or replaced lock during shutdown. A future
      // acquisition can apply the existing stale-lock recovery policy.
    }
  }

  private async getTableNames(): Promise<Set<string>> {
    if (this.tableNamesCache && Date.now() - this.tableNamesCachedAt < SCAN_INTERVAL_MS) return this.tableNamesCache;
    const db = await this.getDb();
    this.tableNamesCache = new Set(await db.tableNames());
    this.tableNamesCachedAt = Date.now();
    return this.tableNamesCache;
  }

  private async getEmbedder(): Promise<Embedder> {
    if (this.inferenceAbort.signal.aborted) throw new SemanticInferenceBusyError();
    if (!this.embedder) {
      const lease = await acquireSharedEmbedder();
      if (this.inferenceAbort.signal.aborted) { lease.release(); throw new SemanticInferenceBusyError(); }
      this.embedderLease = lease;
      this.embedder = lease.embedder;
    }
    this.scheduleResourceRelease();
    return this.embedder;
  }

  private scheduleResourceRelease(): void {
    if (this.inferenceAbort.signal.aborted) return;
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = setTimeout(() => {
      if (this.inferenceTasks.size || this.activeSearches || this.syncPromise || this.scanPromise || this.dbPromise || this.tableOpening.size) {
        this.scheduleResourceRelease();
        return;
      }
      this.embedder = undefined;
      this.embedderLease?.release();
      this.embedderLease = undefined;
      try {
        void Promise.resolve(this.db?.close?.()).catch(() => undefined);
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
  }

  private withInference<T>(priority: SemanticInferencePriority, run: () => Promise<T>): Promise<T> {
    const task = semanticInferenceGate.run(priority, run, this.inferenceAbort.signal);
    this.inferenceTasks.add(task);
    void task.then(() => this.inferenceTasks.delete(task), () => this.inferenceTasks.delete(task));
    return task;
  }

  private embed(text: string, prefix: 'query' | 'passage'): Promise<number[]> {
    return this.withInference(prefix === 'query' ? 'foreground' : 'background', async () => this.embedDirect(await this.getEmbedder(), text, prefix));
  }

  private async embedDirect(embedder: Embedder, text: string, prefix: 'query' | 'passage'): Promise<number[]> {
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
    return this.withInference(prefix === 'query' ? 'foreground' : 'background', async () => {
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
        // fallback inside the current gate job, never recursively acquire it.
        const rows: number[][] = [];
        for (const text of texts) rows.push(await this.embedDirect(embedder, text, prefix));
        return rows;
      }
    });
  }

  private async prepareIndex(path: string): Promise<PreparedIndex> {
    if (!this.pathCanBeIndexed(path)) throw new VaultReadUnavailableError();
    const fullPath = join(this.vaultPath, path);
    const info = await stat(fullPath);
    const content = await this.vaultIo.readUtf8(fullPath, 'background');
    const afterRead = await stat(fullPath);
    if (info.size !== afterRead.size || info.mtimeMs !== afterRead.mtimeMs) throw new VaultReadUnavailableError();
    const contentHash = hashContent(content);
    const scope = scopeForPath(path);
    const chunks = chunkSemanticNote(path, content);
    const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
    const wiki = isWikiPath(path, content);
    const reusable = await this.reusableVectors(path, scope);
    const fingerprints = chunks.map(chunk => hashContent(`passage: ${chunk.text}`));
    const vectors = fingerprints.map(fingerprint => reusable.get(fingerprint));
    const missing = chunks.map((_, index) => index).filter(index => !vectors[index]);
    for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
      const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
      const generated = await this.embedMany(batch.map(index => chunks[index]!.text), 'passage');
      for (let index = 0; index < batch.length; index++) vectors[batch[index]!] = generated[index]!;
    }
    const rows: IndexRow[] = [];
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]!;
        rows.push({
          id: chunk.id,
          vector: vectors[index]!,
          path,
          hash: contentHash,
          title,
          line: chunk.line,
          wiki,
          updatedAt: new Date().toISOString(),
          chunkHash: fingerprints[index]!,
          embeddingProfile: SEMANTIC_EMBEDDING_PROFILE,
        });
    }
    // Embedding can take longer than a source edit. Do not associate old vectors
    // with a newer stat fingerprint which would suppress future reconciliation.
    if (hashContent(await this.vaultIo.readUtf8(fullPath, 'background')) !== contentHash) throw new VaultReadUnavailableError();
    return { path, scope, contentHash, size: info.size, mtimeMs: info.mtimeMs, rows };
  }

  private async reusableVectors(path: string, scope: string): Promise<Map<string, number[]>> {
    const reusable = new Map<string, number[]>();
    try {
      const name = tableName(scope);
      if (!(await this.getTableNames()).has(name)) return reusable;
      const table = await this.getTable(name);
      const fields = (await table.schema()).fields.map((field: { name: string }) => field.name);
      if (!fields.includes('chunkHash') || !fields.includes('embeddingProfile')) return reusable;
      const rows = await table.query()
        .where(`path = '${path.replace(/'/g, "''")}' AND embeddingProfile = '${SEMANTIC_EMBEDDING_PROFILE}'`)
        .select(['path', 'chunkHash', 'embeddingProfile', 'vector']).limit(65).toArray();
      // A damaged table must not cause an unbounded scan or bless partial state.
      if (rows.length > 64) return reusable;
      for (const row of rows) {
        if (row.path !== path || row.embeddingProfile !== SEMANTIC_EMBEDDING_PROFILE || typeof row.chunkHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.chunkHash)) continue;
        const values = row.vector;
        if (!values || values.length !== EMBEDDING_DIMENSIONS) continue;
        const vector: unknown[] = Array.from(values);
        if (vector.every(value => typeof value === 'number' && Number.isFinite(value))) reusable.set(row.chunkHash, vector as number[]);
      }
    } catch { /* Disposable reuse lookup failure falls back to normal embedding. */ }
    return reusable;
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
      if (table && group.rows.length > 0) {
        const fields = (await table.schema()).fields.map((field: { name: string }) => field.name);
        const missing = ['chunkHash', 'embeddingProfile'].filter(field => !fields.includes(field));
        if (missing.length) await table.addColumns(missing.map(name => ({ name, valueSql: 'CAST(NULL AS STRING)' })));
      }
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
        embeddingProfile: SEMANTIC_EMBEDDING_PROFILE,
        size: item.size,
        mtimeMs: item.mtimeMs,
      };
    }
    this.queryGeneration += 1;
    this.clearQueryCache();
  }

  private pathIsVisible(path: string, params: SemanticSearchParams): boolean {
    // The vector index is disposable and can be restored from a stale or
    // externally supplied snapshot. Re-apply the authoritative file filter
    // before hydrating any result so a derived cache can never expose .git,
    // .obsidian, dotfiles, or other restricted paths.
    if (!this.pathCanBeIndexed(path) || !this.accessPolicy.canAccessPhysicalPath(path, params.principal)) return false;
    const prefix = normalizePath(params.pathPrefix || '');
    if (prefix && !isUnder(path, prefix)) return false;
    const excludes = (params.excludePaths || []).map(normalizePath).filter(Boolean);
    return !excludes.some(exclude => isUnder(path, exclude));
  }

  private pathCanBeIndexed(path: string): boolean {
    if (!isCanonicalSemanticPath(path) || !this.pathFilter.isAllowed(path)) return false;
    if (/^_whispers(?:\/|$)/i.test(path)) return false;
    if (/^_scopes(?:\/|$)/i.test(path) && !/^_scopes\/(?:models|agents)\/[^/]+\/.+/i.test(path)) return false;
    return true;
  }

  private markUnavailable(error: unknown): void {
    this.clearQueryCache();
    this.lastError = error instanceof VaultReadUnavailableError
      ? 'Semantic source read unavailable; restore storage access and retry after the cooldown. Lexical search remains independent.'
      : 'Semantic search unavailable; retry after the cooldown. Lexical search remains independent.';
    this.unavailableUntil = Date.now() + UNAVAILABLE_RETRY_MS;
  }
}
