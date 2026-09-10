import { guidanceError } from './guidance-runtime.js';
import { DOCUMENT_STRUCTURE_PROFILE, parseDocumentStructure } from './document-structure.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readSnapshotBytes } from './snapshot-read.js';
import { createDerivedCacheOwner, derivedCacheBudget } from './cache-budget.js';
const compress = promisify(gzip);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
const CACHE_FILE = /^[a-f0-9]{64}\.structure\.json\.gz$/;
const isOutside = (path) => path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path);
/** Conservative UTF-8/escaping bound, computed before JSON allocates repeated headings. */
function fitsSerializationBudget(value, remaining = CACHE_ENTRY_BYTES - 1024) {
    const visit = (item) => {
        if (typeof item === 'string')
            remaining -= item.length * 6 + 3;
        else if (Array.isArray(item)) {
            remaining -= 2;
            for (const child of item)
                if (!visit(child))
                    return false;
        }
        else if (item && typeof item === 'object') {
            remaining -= 2;
            for (const [key, child] of Object.entries(item)) {
                remaining -= key.length * 6 + 4;
                if (!visit(child))
                    return false;
            }
        }
        else
            remaining -= 25;
        return remaining >= 0;
    };
    return visit(value);
}
function immutableStructure(structure) {
    if (Object.isFrozen(structure))
        return structure;
    for (const f of structure.fragments) {
        Object.freeze(f.children);
        Object.freeze(f.headingPath);
        Object.freeze(f.references);
        Object.freeze(f);
    }
    if (structure.gaps)
        Object.freeze(structure.gaps);
    if (structure.pdfPages) {
        for (const page of structure.pdfPages) {
            for (const region of page.regions) {
                Object.freeze(region.bbox);
                Object.freeze(region);
            }
            Object.freeze(page.regions);
            Object.freeze(page);
        }
        Object.freeze(structure.pdfPages);
    }
    Object.freeze(structure.fragments);
    Object.freeze(structure);
    return structure;
}
/** Advisory host-local structure cache. A cache hit NEVER replaces reading and
 * authorizing the current source. No filesystem event is treated as proof of deletion. */
