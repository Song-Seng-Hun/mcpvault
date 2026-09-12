import { guidanceError } from './guidance-runtime.js';
import { DOCUMENT_STRUCTURE_PROFILE, parseDocumentStructure } from './document-structure.js';
import { createHash, randomUUID } from 'node:crypto';
import { rename, opendir, stat, lstat, unlink, open } from 'node:fs/promises';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readSnapshotBytes } from './snapshot-read.js';
import { createDerivedCacheOwner, derivedCacheBudget } from './cache-budget.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { prepareOwnerActivityStorageWrite } from './enterprise-storage-context.js';
import { withDocumentWork, reserveDocumentWork, documentParseEstimate, documentResidentEstimate as residentEstimate } from './document-work-memory.js';
const compress = promisify(gzip);
const hash = (text) => createHash('sha256').update(text).digest('hex');
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_ENTRY_BYTES = 16 * 1024 * 1024;
const CACHE_FILE = /^[a-f0-9]{64}\.structure\.json\.gz$/;
const isOutside = (path) => path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path);
/** Conservative UTF-8/escaping bound, computed before JSON allocates repeated headings. */
function serializationEstimate(value, remaining = CACHE_ENTRY_BYTES - 1024) {
    const initial = remaining;
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
    return visit(value) ? initial - remaining + 1024 : undefined;
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
    preparing = new Map();
    cacheOwner = createDerivedCacheOwner('documents.structure');
    namespace;
    unsubscribe;
    closed = false;
    diskQueue = Promise.resolve();
    pendingDiskKeys = new Set();
    pendingDiskBytes = 0;
    diskLedger = new Map();
    diskLedgerReady = false;
    diskWrites = 0;
    writerLease;
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
    async assertPrivateCache(file) {
        if (!this.options.cacheDir)
            throw new Error('Confidential parsing requires provisioned private host derivative storage');
        await validateRoleplayStorage({ vaultPath: this.reader.fs.getVaultPath(), hostPath: this.options.cacheDir });
        if (file) {
            await canonicalRoleplayPath(file, true, true);
            if ((await lstat(file)).nlink !== 1)
                throw new Error('Document cache cannot use shared file links');
        }
        await assertHostPrivateStorage([this.options.cacheDir, ...(file ? [file] : [])]);
    }
    async load(path, principal, expectedRevision) {
        return withDocumentWork(() => this.loadWithinWork(path, principal, expectedRevision));
    }
    /** Revalidate metadata-only pages without retaining or decoding source bodies. */
    async revalidatePin(pin, principal) {
        if (this.closed)
            throw new Error('Document index is closed');
        this.reader.assertAdmitted(this.reader.access.toPublicPath(pin.path), principal);
        if (this.reader.access.isConfidentialDocument(pin.path)) {
            await this.assertPrivateCache();
            const file = join(this.options.cacheDir, `${this.key(pin.path, pin.revision)}.structure.json.gz`);
            try {
                await this.assertPrivateCache(file);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        // The final hash/admission check follows the last asynchronous privacy check.
        await this.reader.assertPin(pin, principal);
        if (this.closed)
            throw new Error('Document index is closed');
    }
    async loadWithinWork(path, principal, expectedRevision) {
        if (this.closed)
            throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
        const resolved = this.reader.resolve(path, principal);
        const confidential = this.reader.access.isConfidentialDocument(resolved);
        if (confidential)
            await this.assertPrivateCache();
        const snapshot = await this.reader.read(path, principal, { ...(expectedRevision !== undefined && { expectedRevision }) });
        if (snapshot.mediaType === 'application/pdf' && this.options.pdf) {
            // The isolated worker has its own OS cap; its bounded 16 MiB output,
            // decoded JSON and parent-side conversion must also be admitted here.
            const extraction = reserveDocumentWork(96 * 1024 * 1024);
            let structure;
            try {
                structure = await this.options.pdf.extract(snapshot);
            }
            finally {
                extraction.release();
            }
            immutableStructure(structure);
            reserveDocumentWork(residentEstimate(structure));
            if (structure.path !== snapshot.path || structure.revision !== snapshot.revision)
                throw guidanceError(new Error('PDF source generation mismatch'), 'guid-fc70410eb9a4352a');
            if (confidential)
                await this.assertPrivateCache();
            await this.reader.assertCurrent(snapshot, principal);
            if (this.closed)
                throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
            return { snapshot, structure: immutableStructure(structure) };
        }
        if (snapshot.text === undefined)
            throw guidanceError(new Error('Document parser unavailable for this binary format; original bytes remain available through resources.export'), 'guid-7af70b534d73999c');
        const key = this.key(snapshot.path, snapshot.revision);
        let structure = this.hot.get(key);
        let preparation;
        let shouldPersist = false;
        try {
            if (structure)
                derivedCacheBudget.touch(this.cacheOwner, key);
            else {
                preparation = this.preparing.get(key);
                if (!preparation) {
                    preparation = (async () => {
                        const restored = await this.restore(key, snapshot, confidential);
                        if (restored)
                            return immutableStructure(restored);
                        reserveDocumentWork(documentParseEstimate(snapshot.text));
                        const parsed = immutableStructure((this.options.parse ?? parseDocumentStructure)({ path: snapshot.path, raw: snapshot.text,
                            revision: snapshot.revision, format: /\.(?:md|markdown)$/i.test(snapshot.path) ? 'markdown' : 'text' }));
                        shouldPersist = true;
                        return parsed;
                    })();
                    this.preparing.set(key, preparation);
                }
                structure = await preparation;
            }
            immutableStructure(structure);
            // A caller holds this generation even if another request evicts its hot
            // cache entry. Pin that borrowed reference for the operation's lifetime.
            reserveDocumentWork(residentEstimate(structure));
            if (confidential) {
                await this.assertPrivateCache();
                const file = join(this.options.cacheDir, `${key}.structure.json.gz`);
                try {
                    await this.assertPrivateCache(file);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
            await this.reader.assertCurrent(snapshot, principal);
            if (this.closed)
                throw guidanceError(new Error('Document index is closed'), 'guid-5d0fa2a802028c72');
            if (shouldPersist)
                void this.persist(key, structure, confidential, this.publicationGuard(snapshot.path, principal)).catch(() => undefined);
            // Publish one complete source generation only after source revalidation.
            if (!this.hot.has(key)) {
                this.hot.set(key, structure);
                derivedCacheBudget.register(this.cacheOwner, key, residentEstimate(structure), () => this.hot.delete(key));
            }
            return { snapshot, structure };
        }
        finally {
            if (preparation && this.preparing.get(key) === preparation)
                this.preparing.delete(key);
        }
    }
    async restore(key, snapshot, confidential) {
        if (!this.options.cacheDir)
            return;
        let privacyFailed = false;
        let decoding;
        const verifyPrivacy = async (file) => {
            try {
                await this.assertPrivateCache(file);
            }
            catch (error) {
                privacyFailed = true;
                throw error;
            }
        };
        // A malformed advisory entry may be rebuilt. An unverifiable privacy boundary may not.
        if (confidential) {
            await this.assertPrivateCache();
            const file = join(this.options.cacheDir, `${key}.structure.json.gz`);
            try {
                await stat(file);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return;
                throw error;
            }
            await this.assertPrivateCache(file);
        }
        try {
            this.assertCacheDirectory();
            const file = join(this.options.cacheDir, `${key}.structure.json.gz`);
            await verifyPrivacy();
            await verifyPrivacy(file);
            // Bound decoded chunks, contiguous bytes, UTF-16 JSON and parsed objects
            // before decompression. Failure can safely choose a smaller fresh parse.
            decoding = reserveDocumentWork(CACHE_ENTRY_BYTES * 6);
            const bytes = await readSnapshotBytes(file, { maxBytes: CACHE_ENTRY_BYTES, maxDecodedBytes: CACHE_ENTRY_BYTES });
            await verifyPrivacy(file);
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
        catch (error) {
            if (confidential && privacyFailed)
                throw error;
            return undefined; // Corrupt/missing advisory entries rebuild; confidentiality boundary failures do not.
        }
        finally {
            decoding?.release();
        }
    }
    /** Copy only authority inputs into the queue, never the snapshot's original bytes. */
    publicationGuard(path, principal) {
        const publicPath = this.reader.access.toPublicPath(path);
        const submittingPrincipal = principal === undefined ? undefined : structuredClone(principal);
        const assert = () => {
            if (this.reader.assertAdmitted(publicPath, submittingPrincipal) !== path)
                throw new Error('Document source admission changed');
        };
        return { assert, refresh: async () => { await prepareOwnerActivityStorageWrite(path); assert(); } };
    }
    /** One lifetime writer per private root makes its capacity ledger exclusive.
     * An abandoned lease fails closed to memory-only writes; never steal a host's lock. */
    async acquireWriterLease() {
        const path = join(this.options.cacheDir, 'document-cache.writer.lock');
        if (!this.writerLease) {
            try {
                this.writerLease = await open(path, 'wx', 0o600);
            }
            catch (error) {
                if (error.code === 'EEXIST')
                    return false;
                throw error;
            }
        }
        await this.assertPrivateCache(path);
        const held = await this.writerLease.stat(), current = await lstat(path);
        if (!current.isFile() || current.nlink !== 1 || held.ino !== current.ino || held.dev !== current.dev) {
            throw new Error('Document cache writer lease changed');
        }
        return true;
    }
    async releaseWriterLease() {
        const held = this.writerLease;
        if (!held)
            return;
        this.writerLease = undefined;
        try {
            const path = join(this.options.cacheDir, 'document-cache.writer.lock');
            await this.assertPrivateCache(path);
            const info = await held.stat(), current = await lstat(path);
            if (current.isFile() && current.nlink === 1 && info.ino === current.ino && info.dev === current.dev)
                await unlink(path);
        }
        catch { /* Do not remove an unverified or replaced host lock. */ }
        finally {
            await held.close();
        }
    }
    async persist(key, document, confidential, authorize) {
        if (!this.options.cacheDir || this.pendingDiskKeys.has(key) || this.pendingDiskKeys.size >= 4)
            return;
        // The queue owns metadata only, never the original Buffer or full raw text.
        const { raw: _raw, ...structure } = document;
        const estimated = serializationEstimate(structure);
        if (estimated === undefined || this.pendingDiskBytes + estimated > 32 * 1024 * 1024)
            return;
        // The pending metadata, both JSON strings and compression buffers stay
        // charged independently of the already returned foreground request.
        let work;
        try {
            work = derivedCacheBudget.reserveWork(estimated * 4 + 64 * 1024);
        }
        catch {
            return; /* Optional persistence cannot crowd out admitted reads. */
        }
        this.pendingDiskKeys.add(key);
        this.pendingDiskBytes += estimated;
        const operation = async () => {
            let temporary;
            let temporaryHandle;
            let created = false;
            try {
                await authorize.refresh();
                await this.assertPrivateCache();
                this.assertCacheDirectory();
                if (!await this.acquireWriterLease())
                    return;
                if (!await this.loadDiskLedger())
                    return;
                const payload = JSON.stringify(structure);
                const serialized = `{"version":1,"namespace":"${this.namespace}","checksum":"${hash(payload)}","structure":${payload}}`;
                if (Buffer.byteLength(serialized) > CACHE_ENTRY_BYTES)
                    return;
                const bytes = await compress(serialized);
                if (bytes.length > CACHE_ENTRY_BYTES)
                    return;
                const destination = join(this.options.cacheDir, `${key}.structure.json.gz`);
                if (!await this.reserveDiskEntry(`${key}.structure.json.gz`, bytes.length))
                    return;
                temporary = join(this.options.cacheDir, `${key}.${randomUUID()}.tmp`);
                await authorize.refresh();
                await this.assertPrivateCache();
                if (!await this.acquireWriterLease())
                    return;
                authorize.assert();
                temporaryHandle = await open(temporary, 'wx', 0o600);
                created = true;
                await this.assertPrivateCache(temporary);
                authorize.assert();
                await temporaryHandle.writeFile(bytes);
                await this.assertPrivateCache(temporary);
                this.assertCacheDirectory();
                try {
                    await this.assertPrivateCache(destination);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                await authorize.refresh();
                await this.assertPrivateCache(temporary);
                if (!await this.acquireWriterLease())
                    return;
                authorize.assert();
                await rename(temporary, destination);
                temporary = undefined;
                created = false;
                await this.assertPrivateCache(destination);
                this.diskLedger.set(`${key}.structure.json.gz`, { size: bytes.length, time: Date.now() });
                // Reconcile occasional peer/host cache changes, not every search response.
                if (++this.diskWrites % 64 === 0)
                    this.diskLedgerReady = false;
            }
            catch (error) {
                // A filesystem operation may already have committed when verification
                // fails. Never reuse an undercounting ledger after an uncertain write.
                this.diskLedgerReady = false;
                if (confidential)
                    throw error; /* Public advisory cache failures may rebuild. */
            }
            finally {
                if (created && temporary) {
                    try {
                        await this.assertPrivateCache(temporary);
                        const held = await temporaryHandle.stat(), current = await lstat(temporary);
                        if (held.ino === current.ino && held.dev === current.dev)
                            await unlink(temporary);
                    }
                    catch { /* Leave changed storage for host inspection. */ }
                }
                try {
                    await temporaryHandle?.close();
                }
                finally {
                    this.pendingDiskKeys.delete(key);
                    this.pendingDiskBytes -= estimated;
                    work.release();
                }
            }
        };
        this.diskQueue = this.diskQueue.then(operation, operation);
        await this.diskQueue;
    }
    async loadDiskLedger() {
        if (this.diskLedgerReady)
            return true;
        const entries = new Map();
        let inspected = 0;
        for await (const entry of await opendir(this.options.cacheDir)) {
            if (++inspected > 2048)
                return false; // A foreign/oversized directory requires host cleanup, not an unbounded sweep.
            if (!CACHE_FILE.test(entry.name) || !entry.isFile())
                continue;
            const info = await lstat(join(this.options.cacheDir, entry.name));
            if (!info.isFile() || info.nlink !== 1)
                return false;
            entries.set(entry.name, { size: info.size, time: info.mtimeMs });
        }
        this.diskLedger.clear();
        for (const [name, entry] of entries)
            this.diskLedger.set(name, entry);
        this.diskLedgerReady = true;
        return true;
    }
    async reserveDiskEntry(name, bytes) {
        let total = bytes, count = 1;
        for (const [key, entry] of this.diskLedger)
            if (key !== name) {
                total += entry.size;
                count++;
            }
        for (let removed = 0; total > CACHE_MAX_BYTES || count > 512; removed++) {
            if (removed >= 16)
                return false; // Cleanup is bounded and never a response prerequisite.
            let oldest;
            for (const item of this.diskLedger)
                if (item[0] !== name && (!oldest || item[1].time < oldest[1].time))
                    oldest = item;
            if (!oldest)
                return false;
            const path = join(this.options.cacheDir, oldest[0]);
            try {
                await this.assertPrivateCache(path);
                await unlink(path);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            this.diskLedger.delete(oldest[0]);
            total -= oldest[1].size;
            count--;
        }
        return true;
    }
    invalidate(path) {
        for (const [key, value] of this.hot) {
            if (path === undefined || value.path.toLowerCase() === path.replace(/\\/g, '/').toLowerCase()) {
                this.hot.delete(key);
                derivedCacheBudget.remove(this.cacheOwner, key);
            }
        }
    }
    async close() {
        this.closed = true;
        this.unsubscribe?.();
        this.invalidate();
        await this.diskQueue.catch(() => undefined);
        await this.releaseWriterLease();
    }
}
