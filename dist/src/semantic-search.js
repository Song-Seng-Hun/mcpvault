import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { ScopeAccessPolicy } from './scope-access.js';
import { boundSearchResults, normalizeSearchLimit, normalizeSearchMaxChars } from './search-limits.js';
import { generateObsidianUri } from './uri.js';
const MODEL_ID = 'Xenova/multilingual-e5-small';
const EMBEDDING_DIMENSIONS = 384;
const INDEX_DIR = '.mcpvault/semantic-index';
const MANIFEST_FILE = 'manifest.snapshot.gz';
const LEGACY_MANIFEST_FILE = 'manifest.json';
const WORKER_LOCK_FILE = 'worker.lock';
const MAX_CHUNK_CHARS = 1200;
const MAX_CHUNKS_PER_NOTE = 64;
const MAX_EXCERPT_CHARS = 600;
const IDLE_DELAY_MS = 15_000;
const UNAVAILABLE_RETRY_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 30_000;
const MAX_PENDING_CHANGES = 5_000;
const EMBED_BATCH_SIZE = 8;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
// One model per Node process, regardless of how many vault/server instances or
// agent sessions share that process.
const EMBEDDER_POOL = new Map();
async function acquireSharedEmbedder() {
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
                const pipeline = module.pipeline;
                return pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
            })().then(embedder => {
                entry.embedder = embedder;
                return embedder;
            }).catch(error => {
                if (EMBEDDER_POOL.get(MODEL_ID) === entry)
                    EMBEDDER_POOL.delete(MODEL_ID);
                throw error;
            });
        }
        await entry.loading;
    }
    const embedder = entry.embedder;
    if (!embedder)
        throw new Error('Embedding model did not initialize');
    entry.users += 1;
    return {
        embedder,
        release: () => {
            if (entry.users > 0)
                entry.users -= 1;
            if (entry.users !== 0 || entry.disposeTimer)
                return;
            entry.disposeTimer = setTimeout(() => {
                entry.disposeTimer = undefined;
                if (entry.users !== 0 || !entry.embedder)
                    return;
                const current = entry.embedder;
                entry.embedder = undefined;
                entry.loading = undefined;
                if (EMBEDDER_POOL.get(MODEL_ID) === entry)
                    EMBEDDER_POOL.delete(MODEL_ID);
                void Promise.resolve(current.dispose?.()).catch(() => undefined);
            }, IDLE_DELAY_MS * 4);
            entry.disposeTimer.unref?.();
        },
    };
}
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
async function resultFromRow(row, vaultPath, includeRevision) {
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
        ...(includeRevision && { rv: row.hash }),
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
    workerLockPath;
    manifest = {};
    manifestReady;
    db;
    embedder;
    embedderLease;
    pending = new Map();
    idleTimer;
    unloadTimer;
    syncPromise;
    scanPromise;
    dbPromise;
    semanticActive = false;
    indexLease;
    indexWorker = 'standby';
    lastScanAt = 0;
    tableNamesCache;
    tableNamesCachedAt = 0;
    unavailableUntil = 0;
    lastError;
    constructor(vaultPath, pathFilter, accessPolicy = new ScopeAccessPolicy()) {
        this.pathFilter = pathFilter;
        this.accessPolicy = accessPolicy;
        this.vaultPath = resolve(vaultPath);
        this.indexPath = join(this.vaultPath, INDEX_DIR);
        this.manifestPath = join(this.indexPath, MANIFEST_FILE);
        this.workerLockPath = join(this.indexPath, WORKER_LOCK_FILE);
        this.manifestReady = this.loadManifest();
    }
    notifyChange(path, kind) {
        const normalized = normalizePath(path);
        if (!isMarkdown(normalized) || !this.pathFilter.isAllowed(normalized))
            return;
        if (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized)) {
            this.pending.set(normalized, { kind });
        }
        if (this.semanticActive)
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
            const vector = await this.embed(params.query, 'query');
            const scopes = this.accessPolicy.scopeRoots(params.principal).map(root => root.kind === 'global' ? 'global' : `${root.kind}:${root.root.split('/').pop()}`);
            const results = [];
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
                    results.push({ result: await resultFromRow(row, this.vaultPath, params.includeRevisions === true), distance: Number(row._distance ?? 1) });
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
            worker: 'process-shared',
            indexWorker: this.indexWorker,
            indexingActive: this.semanticActive,
            ...(this.lastError && { lastError: this.lastError }),
        };
    }
    indexedCount() {
        return Object.keys(this.manifest).length;
    }
    async loadManifest() {
        try {
            const compressed = await readFile(this.manifestPath);
            const raw = await gunzipAsync(compressed);
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed && typeof parsed === 'object')
                this.manifest = parsed;
        }
        catch {
            try {
                // Read manifests written by older releases once; the next successful
                // index update stores the compact binary form.
                const raw = await readFile(join(this.indexPath, LEGACY_MANIFEST_FILE), 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object')
                    this.manifest = parsed;
            }
            catch {
                this.manifest = {};
            }
        }
    }
    async saveManifest() {
        await mkdir(this.indexPath, { recursive: true });
        const compressed = await gzipAsync(Buffer.from(JSON.stringify(this.manifest), 'utf8'));
        const temporaryPath = `${this.manifestPath}.${process.pid}.tmp`;
        await writeFile(temporaryPath, compressed);
        await rename(temporaryPath, this.manifestPath);
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
        if (!this.semanticActive)
            return;
        if (!this.indexLease && !await this.acquireIndexLease())
            return;
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
        if (this.scanPromise)
            return this.scanPromise;
        if (Date.now() - this.lastScanAt < SCAN_INTERVAL_MS)
            return;
        this.scanPromise = (async () => {
            const seen = new Set();
            let manifestChanged = false;
            for (const path of await this.findMarkdownFiles(this.vaultPath)) {
                const normalized = normalizePath(path);
                seen.add(normalized);
                if (!this.pathFilter.isAllowed(normalized))
                    continue;
                const fullPath = join(this.vaultPath, normalized);
                const info = await stat(fullPath).catch(() => undefined);
                if (!info?.isFile())
                    continue;
                const entry = this.manifest[normalized];
                if (entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs)
                    continue;
                const content = await readFile(fullPath, 'utf8').catch(() => undefined);
                if (content === undefined)
                    continue;
                const hash = hashContent(content);
                if ((!entry || entry.hash !== hash) && (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(normalized))) {
                    this.pending.set(normalized, { kind: 'upsert' });
                }
                else if (entry) {
                    // Timestamp-only changes do not require a new embedding. Persist the
                    // refreshed metadata so future scans stay stat-only.
                    this.manifest[normalized] = { ...entry, size: info.size, mtimeMs: info.mtimeMs };
                    manifestChanged = true;
                }
            }
            for (const path of Object.keys(this.manifest)) {
                if (!seen.has(path) && (this.pending.size < MAX_PENDING_CHANGES || this.pending.has(path)))
                    this.pending.set(path, { kind: 'delete' });
            }
            if (manifestChanged && this.pending.size === 0)
                await this.saveManifest();
            this.lastScanAt = Date.now();
        })();
        try {
            await this.scanPromise;
        }
        finally {
            this.scanPromise = undefined;
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
        if (this.db)
            return this.db;
        if (!this.dbPromise) {
            this.dbPromise = (async () => {
                const module = await import('@lancedb/lancedb');
                await mkdir(this.indexPath, { recursive: true });
                this.db = await module.connect(this.indexPath);
                return this.db;
            })();
        }
        try {
            return await this.dbPromise;
        }
        finally {
            this.dbPromise = undefined;
        }
    }
    /**
     * Coordinate document indexing across separately spawned MCP processes.
     * The first process that opts into server-side semantic search becomes the
     * leader. Other processes can query the shared derived cache, but never
     * start a second indexing worker.
     */
    async acquireIndexLease() {
        if (this.indexLease)
            return true;
        await mkdir(this.indexPath, { recursive: true });
        const createLease = async () => {
            try {
                const handle = await open(this.workerLockPath, 'wx');
                await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
                this.indexLease = handle;
                this.indexWorker = 'leader';
                return true;
            }
            catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
                    throw error;
                return false;
            }
        };
        if (await createLease())
            return true;
        const owner = await readFile(this.workerLockPath, 'utf8').catch(() => '');
        const pid = Number(/\"pid\"\s*:\s*(\d+)/.exec(owner)?.[1] || 0);
        let alive = false;
        if (Number.isInteger(pid) && pid > 0) {
            try {
                process.kill(pid, 0);
                alive = true;
            }
            catch {
                alive = false;
            }
        }
        if (alive) {
            this.indexWorker = 'standby';
            return false;
        }
        await unlink(this.workerLockPath).catch(() => undefined);
        const acquired = await createLease();
        if (!acquired)
            this.indexWorker = 'standby';
        return acquired;
    }
    async getTableNames() {
        if (this.tableNamesCache && Date.now() - this.tableNamesCachedAt < SCAN_INTERVAL_MS)
            return this.tableNamesCache;
        const db = await this.getDb();
        this.tableNamesCache = new Set(await db.tableNames());
        this.tableNamesCachedAt = Date.now();
        return this.tableNamesCache;
    }
    async getEmbedder() {
        if (!this.embedder) {
            this.embedderLease = await acquireSharedEmbedder();
            this.embedder = this.embedderLease.embedder;
        }
        if (this.unloadTimer)
            clearTimeout(this.unloadTimer);
        this.unloadTimer = setTimeout(() => {
            this.embedder = undefined;
            this.embedderLease?.release();
            this.embedderLease = undefined;
            try {
                this.db?.close?.();
            }
            catch {
                // Releasing the disposable cache is best-effort.
            }
            this.db = undefined;
            this.tableNamesCache = undefined;
            this.tableNamesCachedAt = 0;
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
        if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSIONS || !row.every(value => typeof value === 'number' && Number.isFinite(value)))
            throw new Error(`Embedding model returned an invalid ${EMBEDDING_DIMENSIONS}-dimensional vector`);
        return row;
    }
    async embedMany(texts, prefix) {
        if (texts.length === 0)
            return [];
        const embedder = await this.getEmbedder();
        try {
            const output = await embedder(texts.map(text => `${prefix}: ${text}`), { pooling: 'mean', normalize: true });
            const values = output.tolist();
            if (!Array.isArray(values) || values.length !== texts.length)
                throw new Error('Embedding model returned an invalid batch');
            const rows = values.map(value => value);
            if (!rows.every(row => Array.isArray(row) && row.length === EMBEDDING_DIMENSIONS && row.every(item => typeof item === 'number' && Number.isFinite(item)))) {
                throw new Error(`Embedding model returned an invalid ${EMBEDDING_DIMENSIONS}-dimensional batch`);
            }
            return rows;
        }
        catch {
            // Older transformer runtimes may not implement array input. Keep the
            // semantic cache optional by falling back to the proven single-input
            // path instead of failing the whole idle indexing pass.
            const rows = [];
            for (const text of texts)
                rows.push(await this.embed(text, prefix));
            return rows;
        }
    }
    async indexPathContent(path) {
        const fullPath = join(this.vaultPath, path);
        const content = await readFile(fullPath, 'utf8');
        const info = await stat(fullPath);
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
        for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
            const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
            const vectors = await this.embedMany(batch.map(chunk => chunk.text), 'passage');
            for (let index = 0; index < batch.length; index += 1) {
                const chunk = batch[index];
                rows.push({
                    id: chunk.id,
                    vector: vectors[index],
                    path,
                    hash: contentHash,
                    title,
                    line: chunk.line,
                    wiki,
                    updatedAt: new Date().toISOString(),
                });
            }
        }
        if (rows.length > 0) {
            table = table || await db.createTable(name, rows);
            if (names.has(name))
                await table.add(rows);
            this.tableNamesCache?.add(name);
        }
        this.manifest[path] = { hash: contentHash, scope, size: info.size, mtimeMs: info.mtimeMs };
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
