import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { ScopeAccessPolicy } from './scope-access.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { generateObsidianUri } from './uri.js';
const MODEL_ID = 'Xenova/multilingual-e5-small';
const INDEX_DIR = '.mcpvault/semantic-index';
const MANIFEST_FILE = 'manifest.json';
const MAX_CHUNK_CHARS = 1200;
const MAX_EXCERPT_CHARS = 600;
const IDLE_DELAY_MS = 15_000;
const UNAVAILABLE_RETRY_MS = 5 * 60_000;
function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function isMarkdown(path) {
    return path.toLowerCase().endsWith('.md');
}
function isUnder(path, prefix) {
    return path === prefix || path.startsWith(`${prefix}/`);
}
function scopeForPath(path) {
    const normalized = normalizePath(path).toLowerCase();
    const model = /^_scopes\/models\/([^/]+)(?:\/|$)/.exec(normalized);
    if (model)
        return `model:${model[1]}`;
    const agent = /^_scopes\/agents\/([^/]+)(?:\/|$)/.exec(normalized);
    if (agent)
        return `agent:${agent[1]}`;
    return 'global';
}
function tableName(scope) {
    return `chunks_${scope.replace(/[^a-z0-9_-]/g, '_')}`;
}
function isWikiPath(path, content) {
    const normalized = path.toLowerCase();
    if (normalized === '_wiki' || normalized.startsWith('_wiki/') || normalized === '_sources' || normalized.startsWith('_sources/'))
        return true;
    if (/^_scopes\/(models|agents)\/[^/]+\/(?:_wiki|_sources)(?:\/|$)/.test(normalized))
        return true;
    return /^---\r?\n[\s\S]*?\r?\nllm_wiki_type\s*:/im.test(content);
}
function stripFrontmatter(content) {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}
function hashContent(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
function compactExcerpt(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > MAX_EXCERPT_CHARS ? `${compact.slice(0, MAX_EXCERPT_CHARS - 1)}…` : compact;
}
function chunkNote(path, content) {
    const body = stripFrontmatter(content);
    const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
    const source = `${title}\n${body}`.trim();
    if (!source)
        return [];
    const chunks = [];
    let offset = 0;
    for (const paragraph of source.split(/\n\s*\n/)) {
        const trimmed = paragraph.trim();
        if (!trimmed) {
            offset += paragraph.length + 2;
            continue;
        }
        for (let start = 0; start < trimmed.length; start += MAX_CHUNK_CHARS) {
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
async function resultFromRow(row, vaultPath) {
    let excerpt = '';
    try {
        const content = stripFrontmatter(await readFile(join(vaultPath, row.path), 'utf8'));
        const lines = content.split(/\r?\n/);
        const start = Math.max(0, row.line - 2);
        excerpt = compactExcerpt(lines.slice(start, start + 3).join(' '));
    }
    catch {
        // The source may have been removed between vector query and response.
    }
    return {
        p: row.path,
        t: row.title,
        ex: excerpt,
        mc: 0,
        ln: row.line,
        uri: generateObsidianUri(vaultPath, row.path),
        ...(row.wiki && { wk: true }),
        vs: true,
    };
}
/**
 * Optional semantic search cache. It is deliberately a cache, not a second
 * source of truth: Markdown and Git remain authoritative. All failures are
 * contained here so lexical search and the MCP server keep working.
 */
export class SemanticSearchService {
    pathFilter;
    accessPolicy;
    vaultPath;
    indexPath;
    manifestPath;
    manifest = {};
    manifestReady;
    db;
    embedder;
    pending = new Map();
    idleTimer;
    unloadTimer;
    syncPromise;
    unavailableUntil = 0;
    lastError;
    constructor(vaultPath, pathFilter, accessPolicy = new ScopeAccessPolicy()) {
        this.pathFilter = pathFilter;
        this.accessPolicy = accessPolicy;
        this.vaultPath = resolve(vaultPath);
        this.indexPath = join(this.vaultPath, INDEX_DIR);
        this.manifestPath = join(this.indexPath, MANIFEST_FILE);
        this.manifestReady = this.loadManifest();
        this.scheduleIdleWork();
    }
    notifyChange(path, kind) {
        const normalized = normalizePath(path);
        if (!isMarkdown(normalized) || !this.pathFilter.isAllowed(normalized))
            return;
        this.pending.set(normalized, { kind });
        this.scheduleIdleWork();
    }
    async search(params) {
        const limit = normalizeSearchLimit(params.limit);
        const maxChars = normalizeSearchMaxChars(params.maxChars);
        if (!params.query?.trim())
            throw new Error('Search query cannot be empty');
        if (Date.now() < this.unavailableUntil) {
            return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: this.lastError };
        }
        try {
            await this.manifestReady;
            await this.scanForChanges();
            await this.drain(Math.max(4, Math.min(limit, 8)));
            const vector = await this.embedQuery(params.query);
            const scopes = this.accessPolicy.scopeRoots(params.principal).map(root => root.kind === 'global' ? 'global' : `${root.kind}:${root.root.split('/').pop()}`);
            const results = [];
            const names = await this.getTableNames();
            for (const scope of scopes) {
                const name = tableName(scope);
                if (!names.has(name))
                    continue;
                const table = await this.db.openTable(name);
                const rows = await table.vectorSearch(vector).distanceType('cosine').limit(limit * 2).toArray();
                for (const row of rows) {
                    const path = normalizePath(row.path);
                    if (!this.pathIsVisible(path, params))
                        continue;
                    results.push({ result: await resultFromRow(row, this.vaultPath), distance: Number(row._distance ?? 1) });
                }
            }
            const bestByPath = new Map();
            for (const item of results) {
                const old = bestByPath.get(item.result.p);
                if (!old || item.distance < old.distance)
                    bestByPath.set(item.result.p, item);
            }
            const ordered = [...bestByPath.values()]
                .sort((a, b) => a.distance - b.distance)
                .slice(0, limit)
                .map(item => item.result);
            return {
                results: boundSearchResults(ordered, maxChars),
                available: true,
                indexed: this.indexedCount(),
                pending: this.pending.size,
            };
        }
        catch (error) {
            this.markUnavailable(error);
            return { results: [], available: false, indexed: this.indexedCount(), pending: this.pending.size, error: this.lastError };
        }
    }
    status() {
        return {
            enabled: true,
            model: MODEL_ID,
            available: Date.now() >= this.unavailableUntil,
            indexed: this.indexedCount(),
            pending: this.pending.size,
            ...(this.lastError && { lastError: this.lastError }),
        };
    }
    indexedCount() {
        return Object.keys(this.manifest).length;
    }
    async loadManifest() {
        try {
            const raw = await readFile(this.manifestPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object')
                this.manifest = parsed;
        }
        catch {
            this.manifest = {};
        }
    }
    async saveManifest() {
        await mkdir(this.indexPath, { recursive: true });
        await writeFile(this.manifestPath, JSON.stringify(this.manifest), 'utf8');
    }
    scheduleIdleWork() {
        if (this.idleTimer)
            return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            void this.runIdleWork();
        }, IDLE_DELAY_MS);
        this.idleTimer.unref?.();
    }
    async runIdleWork() {
        try {
            await this.manifestReady;
            await this.scanForChanges();
            await this.drain(4);
        }
        catch (error) {
            this.markUnavailable(error);
        }
        finally {
            if (this.pending.size > 0)
                this.scheduleIdleWork();
        }
    }
    async scanForChanges() {
        const seen = new Set();
        for (const path of await this.findMarkdownFiles(this.vaultPath)) {
            const normalized = normalizePath(path);
            seen.add(normalized);
            if (!this.pathFilter.isAllowed(normalized))
                continue;
            const fullPath = join(this.vaultPath, normalized);
            const content = await readFile(fullPath, 'utf8').catch(() => undefined);
            if (content === undefined)
                continue;
            const hash = hashContent(content);
            const entry = this.manifest[normalized];
            if (!entry || entry.hash !== hash)
                this.pending.set(normalized, { kind: 'upsert' });
        }
        for (const path of Object.keys(this.manifest)) {
            if (!seen.has(path))
                this.pending.set(path, { kind: 'delete' });
        }
    }
    async findMarkdownFiles(dir) {
        const output = [];
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return output;
        }
        for (const entry of entries) {
            if (entry.name === '.mcpvault' || entry.name === '.git' || entry.name === '.obsidian' || entry.name === 'node_modules')
                continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory())
                output.push(...await this.findMarkdownFiles(full));
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
                output.push(full.slice(this.vaultPath.length + 1));
        }
        return output;
    }
    async drain(maxFiles) {
        if (this.syncPromise)
            return this.syncPromise;
        this.syncPromise = (async () => {
            let processed = 0;
            while (this.pending.size > 0 && processed < maxFiles) {
                const first = this.pending.entries().next().value;
                if (!first)
                    break;
                this.pending.delete(first[0]);
                try {
                    if (first[1].kind === 'delete')
                        await this.removePath(first[0]);
                    else
                        await this.indexPathContent(first[0]);
                    processed++;
                    this.lastError = undefined;
                }
                catch (error) {
                    this.pending.set(first[0], first[1]);
                    throw error;
                }
            }
            if (processed > 0)
                await this.saveManifest();
        })();
        try {
            await this.syncPromise;
        }
        finally {
            this.syncPromise = undefined;
        }
    }
    async getDb() {
        if (!this.db) {
            const module = await import('@lancedb/lancedb');
            await mkdir(this.indexPath, { recursive: true });
            this.db = await module.connect(this.indexPath);
        }
        return this.db;
    }
    async getTableNames() {
        const db = await this.getDb();
        return new Set(await db.tableNames());
    }
    async getEmbedder() {
        if (!this.embedder) {
            const module = await import('@huggingface/transformers');
            const pipeline = module.pipeline;
            this.embedder = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
        }
        if (this.unloadTimer)
            clearTimeout(this.unloadTimer);
        this.unloadTimer = setTimeout(() => {
            const embedder = this.embedder;
            this.embedder = undefined;
            void Promise.resolve(embedder?.dispose?.()).catch(() => undefined);
            try {
                this.db?.close?.();
            }
            catch {
                // Releasing the disposable cache is best-effort.
            }
            this.db = undefined;
            this.unloadTimer = undefined;
        }, IDLE_DELAY_MS * 4);
        this.unloadTimer.unref?.();
        return this.embedder;
    }
    async embed(text, prefix) {
        const embedder = await this.getEmbedder();
        const output = await embedder(`${prefix}: ${text}`, { pooling: 'mean', normalize: true });
        const values = output.tolist();
        const valueList = values;
        const row = Array.isArray(valueList?.[0]) ? valueList[0] : values;
        if (!Array.isArray(row) || row.length === 0 || !row.every(value => typeof value === 'number'))
            throw new Error('Embedding model returned an invalid vector');
        return row;
    }
    async embedQuery(query) {
        return this.embed(query, 'query');
    }
    async indexPathContent(path) {
        const fullPath = join(this.vaultPath, path);
        const content = await readFile(fullPath, 'utf8');
        const contentHash = hashContent(content);
        const scope = scopeForPath(path);
        const db = await this.getDb();
        const name = tableName(scope);
        const names = await this.getTableNames();
        let table = names.has(name) ? await db.openTable(name) : undefined;
        if (table)
            await table.delete(`path = '${path.replace(/'/g, "''")}'`);
        const chunks = chunkNote(path, content);
        const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
        const wiki = isWikiPath(path, content);
        const rows = [];
        for (const chunk of chunks) {
            rows.push({
                id: chunk.id,
                vector: await this.embed(chunk.text, 'passage'),
                path,
                hash: contentHash,
                title,
                line: chunk.line,
                wiki,
                updatedAt: new Date().toISOString(),
            });
        }
        if (rows.length > 0) {
            table = table || await db.createTable(name, rows);
            if (names.has(name))
                await table.add(rows);
        }
        this.manifest[path] = { hash: contentHash, scope };
    }
    async removePath(path) {
        const entry = this.manifest[path];
        if (entry && this.db) {
            const names = await this.getTableNames();
            const name = tableName(entry.scope);
            if (names.has(name)) {
                const table = await this.db.openTable(name);
                await table.delete(`path = '${path.replace(/'/g, "''")}'`);
            }
        }
        delete this.manifest[path];
    }
    pathIsVisible(path, params) {
        if (!this.accessPolicy.canAccessPhysicalPath(path, params.principal))
            return false;
        const prefix = normalizePath(params.pathPrefix || '');
        if (prefix && !isUnder(path, prefix))
            return false;
        const excludes = (params.excludePaths || []).map(normalizePath).filter(Boolean);
        return !excludes.some(exclude => isUnder(path, exclude));
    }
    markUnavailable(error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.unavailableUntil = Date.now() + UNAVAILABLE_RETRY_MS;
    }
}
