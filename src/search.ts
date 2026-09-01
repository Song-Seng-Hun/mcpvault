import { join, resolve } from 'path';
import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { PathFilter } from './pathfilter.js';
import type { RankCandidate, SearchParams, SearchResult } from './types.js';
import { generateObsidianUri } from './uri.js';
import { boundSearchResults, boundedTopK, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
import type { VaultFileCatalog } from './vault-catalog.js';
import { createDerivedCacheOwner, derivedCacheBudget, estimateCacheBytes } from './cache-budget.js';
import { VaultIoCoordinator } from './vault-io.js';

const WIKI_TYPES = new Set(['schema', 'source', 'knowledge', 'issue']);
const SEARCH_CACHE_TTL_MS = 5_000;
const SEARCH_CACHE_MAX_ENTRIES = 128;
const INDEX_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const INDEX_READ_BATCH_SIZE = 32;
const MAX_INDEXED_TEXT_BYTES = 64 * 1024 * 1024;
const NGRAM_SIZE = 3;
const SEARCH_SNAPSHOT_FILE = '.mcpvault/search-index.snapshot.bin';
const LEGACY_SEARCH_SNAPSHOT_FILE = '.mcpvault/search-index.snapshot.gz';
const SEARCH_SNAPSHOT_VERSION = 2;
const SNAPSHOT_SAVE_DEBOUNCE_MS = 1_000;
const DIRECTORY_CACHE_TTL_MS = 5_000;
const CORPUS_STATS_CACHE_MAX_ENTRIES = 64;
const gunzipAsync = promisify(gunzip);
const SNAPSHOT_MAGIC = Buffer.from('MCPVSRCH', 'ascii');
const MAX_SNAPSHOT_ENTRIES = 1_000_000;

interface SearchCacheEntry {
  expiresAt: number;
  results: SearchResult[];
}

interface IndexedDocument {
  relativePath: string;
  documentId: number;
  body?: string;
  frontmatterText?: string;
  title: string;
  isWiki: boolean;
  moderationHidden: boolean;
  revision: string;
  size: number;
  mtimeMs: number;
  bodyLength: number;
  frontmatterLength: number;
  textBytes: number;
  textCached: boolean;
  lastAccessAt: number;
  bodyGrams: Set<number>;
  frontmatterGrams: Set<number>;
  titleGrams: Set<number>;
}

interface SearchSnapshotDocument {
  relativePath: string;
  title: string;
  isWiki: boolean;
  moderationHidden: boolean;
  revision: string;
  size: number;
  mtimeMs: number;
  bodyLength: number;
  frontmatterLength: number;
  textBytes: number;
  bodyGramIds: number[];
  frontmatterGramIds: number[];
  titleGramIds: number[];
}

interface SearchSnapshot {
  version: number;
  grams: string[];
  documents: SearchSnapshotDocument[];
}

interface DirectoryCacheEntry {
  expiresAt: number;
  paths: string[];
}

interface CorpusStats {
  docCount: number;
  totalDocLength: number;
}

function encodeSnapshotString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function encodeSnapshot(snapshot: SearchSnapshot): Buffer {
  const chunks: Buffer[] = [SNAPSHOT_MAGIC];
  const header = Buffer.allocUnsafe(12);
  header.writeUInt32LE(SEARCH_SNAPSHOT_VERSION, 0);
  header.writeUInt32LE(snapshot.documents.length, 4);
  header.writeUInt32LE(snapshot.grams.length, 8);
  chunks.push(header);
  for (const value of snapshot.grams) chunks.push(encodeSnapshotString(value));
  for (const document of snapshot.documents) {
    chunks.push(encodeSnapshotString(document.relativePath));
    chunks.push(encodeSnapshotString(document.title));
    const flags = Buffer.from([(document.isWiki ? 1 : 0) | (document.moderationHidden ? 2 : 0)]);
    chunks.push(flags, encodeSnapshotString(document.revision));
    const numbers = Buffer.allocUnsafe(40);
    numbers.writeDoubleLE(document.size, 0);
    numbers.writeDoubleLE(document.mtimeMs, 8);
    numbers.writeUInt32LE(document.bodyLength, 16);
    numbers.writeUInt32LE(document.frontmatterLength, 20);
    numbers.writeUInt32LE(document.textBytes, 24);
    numbers.writeUInt32LE(document.bodyGramIds.length, 28);
    numbers.writeUInt32LE(document.frontmatterGramIds.length, 32);
    numbers.writeUInt32LE(document.titleGramIds.length, 36);
    chunks.push(numbers);
    for (const values of [document.bodyGramIds, document.frontmatterGramIds, document.titleGramIds]) {
      const encodedValues = Buffer.allocUnsafe(values.length * 4);
      values.forEach((value, index) => encodedValues.writeUInt32LE(value, index * 4));
      chunks.push(encodedValues);
    }
  }
  return Buffer.concat(chunks);
}

function decodeSnapshot(buffer: Buffer): SearchSnapshot | undefined {
  if (buffer.length < SNAPSHOT_MAGIC.length + 12 || !buffer.subarray(0, SNAPSHOT_MAGIC.length).equals(SNAPSHOT_MAGIC)) return undefined;
  let offset = SNAPSHOT_MAGIC.length;
  const version = buffer.readUInt32LE(offset);
  offset += 4;
  const count = buffer.readUInt32LE(offset);
  offset += 4;
  const gramCount = buffer.readUInt32LE(offset);
  offset += 4;
  if (version !== SEARCH_SNAPSHOT_VERSION || count > MAX_SNAPSHOT_ENTRIES) return undefined;
  const readString = (): string | undefined => {
    if (offset + 4 > buffer.length) return undefined;
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    if (length > buffer.length - offset) return undefined;
    const value = buffer.toString('utf8', offset, offset + length);
    offset += length;
    return value;
  };
  const grams: string[] = [];
  if (gramCount > MAX_SNAPSHOT_ENTRIES) return undefined;
  for (let index = 0; index < gramCount; index += 1) {
    const value = readString();
    if (value === undefined) return undefined;
    grams.push(value);
  }
  const readGramIds = (count: number): number[] | undefined => {
    if (count > MAX_SNAPSHOT_ENTRIES) return undefined;
    if (offset + count * 4 > buffer.length) return undefined;
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = buffer.readUInt32LE(offset);
      offset += 4;
      if (value === 0 || value > grams.length) return undefined;
      values.push(value);
    }
    return values;
  };
  const documents: SearchSnapshotDocument[] = [];
  for (let index = 0; index < count; index += 1) {
    const relativePath = readString();
    const title = readString();
    if (relativePath === undefined || title === undefined || offset + 1 > buffer.length) return undefined;
    const flags = buffer[offset]!;
    offset += 1;
    const revisionValue = readString();
    if (revisionValue === undefined || offset + 40 > buffer.length) return undefined;
    const size = buffer.readDoubleLE(offset);
    const mtimeMs = buffer.readDoubleLE(offset + 8);
    const bodyLength = buffer.readUInt32LE(offset + 16);
    const frontmatterLength = buffer.readUInt32LE(offset + 20);
    const textBytes = buffer.readUInt32LE(offset + 24);
    const bodyGramCount = buffer.readUInt32LE(offset + 28);
    const frontmatterGramCount = buffer.readUInt32LE(offset + 32);
    const titleGramCount = buffer.readUInt32LE(offset + 36);
    offset += 40;
    const bodyGramIds = readGramIds(bodyGramCount);
    const frontmatterGramIds = readGramIds(frontmatterGramCount);
    const titleGramIds = readGramIds(titleGramCount);
    if (!bodyGramIds || !frontmatterGramIds || !titleGramIds) return undefined;
    documents.push({ relativePath, title, isWiki: (flags & 1) !== 0, moderationHidden: (flags & 2) !== 0, revision: revisionValue, size, mtimeMs, bodyLength, frontmatterLength, textBytes, bodyGramIds, frontmatterGramIds, titleGramIds });
  }
  return offset === buffer.length ? { version, grams, documents } : undefined;
}

function isWikiPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized === '_wiki'
    || normalized.startsWith('_wiki/')
    || normalized === '_sources'
    || normalized.startsWith('_sources/')
    || /^_scopes\/(models|agents)\/[^/]+\/(?:_wiki|_sources)(?:\/|$)/.test(normalized);
}

function revision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function wikiType(content: string): string | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const value = frontmatter?.match(/^\s*llm_wiki_type\s*:\s*['"]?([a-z_-]+)['"]?\s*$/im)?.[1]?.toLowerCase();
  return value && WIKI_TYPES.has(value) ? value : undefined;
}

/** Normalize a subtree path: forward slashes, no leading/trailing slashes. */
function normalizeSubtree(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export class SearchService {
  private readonly cacheOwner = createDerivedCacheOwner('search.results');
  private vaultPath: string;
  private readonly cache = new Map<string, SearchCacheEntry>();
  private readonly inFlight = new Map<string, Promise<SearchResult[]>>();
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly documentsById = new Map<number, IndexedDocument>();
  private readonly dirtyDocuments = new Set<string>();
  private readonly postings = new Map<string, Set<number>>();
  private readonly gramIds = new Map<string, number>();
  private readonly gramsById = [''];
  private readonly pathDocuments = new Map<string, Set<number>>();
  private readonly documentPathKeys = new Map<number, string[]>();
  private readonly corpusStatsCache = new Map<string, CorpusStats>();
  private readonly directoryCache = new Map<string, DirectoryCacheEntry>();
  private nextDocumentId = 1;
  private indexedTextBytes = 0;
  private cacheGeneration = 0;
  private indexReady: Promise<void> | undefined;
  private readonly snapshotReady: Promise<void>;
  private indexRefresh: Promise<void> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotWrite: Promise<void> | undefined;
  private snapshotPending = false;
  private watcher: FSWatcher | undefined;
  private readonly catalogUnsubscribe: (() => void) | undefined;
  private lastIndexReconcileAt = 0;
  private needsFullReconcile = true;

  constructor(
    vaultPath: string,
    private pathFilter: PathFilter,
    private readonly catalog?: VaultFileCatalog,
    private readonly vaultIo = new VaultIoCoordinator(),
  ) {
    this.vaultPath = resolve(vaultPath);
    this.snapshotReady = this.loadSnapshot();
    if (catalog) {
      this.catalogUnsubscribe = catalog.subscribe((path, kind) => {
        this.invalidate(path, kind);
      });
    }
  }

  /**
   * Search is derived from Markdown, so a short cache is safe and useful for
   * repeated agent lookups. Writers call this immediately after a mutation;
   * the TTL also covers edits made directly in Obsidian.
   */
  invalidate(path?: string, kind: 'upsert' | 'delete' = 'upsert'): void {
    this.cacheGeneration += 1;
    this.cache.clear();
    derivedCacheBudget.clearOwner(this.cacheOwner);
    this.corpusStatsCache.clear();
    this.directoryCache.clear();
    if (path) {
      const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (kind === 'delete') this.removeDocument(normalized);
      else this.dirtyDocuments.add(normalized);
    } else this.needsFullReconcile = true;
  }

  close(): void {
    this.catalogUnsubscribe?.();
    this.watcher?.close();
    this.watcher = undefined;
    this.directoryCache.clear();
    derivedCacheBudget.clearOwner(this.cacheOwner);
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const binary = await readFile(join(this.vaultPath, SEARCH_SNAPSHOT_FILE));
      const parsed = decodeSnapshot(binary);
      if (parsed) this.restoreSnapshot(parsed);
      return;
    } catch {
      // Try the previous compressed-JSON format for a one-release migration.
    }
    try {
      const raw = await gunzipAsync(await readFile(join(this.vaultPath, LEGACY_SEARCH_SNAPSHOT_FILE)));
      const parsed = JSON.parse(raw.toString('utf8')) as Partial<SearchSnapshot>;
      if (parsed.version === SEARCH_SNAPSHOT_VERSION && Array.isArray(parsed.documents)) this.restoreSnapshot(parsed as SearchSnapshot);
    } catch {
      // A missing, corrupt, or old snapshot is harmless; refreshAll rebuilds
      // the derived index from Markdown and replaces it atomically.
    }
  }

  private restoreSnapshot(snapshot: SearchSnapshot): void {
    if (snapshot.documents.length > MAX_SNAPSHOT_ENTRIES) return;
    for (const value of snapshot.grams) {
      if (typeof value !== 'string' || value.length === 0 || this.gramIds.has(value)) continue;
      const id = this.gramsById.length;
      this.gramIds.set(value, id);
      this.gramsById.push(value);
    }
    for (const item of snapshot.documents) {
        if (!item || typeof item !== 'object') continue;
        const relativePath = normalizeSubtree(String(item.relativePath || ''));
        if (!relativePath || !this.pathFilter.isAllowed(relativePath)) continue;
          if (!Array.isArray(item.bodyGramIds) || !Array.isArray(item.frontmatterGramIds) || !Array.isArray(item.titleGramIds)) continue;
        if (![item.size, item.mtimeMs, item.bodyLength, item.frontmatterLength, item.textBytes].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
        const document: IndexedDocument = {
          relativePath,
          documentId: this.nextDocumentId++,
          title: String(item.title || relativePath),
          isWiki: item.isWiki === true,
          moderationHidden: item.moderationHidden === true,
          revision: String(item.revision || ''),
          size: item.size,
          mtimeMs: item.mtimeMs,
          bodyLength: item.bodyLength,
          frontmatterLength: item.frontmatterLength,
          textBytes: item.textBytes,
          textCached: false,
          lastAccessAt: 0,
          bodyGrams: new Set(item.bodyGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
          frontmatterGrams: new Set(item.frontmatterGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
          titleGrams: new Set(item.titleGramIds.filter(value => Number.isInteger(value) && value > 0 && value < this.gramsById.length)),
        };
        this.setDocument(document);
    }
  }

  private scheduleSnapshotSave(): void {
    this.snapshotPending = true;
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      void this.flushSnapshot();
    }, SNAPSHOT_SAVE_DEBOUNCE_MS);
    this.snapshotTimer.unref?.();
  }

  private async flushSnapshot(): Promise<void> {
    if (this.snapshotWrite) return;
    if (!this.snapshotPending) return;
    this.snapshotPending = false;
    const snapshot: SearchSnapshot = {
      version: SEARCH_SNAPSHOT_VERSION,
      documents: [...this.documents.values()].map(document => ({
        relativePath: document.relativePath,
        title: document.title,
        isWiki: document.isWiki,
        moderationHidden: document.moderationHidden,
        revision: document.revision,
        size: document.size,
        mtimeMs: document.mtimeMs,
        bodyLength: document.bodyLength,
        frontmatterLength: document.frontmatterLength,
        textBytes: document.textBytes,
        bodyGramIds: [...document.bodyGrams],
        frontmatterGramIds: [...document.frontmatterGrams],
        titleGramIds: [...document.titleGrams],
      })),
      grams: this.gramsById.slice(1),
    };
    this.snapshotWrite = (async () => {
      const snapshotPath = join(this.vaultPath, SEARCH_SNAPSHOT_FILE);
      await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
      const encoded = encodeSnapshot(snapshot);
      const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, encoded);
      await rename(temporaryPath, snapshotPath);
    })().catch(() => {
      // The snapshot is an optional acceleration cache. Search correctness
      // must never depend on being able to write it (for example on NAS).
    });
    try {
      await this.snapshotWrite;
    } finally {
      this.snapshotWrite = undefined;
      if (this.snapshotPending) this.scheduleSnapshotSave();
    }
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const {
      query,
      limit = 5,
      searchContent = true,
      searchFrontmatter = false,
      caseSensitive = false,
      pathPrefix,
      excludePaths
    } = params;

    if (!query || query.trim().length === 0) {
      throw new Error('Search query cannot be empty');
    }

    const cacheKey = JSON.stringify({
      query,
      limit,
      searchContent,
      searchFrontmatter,
      caseSensitive,
      pathPrefix: params.pathPrefix || '',
      excludePaths: params.excludePaths || [],
      maxChars: params.maxChars,
      includeRevisions: params.includeRevisions === true,
    });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      derivedCacheBudget.touch(this.cacheOwner, cacheKey);
      return cached.results.map(result => ({ ...result }));
    }
    if (cached) {
      this.cache.delete(cacheKey);
      derivedCacheBudget.remove(this.cacheOwner, cacheKey);
    }

    const running = this.inFlight.get(cacheKey);
    if (running) return (await running).map(result => ({ ...result }));

    const generation = this.cacheGeneration;
    const computation = (async (): Promise<SearchResult[]> => {
    await this.ensureIndex();

    const normalizedPrefix = pathPrefix ? normalizeSubtree(pathPrefix) : '';
    const normalizedExcludes = (excludePaths || []).map(normalizeSubtree).filter(Boolean);

    const maxLimit = normalizeSearchLimit(limit);
    const maxChars = normalizeSearchMaxChars(params.maxChars);

    // Corpus stats for reranking. Lengths are prepared during indexing, and
    // the bounded cache lets different queries reuse the same scope stats.
    const termDocFreq = new Map<string, number>();
    const candidates: RankCandidate[] = [];
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    const terms = searchQuery.split(/\s+/).filter(t => t.length > 0);
    const scoringTerms = terms.length > 1 ? [...terms, searchQuery] : terms;

    // The server-owned document index has already performed the filesystem
    // reads. Search only the visible in-memory documents on this pass.
    const scopedDocumentIds = this.scopedDocumentIds(normalizedPrefix, normalizedExcludes);
    const corpusStats = this.getCorpusStats(scopedDocumentIds, searchContent, searchFrontmatter, normalizedPrefix, normalizedExcludes);
    const { totalDocLength, docCount } = corpusStats;
    const candidateIds = this.candidateIds(terms, searchContent, searchFrontmatter, caseSensitive, scopedDocumentIds);
    const allowedFiles: IndexedDocument[] = [];
    for (const documentId of candidateIds) {
      const document = this.documentsById.get(documentId);
      if (!document || !this.pathFilter.isAllowed(document.relativePath)) continue;
      if (document.moderationHidden) continue;
      allowedFiles.push(document);
    }

    for (const document of allowedFiles) {
      if (!candidateIds.has(document.documentId)) continue;
        const { relativePath } = document;
        let searchableText = '';

        // Prepare search text based on options
        if (searchContent || searchFrontmatter) await this.loadText(document);
        if (searchContent && searchFrontmatter) {
          searchableText = `${document.frontmatterText || ''}\n${document.body || ''}`;
        } else if (searchContent) {
          searchableText = document.body || '';
        } else if (searchFrontmatter) {
          searchableText = document.frontmatterText || '';
        }

        const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();
        const docLength = (searchContent ? document.bodyLength : 0)
          + (searchFrontmatter ? document.frontmatterLength : 0);

        // The n-gram candidate index is conservative; this exact check keeps
        // the previous substring matching behavior and supplies document
        // frequencies only for real matches.
        for (const term of scoringTerms) {
          if (searchIn.includes(term)) {
            termDocFreq.set(term, (termDocFreq.get(term) || 0) + 1);
          }
        }

        // Extract title from filename
        const title = relativePath.split('/').pop()?.replace(/\.md$/, '') || relativePath;

        // Check filename match (any term)
        const filenameToSearch = caseSensitive ? title : title.toLowerCase();
        const filenameMatch = terms.some(term => filenameToSearch.includes(term));

        // Check content match (any term)
        const termIndices = terms.map(term => searchIn.indexOf(term));
        const anyTermFound = termIndices.some(idx => idx !== -1);
        const firstIndex = anyTermFound
          ? Math.min(...termIndices.filter(idx => idx !== -1))
          : -1;

        if (firstIndex !== -1 || filenameMatch) {
          let excerpt: string;
          let matchCount = 0;
          let lineNumber = 0;

          const termFreqs = new Map<string, number>();

          if (firstIndex !== -1) {
            // Find the term that matched first for excerpt
            const firstTermIdx = termIndices.indexOf(firstIndex);
            const firstTerm = terms[firstTermIdx]!;

            // Extract excerpt around first content match
            const excerptStart = Math.max(0, firstIndex - 21);
            const excerptEnd = Math.min(searchableText.length, firstIndex + firstTerm.length + 21);
            excerpt = searchableText.slice(excerptStart, excerptEnd).trim();

            // Add ellipsis if excerpt is truncated
            if (excerptStart > 0) excerpt = '...' + excerpt;
            if (excerptEnd < searchableText.length) excerpt = excerpt + '...';

            // Count total content matches across all terms
            for (const term of scoringTerms) {
              let count = 0;
              let searchIndex = 0;
              while ((searchIndex = searchIn.indexOf(term, searchIndex)) !== -1) {
                count++;
                searchIndex += term.length;
              }
              termFreqs.set(term, count);
              matchCount += count;
            }

            // Find line number of first match
            const lines = searchableText.slice(0, firstIndex).split('\n');
            lineNumber = lines.length;
          } else {
            // Filename-only match: use beginning of content as excerpt
            excerpt = searchableText.slice(0, 50).trim();
            if (searchableText.length > 50) excerpt = excerpt + '...';
            matchCount = 0;
            lineNumber = 0;
          }

          // Add filename match to count
          if (filenameMatch) matchCount++;

          candidates.push({
            result: {
              p: relativePath,
              t: title,
              ex: excerpt,
              mc: matchCount,
              ln: lineNumber,
              uri: generateObsidianUri(this.vaultPath, relativePath),
              ...(document.isWiki && { wk: true as const }),
              ...(params.includeRevisions && { rv: document.revision }),
            },
            termFreqs,
            docLength,
            wiki: document.isWiki
          });
        }
    }

    const results = boundSearchResults(this.rerank(candidates, scoringTerms, termDocFreq, docCount, totalDocLength, maxLimit), maxChars);
    if (generation === this.cacheGeneration) {
      const cachedResults = results.map(result => ({ ...result }));
      this.cache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results: cachedResults });
      derivedCacheBudget.register(
        this.cacheOwner,
        cacheKey,
        estimateCacheBytes(cachedResults) + Buffer.byteLength(cacheKey, 'utf8') + 128,
        () => this.cache.delete(cacheKey),
      );
      while (this.cache.size > SEARCH_CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next();
        if (oldest.done) break;
        this.cache.delete(oldest.value);
        derivedCacheBudget.remove(this.cacheOwner, oldest.value);
      }
    }
    return results;
    })();
    this.inFlight.set(cacheKey, computation);
    try {
      return await computation;
    } finally {
      if (this.inFlight.get(cacheKey) === computation) this.inFlight.delete(cacheKey);
    }
  }

  private async ensureIndex(): Promise<void> {
    this.startWatcher();
    await this.snapshotReady;
    if (!this.indexReady) this.indexReady = this.refreshAll();
    await this.indexReady;

    if (this.dirtyDocuments.size > 0) await this.refreshDirty();
    const interval = this.watcher ? INDEX_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
    if (this.needsFullReconcile || Date.now() - this.lastIndexReconcileAt >= interval) await this.refreshAll();
  }

  private startWatcher(): void {
    if (this.catalog) return;
    if (this.watcher) return;
    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
        this.directoryCache.clear();
        if (!filename) {
          this.needsFullReconcile = true;
          return;
        }
        const normalized = String(filename).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (/\.md$/i.test(normalized) && this.pathFilter.isAllowed(normalized)) {
          this.dirtyDocuments.add(normalized);
        } else this.needsFullReconcile = true;
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.needsFullReconcile = true;
      });
      this.watcher.unref?.();
    } catch {
      // Network mounts and some Windows filesystems do not support recursive
      // watchers. The shorter reconciliation interval remains authoritative.
      this.watcher = undefined;
    }
  }

  private async refreshAll(): Promise<void> {
    if (this.indexRefresh) return this.indexRefresh;
    this.indexRefresh = (async () => {
      const paths = this.catalog
        ? (await this.catalog.listNotePaths()).filter(path => path.toLowerCase().endsWith('.md')).map(path => join(this.vaultPath, path))
        : await this.findMarkdownFiles(this.vaultPath);
      const next = new Map<string, IndexedDocument>();
      for (let start = 0; start < paths.length; start += INDEX_READ_BATCH_SIZE) {
        const batch = paths.slice(start, start + INDEX_READ_BATCH_SIZE);
        const documents = await Promise.all(batch.map(fullPath => {
          const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
          return this.readIndexedDocument(fullPath, this.documents.get(relativePath));
        }));
        for (const document of documents) {
          if (document) next.set(document.relativePath, document);
        }
      }
      for (const path of this.documents.keys()) {
        if (!next.has(path)) this.removeDocument(path);
      }
      for (const document of next.values()) this.setDocument(document);
      this.dirtyDocuments.clear();
      this.needsFullReconcile = false;
      this.lastIndexReconcileAt = Date.now();
      this.trimTextCache();
      this.scheduleSnapshotSave();
    })();
    try {
      await this.indexRefresh;
    } finally {
      this.indexRefresh = undefined;
    }
  }

  private async refreshDirty(): Promise<void> {
    if (this.indexRefresh) return this.indexRefresh;
    this.indexRefresh = (async () => {
      const paths = [...this.dirtyDocuments];
      this.dirtyDocuments.clear();
      const documents = await Promise.all(paths.map(path => this.readIndexedDocument(join(this.vaultPath, path))));
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index]!;
        const document = documents[index];
        if (document) this.setDocument(document);
        else this.removeDocument(path);
      }
      this.trimTextCache();
      this.scheduleSnapshotSave();
    })();
    try {
      await this.indexRefresh;
    } finally {
      this.indexRefresh = undefined;
    }
  }

  private async readIndexedDocument(fullPath: string, existing?: IndexedDocument): Promise<IndexedDocument | undefined> {
    const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
    if (!this.pathFilter.isAllowed(relativePath)) return undefined;
    try {
      const info = await stat(fullPath);
      if (!info.isFile()) return undefined;
      if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs) return existing;
      const content = await this.vaultIo.readUtf8(fullPath);
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
      const frontmatterText = frontmatterMatch?.[1] || '';
      const title = relativePath.split('/').pop()?.replace(/\.md$/i, '') || relativePath;
      return {
        relativePath,
        documentId: existing?.documentId ?? this.nextDocumentId++,
        body,
        frontmatterText,
        title,
        isWiki: isWikiPath(relativePath) || wikiType(content) !== undefined,
        moderationHidden: isMarkdownModerationHidden(content),
        revision: revision(content),
        size: info.size,
        mtimeMs: info.mtimeMs,
        bodyLength: countWords(body),
        frontmatterLength: countWords(frontmatterText),
        textBytes: Buffer.byteLength(content, 'utf8'),
        textCached: true,
        lastAccessAt: Date.now(),
        bodyGrams: this.gramIdsForText(body.toLowerCase()),
        frontmatterGrams: this.gramIdsForText(frontmatterText.toLowerCase()),
        titleGrams: this.gramIdsForText(title.toLowerCase()),
      };
    } catch {
      return undefined;
    }
  }

  private gramIdsForText(value: string): Set<number> {
    const output = new Set<number>();
    for (const gram of grams(value)) {
      let id = this.gramIds.get(gram);
      if (id === undefined) {
        id = this.gramsById.length;
        this.gramIds.set(gram, id);
        this.gramsById.push(gram);
      }
      output.add(id);
    }
    return output;
  }

  private postingKey(field: 'body' | 'frontmatter' | 'title', gram: number): string {
    return `${field}\u0000${gram}`;
  }

  private updatePostings(document: IndexedDocument, add: boolean): void {
    const fields: Array<['body' | 'frontmatter' | 'title', Set<number>]> = [
      ['body', document.bodyGrams],
      ['frontmatter', document.frontmatterGrams],
      ['title', document.titleGrams],
    ];
    for (const [field, values] of fields) {
      for (const value of values) {
        const key = this.postingKey(field, value);
        if (add) {
          let paths = this.postings.get(key);
          if (!paths) {
            paths = new Set<number>();
            this.postings.set(key, paths);
          }
          paths.add(document.documentId);
        } else {
          const paths = this.postings.get(key);
          paths?.delete(document.documentId);
          if (paths && paths.size === 0) this.postings.delete(key);
        }
      }
    }
  }

  private setDocument(document: IndexedDocument): void {
    const old = this.documents.get(document.relativePath);
    if (old === document) return;
    this.corpusStatsCache.clear();
    if (old) {
      this.updatePostings(old, false);
      this.removePathIndex(old);
      this.documentsById.delete(old.documentId);
      if (old.textCached) this.indexedTextBytes -= old.textBytes;
    }
    this.documents.set(document.relativePath, document);
    this.documentsById.set(document.documentId, document);
    this.updatePostings(document, true);
    this.addPathIndex(document);
    if (document.textCached) this.indexedTextBytes += document.textBytes;
  }

  private removeDocument(path: string): void {
    const document = this.documents.get(path);
    if (!document) return;
    this.corpusStatsCache.clear();
    this.updatePostings(document, false);
    this.removePathIndex(document);
    this.documentsById.delete(document.documentId);
    if (document.textCached) this.indexedTextBytes -= document.textBytes;
    this.documents.delete(path);
  }

  private pathKeys(path: string): string[] {
    const parts = path.split('/');
    const keys = [''];
    for (let index = 1; index <= parts.length; index += 1) keys.push(parts.slice(0, index).join('/'));
    return keys;
  }

  private addPathIndex(document: IndexedDocument): void {
    const keys = this.pathKeys(document.relativePath);
    this.documentPathKeys.set(document.documentId, keys);
    for (const key of keys) {
      let ids = this.pathDocuments.get(key);
      if (!ids) {
        ids = new Set<number>();
        this.pathDocuments.set(key, ids);
      }
      ids.add(document.documentId);
    }
  }

  private removePathIndex(document: IndexedDocument): void {
    for (const key of this.documentPathKeys.get(document.documentId) || []) {
      const ids = this.pathDocuments.get(key);
      ids?.delete(document.documentId);
      if (ids && ids.size === 0) this.pathDocuments.delete(key);
    }
    this.documentPathKeys.delete(document.documentId);
  }

  private scopedDocumentIds(pathPrefix: string, excludePaths: string[]): Set<number> {
    const output = new Set<number>(this.pathDocuments.get(pathPrefix || '') || []);
    for (const exclude of excludePaths) {
      for (const documentId of this.pathDocuments.get(exclude) || []) output.delete(documentId);
    }
    return output;
  }

  private getCorpusStats(
    scopedIds: Set<number>,
    searchContent: boolean,
    searchFrontmatter: boolean,
    pathPrefix: string,
    excludePaths: string[],
  ): CorpusStats {
    const key = JSON.stringify({
      searchContent,
      searchFrontmatter,
      pathPrefix,
      excludePaths: [...excludePaths].sort(),
    });
    const cached = this.corpusStatsCache.get(key);
    if (cached) {
      this.corpusStatsCache.delete(key);
      this.corpusStatsCache.set(key, cached);
      return cached;
    }
    let totalDocLength = 0;
    let docCount = 0;
    for (const documentId of scopedIds) {
      const document = this.documentsById.get(documentId);
      if (!document || !this.pathFilter.isAllowed(document.relativePath) || document.moderationHidden) continue;
      totalDocLength += (searchContent ? document.bodyLength : 0)
        + (searchFrontmatter ? document.frontmatterLength : 0);
      docCount += 1;
    }
    const stats = { docCount, totalDocLength };
    this.corpusStatsCache.set(key, stats);
    while (this.corpusStatsCache.size > CORPUS_STATS_CACHE_MAX_ENTRIES) {
      const oldest = this.corpusStatsCache.keys().next();
      if (oldest.done) break;
      this.corpusStatsCache.delete(oldest.value);
    }
    return stats;
  }

  private async loadText(document: IndexedDocument): Promise<void> {
    if (document.body !== undefined && document.frontmatterText !== undefined) {
      document.lastAccessAt = Date.now();
      return;
    }
    try {
      const content = await readFile(join(this.vaultPath, document.relativePath), 'utf-8');
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      document.body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
      document.frontmatterText = frontmatterMatch?.[1] || '';
      if (!document.textCached) {
        this.indexedTextBytes += document.textBytes;
        document.textCached = true;
      }
      document.lastAccessAt = Date.now();
      this.trimTextCache(document.relativePath);
    } catch {
      document.body = '';
      document.frontmatterText = '';
    }
  }

  private trimTextCache(protectedPath?: string): void {
    if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES) return;
    const loaded = [...this.documents.values()]
      .filter(document => document.body !== undefined || document.frontmatterText !== undefined)
      .filter(document => document.relativePath !== protectedPath)
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
    for (const document of loaded) {
      if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES) break;
      delete document.body;
      delete document.frontmatterText;
      document.textCached = false;
      this.indexedTextBytes -= document.textBytes;
    }
  }

  private candidateIds(
    terms: string[],
    searchContent: boolean,
    searchFrontmatter: boolean,
    caseSensitive: boolean,
    scopedIds: Set<number>,
  ): Set<number> {
    const all = scopedIds;
    if (caseSensitive) return all;
    if (!searchContent && !searchFrontmatter) return this.matchingPostingCandidates(terms, ['title'], all);
    if (terms.some(term => term.length < NGRAM_SIZE)) return all;
    const fields: Array<'body' | 'frontmatter' | 'title'> = ['title'];
    if (searchContent) fields.push('body');
    if (searchFrontmatter) fields.push('frontmatter');
    return this.matchingPostingCandidates(terms, fields, all);
  }

  private matchingPostingCandidates(
    terms: string[],
    fields: Array<'body' | 'frontmatter' | 'title'>,
    all: Set<number>,
  ): Set<number> {
    const output = new Set<number>();
    for (const rawTerm of terms) {
      const term = rawTerm.toLowerCase();
      if (term.length < NGRAM_SIZE) return all;
      for (const field of fields) {
        for (const documentId of this.postingCandidates(field, term)) {
          if (all.has(documentId)) output.add(documentId);
        }
      }
    }
    return output;
  }

  private postingCandidates(field: 'body' | 'frontmatter' | 'title', term: string): Set<number> {
    const termGramIds = [...grams(term)]
      .map(value => this.gramIds.get(value));
    if (termGramIds.some(value => value === undefined)) return new Set();
    const postings = termGramIds
      .map(value => this.postings.get(this.postingKey(field, value!)))
      .filter((value): value is Set<number> => Boolean(value))
      .sort((a, b) => a.size - b.size);
    if (postings.length !== termGramIds.length || !postings[0]) return new Set();
    const output = new Set(postings[0]);
    for (const paths of postings.slice(1)) {
      for (const path of output) if (!paths.has(path)) output.delete(path);
    }
    return output;
  }

  private async findMarkdownFiles(dirPath: string): Promise<string[]> {
    const cached = this.directoryCache.get(dirPath);
    if (cached && cached.expiresAt > Date.now()) return cached.paths;
    if (cached) this.directoryCache.delete(dirPath);
    const markdownFiles: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findMarkdownFiles(fullPath);
          markdownFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          markdownFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }

    this.directoryCache.set(dirPath, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, paths: markdownFiles });
    return markdownFiles;
  }

  private rerank(
    candidates: RankCandidate[],
    terms: string[],
    termDocFreq: Map<string, number>,
    docCount: number,
    totalDocLength: number,
    maxLimit: number
  ): SearchResult[] {
    const avgdl = docCount > 0 ? totalDocLength / docCount : 1;
    const k1 = 1.2;
    const b = 0.75;
    const idfByTerm = new Map(terms.map(term => {
      const df = termDocFreq.get(term) || 0;
      return [term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5))] as const;
    }));
    type ScoredCandidate = { score: number; result: SearchResult; wiki: boolean; index: number };
    const scoreCandidate = (c: RankCandidate, index: number): ScoredCandidate => {
      let score = 0;
      for (const term of terms) {
        const tf = c.termFreqs.get(term) || 0;
        const idf = idfByTerm.get(term) || 0;
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.docLength / avgdl));
      }
      return { score, result: c.result, wiki: c.wiki, index };
    };

    const compare = (a: ScoredCandidate, b: ScoredCandidate) =>
      Number(b.wiki) - Number(a.wiki) || b.score - a.score || a.index - b.index;
    function* scoreStream(): IterableIterator<ScoredCandidate> {
      let index = 0;
      for (const candidate of candidates) yield scoreCandidate(candidate, index++);
    }
    return boundedTopK(scoreStream(), maxLimit, compare).map(s => s.result);
  }
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function grams(value: string): Set<string> {
  const output = new Set<string>();
  for (let index = 0; index <= value.length - NGRAM_SIZE; index += 1) {
    output.add(value.slice(index, index + NGRAM_SIZE));
  }
  return output;
}
