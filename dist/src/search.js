import { join, resolve } from 'path';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { generateObsidianUri } from './uri.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
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
const SEARCH_SNAPSHOT_VERSION = 1;
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
    const header = Buffer.allocUnsafe(8);
    header.writeUInt32LE(SEARCH_SNAPSHOT_VERSION, 0);
    header.writeUInt32LE(snapshot.documents.length, 4);
    chunks.push(header);
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
        numbers.writeUInt32LE(document.bodyGrams.length, 28);
        numbers.writeUInt32LE(document.frontmatterGrams.length, 32);
        numbers.writeUInt32LE(document.titleGrams.length, 36);
        chunks.push(numbers);
        for (const values of [document.bodyGrams, document.frontmatterGrams, document.titleGrams]) {
            for (const value of values)
                chunks.push(encodeSnapshotString(value));
        }
    }
    return Buffer.concat(chunks);
}
function decodeSnapshot(buffer) {
    if (buffer.length < SNAPSHOT_MAGIC.length + 8 || !buffer.subarray(0, SNAPSHOT_MAGIC.length).equals(SNAPSHOT_MAGIC))
        return undefined;
    let offset = SNAPSHOT_MAGIC.length;
    const version = buffer.readUInt32LE(offset);
    offset += 4;
    const count = buffer.readUInt32LE(offset);
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
    const readGrams = (count) => {
        if (count > MAX_SNAPSHOT_ENTRIES)
            return undefined;
        const values = [];
        for (let index = 0; index < count; index += 1) {
            const value = readString();
            if (value === undefined)
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
        const bodyGrams = readGrams(bodyGramCount);
        const frontmatterGrams = readGrams(frontmatterGramCount);
        const titleGrams = readGrams(titleGramCount);
        if (!bodyGrams || !frontmatterGrams || !titleGrams)
            return undefined;
        documents.push({ relativePath, title, isWiki: (flags & 1) !== 0, moderationHidden: (flags & 2) !== 0, revision: revisionValue, size, mtimeMs, bodyLength, frontmatterLength, textBytes, bodyGrams, frontmatterGrams, titleGrams });
    }
    return offset === buffer.length ? { version, documents } : undefined;
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
/** True if a vault-relative path is the subtree itself or sits under it. */
function isUnderSubtree(relativePath, subtree) {
    if (!subtree)
        return false;
    return relativePath === subtree || relativePath.startsWith(subtree + '/');
}
export class SearchService {
    pathFilter;
    vaultPath;
    cache = new Map();
    inFlight = new Map();
    documents = new Map();
    dirtyDocuments = new Set();
    postings = new Map();
    nextDocumentId = 1;
    indexedTextBytes = 0;
    cacheGeneration = 0;
    indexReady;
    snapshotReady;
    indexRefresh;
    watcher;
    lastIndexReconcileAt = 0;
    needsFullReconcile = true;
    constructor(vaultPath, pathFilter) {
        this.pathFilter = pathFilter;
        this.vaultPath = resolve(vaultPath);
        this.snapshotReady = this.loadSnapshot();
    }
    /**
     * Search is derived from Markdown, so a short cache is safe and useful for
     * repeated agent lookups. Writers call this immediately after a mutation;
     * the TTL also covers edits made directly in Obsidian.
     */
    invalidate(path, kind = 'upsert') {
        this.cacheGeneration += 1;
        this.cache.clear();
        if (path) {
            const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            if (kind === 'delete')
                this.removeDocument(normalized);
            else
                this.dirtyDocuments.add(normalized);
        }
        else
            this.needsFullReconcile = true;
    }
    close() {
        this.watcher?.close();
        this.watcher = undefined;
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
        for (const item of snapshot.documents) {
            if (!item || typeof item !== 'object')
                continue;
            const relativePath = normalizeSubtree(String(item.relativePath || ''));
            if (!relativePath || !this.pathFilter.isAllowed(relativePath))
                continue;
            if (!Array.isArray(item.bodyGrams) || !Array.isArray(item.frontmatterGrams) || !Array.isArray(item.titleGrams))
                continue;
            if (![item.size, item.mtimeMs, item.bodyLength, item.frontmatterLength, item.textBytes].every(value => typeof value === 'number' && Number.isFinite(value)))
                continue;
            const document = {
                fullPath: join(this.vaultPath, relativePath),
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
                bodyGrams: new Set(item.bodyGrams.filter(value => typeof value === 'string')),
                frontmatterGrams: new Set(item.frontmatterGrams.filter(value => typeof value === 'string')),
                titleGrams: new Set(item.titleGrams.filter(value => typeof value === 'string')),
            };
            this.setDocument(document);
        }
    }
    async saveSnapshot() {
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
                bodyGrams: [...document.bodyGrams],
                frontmatterGrams: [...document.frontmatterGrams],
                titleGrams: [...document.titleGrams],
            })),
        };
        try {
            const snapshotPath = join(this.vaultPath, SEARCH_SNAPSHOT_FILE);
            await mkdir(join(this.vaultPath, '.mcpvault'), { recursive: true });
            const encoded = encodeSnapshot(snapshot);
            const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
            await writeFile(temporaryPath, encoded);
            await rename(temporaryPath, snapshotPath);
        }
        catch {
            // The snapshot is an optional acceleration cache. Search correctness
            // must never depend on being able to write it (for example on NAS).
        }
    }
    async search(params) {
        const { query, limit = 5, searchContent = true, searchFrontmatter = false, caseSensitive = false, pathPrefix, excludePaths } = params;
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
            return cached.results.map(result => ({ ...result }));
        }
        if (cached)
            this.cache.delete(cacheKey);
        const running = this.inFlight.get(cacheKey);
        if (running)
            return (await running).map(result => ({ ...result }));
        const generation = this.cacheGeneration;
        const computation = (async () => {
            await this.ensureIndex();
            const normalizedPrefix = pathPrefix ? normalizeSubtree(pathPrefix) : '';
            const normalizedExcludes = (excludePaths || []).map(normalizeSubtree).filter(Boolean);
            const maxLimit = normalizeSearchLimit(limit);
            const maxChars = normalizeSearchMaxChars(params.maxChars);
            // Corpus stats for reranking. Lengths are prepared during indexing, so a
            // cache miss does not split every note into words again.
            let totalDocLength = 0;
            let docCount = 0;
            const termDocFreq = new Map();
            const candidates = [];
            const searchQuery = caseSensitive ? query : query.toLowerCase();
            const terms = searchQuery.split(/\s+/).filter(t => t.length > 0);
            const scoringTerms = terms.length > 1 ? [...terms, searchQuery] : terms;
            // The server-owned document index has already performed the filesystem
            // reads. Search only the visible in-memory documents on this pass.
            const prefixLen = this.vaultPath.length + 1;
            const allowedFiles = [];
            for (const document of this.documents.values()) {
                const relativePath = document.fullPath.substring(prefixLen).replace(/\\/g, '/');
                if (!this.pathFilter.isAllowed(relativePath))
                    continue;
                // Scope to the requested subtree, and skip excluded subtrees, before I/O
                if (normalizedPrefix && !isUnderSubtree(relativePath, normalizedPrefix))
                    continue;
                if (normalizedExcludes.some(ex => isUnderSubtree(relativePath, ex)))
                    continue;
                if (document.moderationHidden)
                    continue;
                allowedFiles.push(document);
                totalDocLength += (searchContent ? document.bodyLength : 0)
                    + (searchFrontmatter ? document.frontmatterLength : 0);
                docCount++;
            }
            const candidateIds = this.candidateIds(terms, searchContent, searchFrontmatter, caseSensitive);
            for (const document of allowedFiles) {
                if (!candidateIds.has(document.documentId))
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
                this.cache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, results: results.map(result => ({ ...result })) });
                while (this.cache.size > SEARCH_CACHE_MAX_ENTRIES) {
                    const oldest = this.cache.keys().next();
                    if (oldest.done)
                        break;
                    this.cache.delete(oldest.value);
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
        if (this.watcher)
            return;
        try {
            this.watcher = watch(this.vaultPath, { recursive: true }, (_event, filename) => {
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
            const paths = await this.findMarkdownFiles(this.vaultPath);
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
            this.dirtyDocuments.clear();
            this.needsFullReconcile = false;
            this.lastIndexReconcileAt = Date.now();
            this.trimTextCache();
            await this.saveSnapshot();
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
            this.trimTextCache();
            await this.saveSnapshot();
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
            const content = await readFile(fullPath, 'utf-8');
            const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
            const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
            const frontmatterText = frontmatterMatch?.[1] || '';
            const title = relativePath.split('/').pop()?.replace(/\.md$/i, '') || relativePath;
            return {
                fullPath,
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
                bodyGrams: grams(body.toLowerCase()),
                frontmatterGrams: grams(frontmatterText.toLowerCase()),
                titleGrams: grams(title.toLowerCase()),
            };
        }
        catch {
            return undefined;
        }
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
    setDocument(document) {
        const old = this.documents.get(document.relativePath);
        if (old === document)
            return;
        if (old) {
            this.updatePostings(old, false);
            if (old.textCached)
                this.indexedTextBytes -= old.textBytes;
        }
        this.documents.set(document.relativePath, document);
        this.updatePostings(document, true);
        if (document.textCached)
            this.indexedTextBytes += document.textBytes;
    }
    removeDocument(path) {
        const document = this.documents.get(path);
        if (!document)
            return;
        this.updatePostings(document, false);
        if (document.textCached)
            this.indexedTextBytes -= document.textBytes;
        this.documents.delete(path);
    }
    async loadText(document) {
        if (document.body !== undefined && document.frontmatterText !== undefined) {
            document.lastAccessAt = Date.now();
            return;
        }
        try {
            const content = await readFile(document.fullPath, 'utf-8');
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
    candidateIds(terms, searchContent, searchFrontmatter, caseSensitive) {
        const all = new Set([...this.documents.values()].map(document => document.documentId));
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
                for (const path of this.postingCandidates(field, term))
                    output.add(path);
            }
        }
        return output;
    }
    postingCandidates(field, term) {
        const termGrams = grams(term);
        const postings = [...termGrams]
            .map(value => this.postings.get(this.postingKey(field, value)))
            .filter((value) => Boolean(value))
            .sort((a, b) => a.size - b.size);
        if (postings.length !== termGrams.size || !postings[0])
            return new Set();
        const output = new Set(postings[0]);
        for (const paths of postings.slice(1)) {
            for (const path of output)
                if (!paths.has(path))
                    output.delete(path);
        }
        return output;
    }
    async findMarkdownFiles(dirPath) {
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
        return markdownFiles;
    }
    rerank(candidates, terms, termDocFreq, docCount, totalDocLength, maxLimit) {
        const avgdl = docCount > 0 ? totalDocLength / docCount : 1;
        const k1 = 1.2;
        const b = 0.75;
        const scored = candidates.map(c => {
            let score = 0;
            for (const term of terms) {
                const tf = c.termFreqs.get(term) || 0;
                const df = termDocFreq.get(term) || 0;
                const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
                score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.docLength / avgdl));
            }
            return { score, result: c.result, wiki: c.wiki };
        });
        scored.sort((a, b) => Number(b.wiki) - Number(a.wiki) || b.score - a.score);
        return scored.slice(0, maxLimit).map(s => s.result);
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
