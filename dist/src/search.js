import { join, resolve } from 'path';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { generateObsidianUri } from './uri.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { isMarkdownModerationHidden } from './moderation-policy.js';
const WIKI_TYPES = new Set(['schema', 'source', 'knowledge', 'issue']);
const SEARCH_CACHE_TTL_MS = 5_000;
const SEARCH_CACHE_MAX_ENTRIES = 128;
const INDEX_RECONCILE_INTERVAL_MS = 60_000;
const NO_WATCHER_RECONCILE_INTERVAL_MS = 5_000;
const INDEX_READ_BATCH_SIZE = 32;
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
    cacheGeneration = 0;
    indexReady;
    indexRefresh;
    watcher;
    lastIndexReconcileAt = 0;
    needsFullReconcile = true;
    constructor(vaultPath, pathFilter) {
        this.pathFilter = pathFilter;
        this.vaultPath = resolve(vaultPath);
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
                this.documents.delete(normalized);
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
            // Corpus stats for reranking
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
                allowedFiles.push(document);
            }
            for (const document of allowedFiles) {
                const { relativePath } = document;
                if (isMarkdownModerationHidden(document.content))
                    continue;
                let searchableText = '';
                // Prepare search text based on options
                if (searchContent && searchFrontmatter) {
                    searchableText = document.content;
                }
                else if (searchContent) {
                    searchableText = document.body;
                }
                else if (searchFrontmatter) {
                    searchableText = document.frontmatterText;
                }
                const searchIn = caseSensitive ? searchableText : searchableText.toLowerCase();
                // Collect corpus stats for reranking
                const docLength = searchIn.split(/\s+/).filter(w => w.length > 0).length;
                totalDocLength += docLength;
                docCount++;
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
            this.documents.clear();
            for (const [path, document] of next)
                this.documents.set(path, document);
            this.dirtyDocuments.clear();
            this.needsFullReconcile = false;
            this.lastIndexReconcileAt = Date.now();
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
                    this.documents.set(path, document);
                else
                    this.documents.delete(path);
            }
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
            const title = relativePath.split('/').pop()?.replace(/\.md$/i, '') || relativePath;
            return {
                fullPath,
                relativePath,
                content,
                body: frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content,
                frontmatterText: frontmatterMatch?.[1] || '',
                title,
                isWiki: isWikiPath(relativePath) || wikiType(content) !== undefined,
                revision: revision(content),
                size: info.size,
                mtimeMs: info.mtimeMs,
            };
        }
        catch {
            return undefined;
        }
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