export class DocumentIndex {
    reader;
    catalog;
    options;
    hot = new Map();
    cacheOwner = createDerivedCacheOwner('documents.structure');
    namespace;
    unsubscribe;
    closed = false;
    diskQueue = Promise.resolve();
    constructor(reader, catalog, options = {}) {
        this.reader = reader;
        this.catalog = catalog;
        this.options = options;
        this.namespace = hash(resolve(reader.fs.getVaultPath()));
        if (options.cacheDir) {
            const root = options.cacheDir;
            const inside = relative(resolve(reader.fs.getVaultPath()), resolve(root));
            if (!isAbsolute(root) || /^(?:\\\\|\/\/)/.test(root) || !isOutside(inside)) {
                throw guidanceError(new Error('Document cache must be an absolute host-local directory outside the authoritative Vault'), 'guid-fb524306d47279ef');
            }
            this.assertCacheDirectory();
        }
        this.unsubscribe = catalog?.subscribeBatch(changes => {
            if (!changes)
                this.invalidate();
            else
                for (const change of changes)
                    this.invalidate(change.path);
        });
    }
    assertCacheDirectory() {
        if (!this.options.cacheDir)
            return;
        const root = resolve(this.options.cacheDir);
        for (let current = root;;) {
            if (existsSync(current) && lstatSync(current).isSymbolicLink())
                throw guidanceError(new Error('Document cache cannot use symbolic links or junctions'), 'guid-76db0472d3aaea0f');
            const parent = dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
        if (existsSync(root)) {
            if (!lstatSync(root).isDirectory())
                throw guidanceError(new Error('Document cache directory unavailable'), 'guid-0b146645728f3c14');
            const canonical = realpathSync(root), inside = relative(realpathSync(this.reader.fs.getVaultPath()), canonical);
            if (!isOutside(inside))
                throw guidanceError(new Error('Document cache must remain outside the Vault'), 'guid-512f75342bd222c5');
            if (process.platform !== 'win32' && (lstatSync(root).mode & 0o077) !== 0)
                throw guidanceError(new Error('Document cache directory must be private (0700)'), 'guid-8e08bab8645c5c2c');
        }
    }
    key(path, revision) { return hash(`${this.namespace}\0${path}\0${revision}\0${DOCUMENT_STRUCTURE_PROFILE}`); }
    async load(path, principal, expectedRevision) {
        if (this.closed)
            throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
        const snapshot = await this.reader.read(path, principal, { ...(expectedRevision !== undefined && { expectedRevision }) });
        if (snapshot.mediaType === 'application/pdf' && this.options.pdf) {
            const structure = await this.options.pdf.extract(snapshot);
            if (structure.path !== snapshot.path || structure.revision !== snapshot.revision)
                throw guidanceError(new Error('PDF source generation mismatch'), 'guid-fc70410eb9a4352a');
            await this.reader.assertCurrent(snapshot, principal);
            if (this.closed)
                throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
            return { snapshot, structure: immutableStructure(structure) };
        }
        if (snapshot.text === undefined)
            throw guidanceError(new Error('Document parser unavailable for this binary format; original bytes remain available through resources.export'), 'guid-7af70b534d73999c');
        const key = this.key(snapshot.path, snapshot.revision);
        let structure = this.hot.get(key);
        if (structure)
            derivedCacheBudget.touch(this.cacheOwner, key);
        else
            structure = await this.restore(key, snapshot);
        if (!structure) {
            structure = (this.options.parse ?? parseDocumentStructure)({ path: snapshot.path, raw: snapshot.text,
                revision: snapshot.revision, format: /\.(?:md|markdown)$/i.test(snapshot.path) ? 'markdown' : 'text' });
            immutableStructure(structure);
            await this.persist(key, structure);
        }
        immutableStructure(structure);
        await this.reader.assertCurrent(snapshot, principal);
        if (this.closed)
            throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
        // Publish one complete source generation only after source revalidation.
        if (!this.hot.has(key)) {
            this.hot.set(key, structure);
            derivedCacheBudget.register(this.cacheOwner, key, structure.raw.length * 2 + structure.fragments.length * 900, () => this.hot.delete(key));
        }
        return { snapshot, structure };
    }
    async restore(key, snapshot) {
        if (!this.options.cacheDir)
            return;
        try {
            this.assertCacheDirectory();
            const bytes = await readSnapshotBytes(join(this.options.cacheDir, `${key}.structure.json.gz`), { maxBytes: CACHE_ENTRY_BYTES, maxDecodedBytes: CACHE_ENTRY_BYTES });
            const value = JSON.parse(bytes.toString('utf8'));
            const s = value.structure;
            if (value.version !== 1 || value.namespace !== this.namespace || value.checksum !== hash(JSON.stringify(s))
                || s?.path !== snapshot.path || s.revision !== snapshot.revision || s.profile !== DOCUMENT_STRUCTURE_PROFILE
                || typeof s.title !== 'string' || !Array.isArray(s.fragments) || !s.fragments.length || s.fragments.length > 100000)
                return;
            const ids = new Set();
            for (const f of s.fragments) {
                if (!f || typeof f.id !== 'string' || f.id.length > 200 || ids.has(f.id) || typeof f.kind !== 'string'
                    || !Number.isInteger(f.startOffset) || !Number.isInteger(f.endOffset) || f.startOffset < 0 || f.endOffset < f.startOffset
                    || f.endOffset > snapshot.text.length || !Number.isInteger(f.startLine) || !Number.isInteger(f.endLine) || f.startLine < 1 || f.endLine < f.startLine
                    || !Array.isArray(f.children) || !Array.isArray(f.headingPath) || !Array.isArray(f.references) || typeof f.description !== 'string')
                    return;
                ids.add(f.id);
            }
            if (s.fragments.some((f) => [...f.children, f.parent, f.previous, f.next].filter(Boolean).some(id => !ids.has(id))))
                return;
            return { path: s.path, revision: s.revision, profile: s.profile, title: s.title, fragments: s.fragments, raw: snapshot.text };
        }
        catch {
            return undefined;
        } // Untrusted/corrupt/missing cache rebuilds from the source.
    }
    async persist(key, document) {
        if (!this.options.cacheDir)
            return;
        const operation = async () => {
            let temporary;
            try {
                this.assertCacheDirectory();
                await mkdir(this.options.cacheDir, { recursive: true, mode: 0o700 });
                this.assertCacheDirectory();
                const { raw: _raw, ...structure } = document;
                if (!fitsSerializationBudget(structure))
                    return;
                const payload = JSON.stringify(structure);
                const serialized = `{"version":1,"namespace":"${this.namespace}","checksum":"${hash(payload)}","structure":${payload}}`;
                if (Buffer.byteLength(serialized) > CACHE_ENTRY_BYTES)
                    return;
                const bytes = await compress(serialized);
                if (bytes.length > CACHE_ENTRY_BYTES)
                    return;
                const destination = join(this.options.cacheDir, `${key}.structure.json.gz`);
                temporary = join(this.options.cacheDir, `${key}.${randomUUID()}.tmp`);
                await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
                this.assertCacheDirectory();
                await rename(temporary, destination);
                temporary = undefined;
                const entries = [];
                for (const name of await readdir(this.options.cacheDir)) {
                    if (!CACHE_FILE.test(name))
                        continue;
                    const path = join(this.options.cacheDir, name);
                    const info = await stat(path);
                    if (info.isFile())
                        entries.push({ path, size: info.size, time: info.mtimeMs });
                }
                let total = entries.reduce((sum, e) => sum + e.size, 0);
                let count = entries.length;
                for (const entry of entries.sort((a, b) => a.time - b.time)) {
                    if (total <= CACHE_MAX_BYTES && count <= 512)
                        break;
                    if (entry.path === destination)
                        continue;
                    this.assertCacheDirectory();
                    await unlink(entry.path);
                    total -= entry.size;
                    count--;
                }
            }
            catch { /* Optional local cache failure must not make a valid source unreadable. */ }
            finally {
                if (temporary)
                    await unlink(temporary).catch(() => { });
            }
        };
        this.diskQueue = this.diskQueue.then(operation, operation);
        await this.diskQueue;
    }
    invalidate(path) {
        for (const [key, value] of this.hot) {
            if (path === undefined || value.path.toLowerCase() === path.replace(/\\/g, '/').toLowerCase()) {
                this.hot.delete(key);
                derivedCacheBudget.remove(this.cacheOwner, key);
            }
        }
    }
    close() { this.closed = true; this.unsubscribe?.(); this.invalidate(); }
}
