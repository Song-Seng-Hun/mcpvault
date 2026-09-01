import { join, resolve } from 'path';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { generateObsidianUri } from './uri.js';
import { boundSearchResults, boundedTopK, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
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
const DIRECTORY_CACHE_MAX_ENTRIES = 1_024;
const CORPUS_STATS_CACHE_MAX_ENTRIES = 64;
const GRAM_COMPACTION_MIN_ENTRIES = 4_096;
const GRAM_COMPACTION_MIN_STALE_ENTRIES = 1_024;
const GRAM_COMPACTION_STALE_RATIO = 0.25;
const gunzipAsync = promisify(gunzip);
const SNAPSHOT_MAGIC = Buffer.from('MCPVSRCH', 'ascii');
const MAX_SNAPSHOT_ENTRIES = 1_000_000;
function encodeSnapshotString(value) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([length, bytes]);
}
function encodeSnapshot(snapshot) {
    const chunks = [SNAPSHOT_MAGIC];
    const header = Buffer.allocUnsafe(12);
    header.writeUInt32LE(SEARCH_SNAPSHOT_VERSION, 0);
    header.writeUInt32LE(snapshot.documents.length, 4);
    header.writeUInt32LE(snapshot.grams.length, 8);
    chunks.push(header);
    for (const value of snapshot.grams)
        chunks.push(encodeSnapshotString(value));
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
function decodeSnapshot(buffer) {
    if (buffer.length < SNAPSHOT_MAGIC.length + 12 || !buffer.subarray(0, SNAPSHOT_MAGIC.length).equals(SNAPSHOT_MAGIC))
        return undefined;
    let offset = SNAPSHOT_MAGIC.length;
    const version = buffer.readUInt32LE(offset);
    offset += 4;
    const count = buffer.readUInt32LE(offset);
    offset += 4;
    const gramCount = buffer.readUInt32LE(offset);
    offset += 4;
    if (version !== SEARCH_SNAPSHOT_VERSION || count > MAX_SNAPSHOT_ENTRIES)
        return undefined;
    const readString = () => {
        if (offset + 4 > buffer.length)
            return undefined;
        const length = buffer.readUInt32LE(offset);
        offset += 4;
        if (length > buffer.length - offset)
            return undefined;
        const value = buffer.toString('utf8', offset, offset + length);
        offset += length;
        return value;
    };
    const grams = [];
    if (gramCount > MAX_SNAPSHOT_ENTRIES)
        return undefined;
    for (let index = 0; index < gramCount; index += 1) {
        const value = readString();
        if (value === undefined)
            return undefined;
        grams.push(value);
    }
    const readGramIds = (count) => {
        if (count > MAX_SNAPSHOT_ENTRIES)
            return undefined;
        if (offset + count * 4 > buffer.length)
            return undefined;
        const values = [];
        for (let index = 0; index < count; index += 1) {
            const value = buffer.readUInt32LE(offset);
            offset += 4;
            if (value === 0 || value > grams.length)
                return undefined;
            values.push(value);
        }
        return values;
    };
    const documents = [];
    for (let index = 0; index < count; index += 1) {
        const relativePath = readString();
        const title = readString();
        if (relativePath === undefined || title === undefined || offset + 1 > buffer.length)
            return undefined;
        const flags = buffer[offset];
        offset += 1;
        const revisionValue = readString();
        if (revisionValue === undefined || offset + 40 > buffer.length)
            return undefined;
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
        if (!bodyGramIds || !frontmatterGramIds || !titleGramIds)
            return undefined;
        documents.push({ relativePath, title, isWiki: (flags & 1) !== 0, moderationHidden: (flags & 2) !== 0, revision: revisionValue, size, mtimeMs, bodyLength, frontmatterLength, textBytes, bodyGramIds, frontmatterGramIds, titleGramIds });
    }
    return offset === buffer.length ? { version, grams, documents } : undefined;
}
function isWikiPath(path) {
    const normalized = path.toLowerCase();
    return normalized === '_wiki'
        || normalized.startsWith('_wiki/')
        || normalized === '_sources'
        || normalized.startsWith('_sources/')
        || /^_scopes\/(models|agents)\/[^/]+\/(?:_wiki|_sources)(?:\/|$)/.test(normalized);
}
function revision(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function wikiType(content) {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const value = frontmatter?.match(/^\s*llm_wiki_type\s*:\s*['"]?([a-z_-]+)['"]?\s*$/im)?.[1]?.toLowerCase();
    return value && WIKI_TYPES.has(value) ? value : undefined;
}
/** Normalize a subtree path: forward slashes, no leading/trailing slashes. */
function normalizeSubtree(p) {
    return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
export class SearchService {
    pathFilter;
    catalog;
    vaultIo;
    cacheOwner = createDerivedCacheOwner('search.results');
    directoryCacheOwner = createDerivedCacheOwner('search.directories');
    corpusCacheOwner = createDerivedCacheOwner('search.corpus');
    vaultPath;
    cache = new Map();
    inFlight = new Map();
    documents = new Map();
    documentsById = new Map();
    dirtyDocuments = new Set();
    postings = new Map();
    gramIds = new Map();
    gramsById = [''];
    gramUsage = new Map();
    pathDocuments = new Map();
    documentPathKeys = new Map();
    corpusStatsCache = new Map();
    directoryCache = new Map();
    nextDocumentId = 1;
    indexedTextBytes = 0;
    cacheGeneration = 0;
    indexReady;
    snapshotReady;
    indexRefresh;
    snapshotTimer;
    snapshotWrite;
    snapshotPending = false;
    snapshotSavedGeneration = -1;
    indexGeneration = 0;
    watcher;
    catalogUnsubscribe;
    lastIndexReconcileAt = 0;
    needsFullReconcile = true;
    constructor(vaultPath, pathFilter, catalog, vaultIo = new VaultIoCoordinator()) {
        this.pathFilter = pathFilter;
        this.catalog = catalog;
        this.vaultIo = vaultIo;
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
    invalidate(path, kind = 'upsert') {
        this.cacheGeneration += 1;
        this.cache.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        this.directoryCache.clear();
        derivedCacheBudget.clearOwner(this.directoryCacheOwner);
        if (path) {
            const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            if (kind === 'delete') {
                this.removeDocument(normalized);
                this.maybeCompactGramDictionary();
            }
            else
                this.dirtyDocuments.add(normalized);
        }
        else
            this.needsFullReconcile = true;
    }
    close() {
        this.catalogUnsubscribe?.();
        this.watcher?.close();
        this.watcher = undefined;
        this.directoryCache.clear();
        derivedCacheBudget.clearOwner(this.cacheOwner);
        derivedCacheBudget.clearOwner(this.directoryCacheOwner);
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
    }
    async loadSnapshot() {
        try {
            const binary = await readFile(join(this.vaultPath, SEARCH_SNAPSHOT_FILE));
            const parsed = decodeSnapshot(binary);
            if (parsed)
                this.restoreSnapshot(parsed);
            return;
        }
        catch {
            // Try the previous compressed-JSON format for a one-release migration.
        }
        try {
            const raw = await gunzipAsync(await readFile(join(this.vaultPath, LEGACY_SEARCH_SNAPSHOT_FILE)));
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed.version === SEARCH_SNAPSHOT_VERSION && Array.isArray(parsed.documents))
                this.restoreSnapshot(parsed);
        }
        catch {
            // A missing, corrupt, or old snapshot is harmless; refreshAll rebuilds
            // the derived index from Markdown and replaces it atomically.
        }
    }
    restoreSnapshot(snapshot) {
        if (snapshot.documents.length > MAX_SNAPSHOT_ENTRIES)
            return;
        for (const value of snapshot.grams) {
            if (typeof value !== 'string' || value.length === 0 || this.gramIds.has(value))
                continue;
            const id = this.gramsById.length;
            this.gramIds.set(value, id);
            this.gramsById.push(value);
        }
        for (const item of snapshot.documents) {
            if (!item || typeof item !== 'object')
                continue;
            const relativePath = normalizeSubtree(String(item.relativePath || ''));
            if (!relativePath || !this.pathFilter.isAllowed(relativePath))
                continue;
            if (!Array.isArray(item.bodyGramIds) || !Array.isArray(item.frontmatterGramIds) || !Array.isArray(item.titleGramIds))
                continue;
            if (![item.size, item.mtimeMs, item.bodyLength, item.frontmatterLength, item.textBytes].every(value => typeof value === 'number' && Number.isFinite(value)))
                continue;
            const document = {
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
        this.snapshotSavedGeneration = this.indexGeneration;
    }
    scheduleSnapshotSave() {
        this.snapshotPending = true;
        if (this.snapshotTimer)
            return;
        this.snapshotTimer = setTimeout(() => {
            this.snapshotTimer = undefined;
            void this.flushSnapshot();
        }, SNAPSHOT_SAVE_DEBOUNCE_MS);
        this.snapshotTimer.unref?.();
    }
    async flushSnapshot() {
        if (this.snapshotWrite)
            return;
        if (!this.snapshotPending)
            return;
        this.snapshotPending = false;
        if (this.snapshotSavedGeneration === this.indexGeneration)
            return;
        const generation = this.indexGeneration;
        const snapshot = {
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
            this.snapshotSavedGeneration = generation;
        })().catch(() => {
            // The snapshot is an optional acceleration cache. Search correctness
            // must never depend on being able to write it (for example on NAS).
        });
        try {
            await this.snapshotWrite;
        }
        finally {
            this.snapshotWrite = undefined;
            if (this.snapshotPending)
                this.scheduleSnapshotSave();
        }
    }
    async search(params) {
        const { query, limit = 5, searchContent = true, searchFrontmatter = false, caseSensitive = false, pathPrefix, excludePaths } = params;
        if (!query || query.trim().length === 0) {
            throw new Error('Search query cannot be empty');
        }
        const normalizedQuery = query.trim();
        const normalizedPrefix = pathPrefix ? normalizeSubtree(pathPrefix) : '';
        const normalizedExcludes = (excludePaths || []).map(normalizeSubtree).filter(Boolean).sort();
        const cacheKey = JSON.stringify({
            query: normalizedQuery,
            limit,
            searchContent,
            searchFrontmatter,
            caseSensitive,
            pathPrefix: normalizedPrefix,
            excludePaths: normalizedExcludes,
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
        if (running)
            return (await running).map(result => ({ ...result }));
        const generation = this.cacheGeneration;
        const computation = (async () => {
            await this.ensureIndex();
            const maxLimit = normalizeSearchLimit(limit);
            const maxChars = normalizeSearchMaxChars(params.maxChars);
            // Corpus stats for reranking. Lengths are prepared during indexing, and
            // the bounded cache lets different queries reuse the same scope stats.
            const termDocFreq = new Map();
            const candidates = [];
            const searchQuery = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();
            const terms = searchQuery.split(/\s+/).filter(t => t.length > 0);
            const scoringTerms = terms.length > 1 ? [...terms, searchQuery] : terms;
            // The server-owned document index has already performed the filesystem
            // reads. Search only the visible in-memory documents on this pass.
            const scopedDocumentIds = this.scopedDocumentIds(normalizedPrefix, normalizedExcludes);
            const corpusStats = this.getCorpusStats(scopedDocumentIds, searchContent, searchFrontmatter, normalizedPrefix, normalizedExcludes);
            const { totalDocLength, docCount } = corpusStats;
            const candidateIds = this.candidateIds(terms, searchContent, searchFrontmatter, caseSensitive, scopedDocumentIds);
            for (const documentId of candidateIds) {
                const document = this.documentsById.get(documentId);
                if (!document || !this.pathFilter.isAllowed(document.relativePath))
                    continue;
                if (document.moderationHidden)
                    continue;
                const { relativePath } = document;
                let searchableText = '';
                // Prepare search text based on options
                if (searchContent || searchFrontmatter)
                    await this.loadText(document);
                if (searchContent && searchFrontmatter) {
                    searchableText = `${document.frontmatterText || ''}\n${document.body || ''}`;
                }
                else if (searchContent) {
                    searchableText = document.body || '';
                }
                else if (searchFrontmatter) {
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
                    let excerpt;
                    let matchCount = 0;
                    let lineNumber = 0;
                    const termFreqs = new Map();
                    if (firstIndex !== -1) {
                        // Find the term that matched first for excerpt
                        const firstTermIdx = termIndices.indexOf(firstIndex);
                        const firstTerm = terms[firstTermIdx];
                        // Extract excerpt around first content match
                        const excerptStart = Math.max(0, firstIndex - 21);
                        const excerptEnd = Math.min(searchableText.length, firstIndex + firstTerm.length + 21);
                        excerpt = searchableText.slice(excerptStart, excerptEnd).trim();
                        // Add ellipsis if excerpt is truncated
                        if (excerptStart > 0)
                            excerpt = '...' + excerpt;
                        if (excerptEnd < searchableText.length)
                            excerpt = excerpt + '...';
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
                    }
                    else {
                        // Filename-only match: use beginning of content as excerpt
                        excerpt = searchableText.slice(0, 50).trim();
                        if (searchableText.length > 50)
                            excerpt = excerpt + '...';
                        matchCount = 0;
                        lineNumber = 0;
                    }
                    // Add filename match to count
                    if (filenameMatch)
                        matchCount++;
                    candidates.push({
                        result: {
                            p: relativePath,
                            t: title,
                            ex: excerpt,
                            mc: matchCount,
                            ln: lineNumber,
                            uri: generateObsidianUri(this.vaultPath, relativePath),
                            ...(document.isWiki && { wk: true }),
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
                const entry = { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results: cachedResults };
                this.cache.set(cacheKey, entry);
                derivedCacheBudget.register(this.cacheOwner, cacheKey, estimateCacheBytes(cachedResults) + Buffer.byteLength(cacheKey, 'utf8') + 128, () => {
                    if (this.cache.get(cacheKey) === entry)
                        this.cache.delete(cacheKey);
                });
                while (this.cache.size > SEARCH_CACHE_MAX_ENTRIES) {
                    const oldest = this.cache.keys().next();
                    if (oldest.done)
                        break;
                    this.cache.delete(oldest.value);
                    derivedCacheBudget.remove(this.cacheOwner, oldest.value);
                }
            }
            return results;
        })();
        this.inFlight.set(cacheKey, computation);
        try {
            return await computation;
        }
        finally {
            if (this.inFlight.get(cacheKey) === computation)
                this.inFlight.delete(cacheKey);
        }
    }
    async ensureIndex() {
        this.startWatcher();
        await this.snapshotReady;
        if (!this.indexReady)
            this.indexReady = this.refreshAll();
        await this.indexReady;
        if (this.dirtyDocuments.size > 0)
            await this.refreshDirty();
        const interval = this.watcher ? INDEX_RECONCILE_INTERVAL_MS : NO_WATCHER_RECONCILE_INTERVAL_MS;
        if (this.needsFullReconcile || Date.now() - this.lastIndexReconcileAt >= interval)
            await this.refreshAll();
    }
    startWatcher() {
        if (this.catalog)
            return;
        if (this.watcher)
            return;
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
                this.directoryCache.clear();
                derivedCacheBudget.clearOwner(this.directoryCacheOwner);
                if (!filename) {
                    this.needsFullReconcile = true;
                    return;
                }
                const normalized = String(filename).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
                if (/\.md$/i.test(normalized) && this.pathFilter.isAllowed(normalized)) {
                    this.dirtyDocuments.add(normalized);
                }
                else
                    this.needsFullReconcile = true;
            });
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
                this.needsFullReconcile = true;
            });
            this.watcher.unref?.();
        }
        catch {
            // Network mounts and some Windows filesystems do not support recursive
            // watchers. The shorter reconciliation interval remains authoritative.
            this.watcher = undefined;
        }
    }
    async refreshAll() {
        if (this.indexRefresh)
            return this.indexRefresh;
        this.indexRefresh = (async () => {
            const paths = this.catalog
                ? (await this.catalog.notePathsSnapshot()).filter(path => path.toLowerCase().endsWith('.md')).map(path => join(this.vaultPath, path))
                : await this.findMarkdownFiles(this.vaultPath);
            const next = new Map();
            for (let start = 0; start < paths.length; start += INDEX_READ_BATCH_SIZE) {
                const batch = paths.slice(start, start + INDEX_READ_BATCH_SIZE);
                const documents = await Promise.all(batch.map(fullPath => {
                    const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
                    return this.readIndexedDocument(fullPath, this.documents.get(relativePath));
                }));
                for (const document of documents) {
                    if (document)
                        next.set(document.relativePath, document);
                }
            }
            for (const path of this.documents.keys()) {
                if (!next.has(path))
                    this.removeDocument(path);
            }
            for (const document of next.values())
                this.setDocument(document);
            this.maybeCompactGramDictionary();
            this.dirtyDocuments.clear();
            this.needsFullReconcile = false;
            this.lastIndexReconcileAt = Date.now();
            this.trimTextCache();
            this.scheduleSnapshotSave();
        })();
        try {
            await this.indexRefresh;
        }
        finally {
            this.indexRefresh = undefined;
        }
    }
    async refreshDirty() {
        if (this.indexRefresh)
            return this.indexRefresh;
        this.indexRefresh = (async () => {
            const paths = [...this.dirtyDocuments];
            this.dirtyDocuments.clear();
            const documents = await Promise.all(paths.map(path => this.readIndexedDocument(join(this.vaultPath, path))));
            for (let index = 0; index < paths.length; index += 1) {
                const path = paths[index];
                const document = documents[index];
                if (document)
                    this.setDocument(document);
                else
                    this.removeDocument(path);
            }
            this.maybeCompactGramDictionary();
            this.trimTextCache();
            this.scheduleSnapshotSave();
        })();
        try {
            await this.indexRefresh;
        }
        finally {
            this.indexRefresh = undefined;
        }
    }
    async readIndexedDocument(fullPath, existing) {
        const relativePath = fullPath.substring(this.vaultPath.length + 1).replace(/\\/g, '/');
        if (!this.pathFilter.isAllowed(relativePath))
            return undefined;
        try {
            const info = await stat(fullPath);
            if (!info.isFile())
                return undefined;
            if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs)
                return existing;
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
        }
        catch {
            return undefined;
        }
    }
    gramIdsForText(value) {
        const output = new Set();
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
    postingKey(field, gram) {
        return `${field}\u0000${gram}`;
    }
    updatePostings(document, add) {
        const fields = [
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
                        paths = new Set();
                        this.postings.set(key, paths);
                    }
                    paths.add(document.documentId);
                }
                else {
                    const paths = this.postings.get(key);
                    paths?.delete(document.documentId);
                    if (paths && paths.size === 0)
                        this.postings.delete(key);
                }
            }
        }
    }
    updateGramUsage(document, add) {
        for (const values of [document.bodyGrams, document.frontmatterGrams, document.titleGrams]) {
            for (const value of values) {
                const next = (this.gramUsage.get(value) || 0) + (add ? 1 : -1);
                if (next > 0)
                    this.gramUsage.set(value, next);
                else
                    this.gramUsage.delete(value);
            }
        }
    }
    maybeCompactGramDictionary() {
        const total = this.gramIds.size;
        const live = this.gramUsage.size;
        const stale = total - live;
        if (total < GRAM_COMPACTION_MIN_ENTRIES
            || stale < GRAM_COMPACTION_MIN_STALE_ENTRIES
            || stale / total < GRAM_COMPACTION_STALE_RATIO)
            return;
        const remap = new Map();
        const nextGrams = [''];
        const nextIds = new Map();
        for (const [gram, oldId] of this.gramIds) {
            if (!this.gramUsage.has(oldId))
                continue;
            const nextId = nextGrams.length;
            remap.set(oldId, nextId);
            nextIds.set(gram, nextId);
            nextGrams.push(gram);
        }
        for (const document of this.documents.values()) {
            document.bodyGrams = this.remapGramSet(document.bodyGrams, remap);
            document.frontmatterGrams = this.remapGramSet(document.frontmatterGrams, remap);
            document.titleGrams = this.remapGramSet(document.titleGrams, remap);
        }
        this.gramIds.clear();
        for (const [gram, id] of nextIds)
            this.gramIds.set(gram, id);
        this.gramsById.splice(0, this.gramsById.length, ...nextGrams);
        this.postings.clear();
        this.gramUsage.clear();
        for (const document of this.documents.values()) {
            this.updatePostings(document, true);
            this.updateGramUsage(document, true);
        }
    }
    remapGramSet(values, remap) {
        const next = new Set();
        for (const value of values) {
            const mapped = remap.get(value);
            if (mapped !== undefined)
                next.add(mapped);
        }
        return next;
    }
    setDocument(document) {
        const old = this.documents.get(document.relativePath);
        if (old === document)
            return;
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        if (old) {
            this.updatePostings(old, false);
            this.updateGramUsage(old, false);
            this.removePathIndex(old);
            this.documentsById.delete(old.documentId);
            if (old.textCached)
                this.indexedTextBytes -= old.textBytes;
        }
        this.documents.set(document.relativePath, document);
        this.documentsById.set(document.documentId, document);
        this.updatePostings(document, true);
        this.updateGramUsage(document, true);
        this.addPathIndex(document);
        if (document.textCached)
            this.indexedTextBytes += document.textBytes;
        this.indexGeneration += 1;
    }
    removeDocument(path) {
        const document = this.documents.get(path);
        if (!document)
            return;
        this.corpusStatsCache.clear();
        derivedCacheBudget.clearOwner(this.corpusCacheOwner);
        this.updatePostings(document, false);
        this.updateGramUsage(document, false);
        this.removePathIndex(document);
        this.documentsById.delete(document.documentId);
        if (document.textCached)
            this.indexedTextBytes -= document.textBytes;
        this.documents.delete(path);
        this.indexGeneration += 1;
    }
    pathKeys(path) {
        const parts = path.split('/');
        const keys = [''];
        for (let index = 1; index <= parts.length; index += 1)
            keys.push(parts.slice(0, index).join('/'));
        return keys;
    }
    addPathIndex(document) {
        const keys = this.pathKeys(document.relativePath);
        this.documentPathKeys.set(document.documentId, keys);
        for (const key of keys) {
            let ids = this.pathDocuments.get(key);
            if (!ids) {
                ids = new Set();
                this.pathDocuments.set(key, ids);
            }
            ids.add(document.documentId);
        }
    }
    removePathIndex(document) {
        for (const key of this.documentPathKeys.get(document.documentId) || []) {
            const ids = this.pathDocuments.get(key);
            ids?.delete(document.documentId);
            if (ids && ids.size === 0)
                this.pathDocuments.delete(key);
        }
        this.documentPathKeys.delete(document.documentId);
    }
    scopedDocumentIds(pathPrefix, excludePaths) {
        const base = this.pathDocuments.get(pathPrefix || '');
        if (!base || excludePaths.length === 0)
            return base || new Set();
        const output = new Set(base);
        for (const exclude of excludePaths) {
            for (const documentId of this.pathDocuments.get(exclude) || [])
                output.delete(documentId);
        }
        return output;
    }
    getCorpusStats(scopedIds, searchContent, searchFrontmatter, pathPrefix, excludePaths) {
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
            derivedCacheBudget.touch(this.corpusCacheOwner, key);
            return cached;
        }
        let totalDocLength = 0;
        let docCount = 0;
        for (const documentId of scopedIds) {
            const document = this.documentsById.get(documentId);
            if (!document || !this.pathFilter.isAllowed(document.relativePath) || document.moderationHidden)
                continue;
            totalDocLength += (searchContent ? document.bodyLength : 0)
                + (searchFrontmatter ? document.frontmatterLength : 0);
            docCount += 1;
        }
        const stats = { docCount, totalDocLength };
        this.corpusStatsCache.set(key, stats);
        derivedCacheBudget.register(this.corpusCacheOwner, key, estimateCacheBytes(stats) + Buffer.byteLength(key, 'utf8') + 64, () => {
            if (this.corpusStatsCache.get(key) !== stats)
                return;
            this.corpusStatsCache.delete(key);
        });
        while (this.corpusStatsCache.size > CORPUS_STATS_CACHE_MAX_ENTRIES) {
            const oldest = this.corpusStatsCache.keys().next();
            if (oldest.done)
                break;
            this.corpusStatsCache.delete(oldest.value);
            derivedCacheBudget.remove(this.corpusCacheOwner, oldest.value);
        }
        return stats;
    }
    async loadText(document) {
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
        }
        catch {
            document.body = '';
            document.frontmatterText = '';
        }
    }
    trimTextCache(protectedPath) {
        if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES)
            return;
        const loaded = [...this.documents.values()]
            .filter(document => document.body !== undefined || document.frontmatterText !== undefined)
            .filter(document => document.relativePath !== protectedPath)
            .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
        for (const document of loaded) {
            if (this.indexedTextBytes <= MAX_INDEXED_TEXT_BYTES)
                break;
            delete document.body;
            delete document.frontmatterText;
            document.textCached = false;
            this.indexedTextBytes -= document.textBytes;
        }
    }
    candidateIds(terms, searchContent, searchFrontmatter, caseSensitive, scopedIds) {
        const all = scopedIds;
        if (caseSensitive)
            return all;
        if (!searchContent && !searchFrontmatter)
            return this.matchingPostingCandidates(terms, ['title'], all);
        if (terms.some(term => term.length < NGRAM_SIZE))
            return all;
        const fields = ['title'];
        if (searchContent)
            fields.push('body');
        if (searchFrontmatter)
            fields.push('frontmatter');
        return this.matchingPostingCandidates(terms, fields, all);
    }
    matchingPostingCandidates(terms, fields, all) {
        const output = new Set();
        for (const rawTerm of terms) {
            const term = rawTerm.toLowerCase();
            if (term.length < NGRAM_SIZE)
                return all;
            for (const field of fields) {
                for (const documentId of this.postingCandidates(field, term)) {
                    if (all.has(documentId))
                        output.add(documentId);
                }
            }
        }
        return output;
    }
    postingCandidates(field, term) {
        const termGramIds = [];
        for (const value of grams(term)) {
            const gramId = this.gramIds.get(value);
            if (gramId === undefined)
                return new Set();
            termGramIds.push(gramId);
        }
        const postings = [];
        for (const gramId of termGramIds) {
            const posting = this.postings.get(this.postingKey(field, gramId));
            if (!posting)
                return new Set();
            postings.push(posting);
        }
        postings.sort((a, b) => a.size - b.size);
        const first = postings[0];
        if (!first)
            return new Set();
        const output = new Set(first);
        for (let index = 1; index < postings.length; index += 1) {
            const posting = postings[index];
            for (const documentId of output)
                if (!posting.has(documentId))
                    output.delete(documentId);
            if (output.size === 0)
                break;
        }
        return output;
    }
    async findMarkdownFiles(dirPath) {
        const cached = this.directoryCache.get(dirPath);
        if (cached && cached.expiresAt > Date.now()) {
            this.directoryCache.delete(dirPath);
            this.directoryCache.set(dirPath, cached);
            derivedCacheBudget.touch(this.directoryCacheOwner, dirPath);
            return cached.paths;
        }
        if (cached) {
            this.directoryCache.delete(dirPath);
            derivedCacheBudget.remove(this.directoryCacheOwner, dirPath);
        }
        const markdownFiles = [];
        try {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    // Recursively search subdirectories
                    const subFiles = await this.findMarkdownFiles(fullPath);
                    markdownFiles.push(...subFiles);
                }
                else if (entry.isFile() && entry.name.endsWith('.md')) {
                    markdownFiles.push(fullPath);
                }
            }
        }
        catch (error) {
            // Skip directories that can't be read
        }
        const entry = { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, paths: markdownFiles };
        this.directoryCache.set(dirPath, entry);
        derivedCacheBudget.register(this.directoryCacheOwner, dirPath, estimateCacheBytes(entry) + 64, () => {
            if (this.directoryCache.get(dirPath) !== entry)
                return;
            this.directoryCache.delete(dirPath);
        });
        while (this.directoryCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
            const oldest = this.directoryCache.keys().next();
            if (oldest.done)
                break;
            this.directoryCache.delete(oldest.value);
            derivedCacheBudget.remove(this.directoryCacheOwner, oldest.value);
        }
        return markdownFiles;
    }
    rerank(candidates, terms, termDocFreq, docCount, totalDocLength, maxLimit) {
        const avgdl = docCount > 0 ? totalDocLength / docCount : 1;
        const k1 = 1.2;
        const b = 0.75;
        const idfByTerm = new Map(terms.map(term => {
            const df = termDocFreq.get(term) || 0;
            return [term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5))];
        }));
        const scoreCandidate = (c, index) => {
            let score = 0;
            for (const term of terms) {
                const tf = c.termFreqs.get(term) || 0;
                const idf = idfByTerm.get(term) || 0;
                score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.docLength / avgdl));
            }
            return { score, result: c.result, wiki: c.wiki, index };
        };
        const compare = (a, b) => Number(b.wiki) - Number(a.wiki) || b.score - a.score || a.index - b.index;
        function* scoreStream() {
            let index = 0;
            for (const candidate of candidates)
                yield scoreCandidate(candidate, index++);
        }
        return boundedTopK(scoreStream(), maxLimit, compare).map(s => s.result);
    }
}
function countWords(value) {
    return value.split(/\s+/).filter(Boolean).length;
}
function grams(value) {
    const output = new Set();
    for (let index = 0; index <= value.length - NGRAM_SIZE; index += 1) {
        output.add(value.slice(index, index + NGRAM_SIZE));
    }
    return output;
}
