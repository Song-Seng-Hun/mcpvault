import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AsyncResource } from 'node:async_hooks';
import { HostDerivedStorage } from '../host-derived-storage.js';
import { memoryEntries } from '../memory-contract.js';
import { isModerationHidden } from '../moderation-policy.js';
import { isFictionDomain } from '../fiction-domain.js';
import { memoryQueryNeedsSource, positiveSearchTerms } from '../search.js';
import { MemorySqliteStore } from './sqlite-store.js';
/** Private derivative index; startup/reconciliation is background, never a request scan. */
export class DiskMemoryIndex {
    fs;
    allowed;
    // Preserve the service owner's construction context, not the triggering
    // request's expiring session. This never removes an owner's storage boundary.
    owner = new AsyncResource('memory-index-owner');
    store;
    storage;
    revision = 0;
    state = 'preparing';
    tail = Promise.resolve();
    unsubscribe;
    reconcileUnsubscribe;
    draining = false;
    pendingFull = false;
    pending = new Map();
    isClosed() { return this.state === 'closed'; }
    constructor(fs, cacheDir, allowed, catalog) {
        this.fs = fs;
        this.allowed = allowed;
        this.storage = new HostDerivedStorage(fs.getVaultPath(), cacheDir);
        this.unsubscribe = catalog?.subscribeBatch(changes => { void this.invalidate(changes); });
        this.reconcileUnsubscribe = catalog?.subscribeReconcile(() => { void this.invalidate(); });
    }
    start() { return this.invalidate(); }
    invalidate(changes) {
        if (this.state === 'closed')
            return this.tail;
        if (changes?.length === 0)
            return this.tail;
        this.revision++;
        this.state = 'preparing';
        if (!changes || !this.store)
            this.pendingFull = true;
        else if (!this.pendingFull)
            for (const change of changes) {
                this.pending.set(change.path, change);
                if (this.pending.size > 128) {
                    this.pendingFull = true;
                    break;
                }
            }
        if (this.pendingFull)
            this.pending.clear();
        if (this.draining)
            return this.tail;
        this.draining = true;
        this.tail = this.owner.runInAsyncScope(() => this.tail.then(async () => {
            try {
                while (this.state !== 'closed' && (this.pendingFull || this.pending.size)) {
                    const full = this.pendingFull, work = [...this.pending.values()], revision = this.revision;
                    this.pendingFull = false;
                    this.pending.clear();
                    try {
                        if (full)
                            await this.rebuild();
                        else {
                            await this.storage.verifiedTree('memory-read-v1');
                            // Delete events are hints, never proof that the NAS lost a file.
                            for (const change of work) {
                                if (this.isClosed())
                                    throw Error('Memory index stopped');
                                if (/\.md$/i.test(change.path))
                                    await this.refresh(change.path, true);
                            }
                        }
                        if (revision === this.revision)
                            this.state = 'ready';
                    }
                    catch {
                        if (revision === this.revision)
                            this.state = 'unavailable';
                    }
                }
            }
            finally {
                this.draining = false;
            }
        }));
        return this.tail;
    }
    async refresh(path, allowMissing) {
        if (!this.store)
            throw Error('Index unavailable');
        if (!this.allowed(path)) {
            await this.store.remove([path]);
            return;
        }
        try {
            const metadata = (await this.fs.readNoteMetadata([path], this.allowed, { fresh: true, strict: true, maxBytes: 2 * 1024 * 1024 }))[0];
            if (!metadata) {
                if (!allowMissing)
                    throw Error('Metadata unavailable');
                await stat(this.fs.getVaultPath());
                await this.store.remove([path]);
                return;
            }
            const entries = memoryEntries(metadata.frontmatter);
            if ((!entries.length && metadata.frontmatter.mcpvault_type !== 'journal_entry' && metadata.frontmatter.llm_wiki_type !== 'knowledge') || isModerationHidden(metadata.frontmatter)
                || isFictionDomain(metadata.frontmatter, path) || metadata.frontmatter.mcpvault_type === 'blog_post' && metadata.frontmatter.status === 'draft') {
                await this.store.remove([path]);
                return;
            }
            const prior = (await this.store.get([path])).notes[0];
            if (prior?.revision !== metadata.revision || (await this.store.unindexedGraph([path])).length) {
                const note = await this.fs.readNote(path, 2 * 1024 * 1024);
                if (!this.allowed(path) || note.revision !== metadata.revision)
                    throw Error('Memory changed during indexing');
                await this.store.put([{ path, revision: note.revision, frontmatter: note.frontmatter, text: note.content }]);
            }
            await this.store.seen([path]);
        }
        catch (e) {
            if (allowMissing && e.code === 'ENOENT') {
                await stat(this.fs.getVaultPath());
                await this.store.remove([path]);
            }
            else
                throw e;
        }
    }
    async rebuild() {
        const directory = await this.storage.verifiedTree('memory-read-v1', true);
        this.store ??= new MemorySqliteStore(join(directory, 'memory.sqlite'));
        await this.store.ready();
        await this.store.beginScan();
        const pending = [];
        const flush = async () => {
            if (this.isClosed())
                throw Error('Memory scan interrupted');
            // Bounded read parallelism amortizes NAS round trips. Drain every owned
            // read before reporting failure; a failed batch must never sweep rows.
            const results = await Promise.allSettled(pending.splice(0).map(path => this.refresh(path, false)));
            const failure = results.find(result => result.status === 'rejected');
            if (failure?.status === 'rejected')
                throw failure.reason;
        };
        const walk = async (directory, prefix = '', depth = 0) => {
            if (depth > 64 || this.state === 'closed')
                throw Error('Memory scan interrupted');
            for await (const entry of await opendir(directory)) {
                if (this.isClosed())
                    throw Error('Memory scan interrupted');
                const path = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isSymbolicLink() || entry.name.startsWith('.') || !this.allowed(path))
                    continue;
                if (entry.isDirectory())
                    await walk(join(directory, entry.name), path, depth + 1);
                else if (entry.isFile() && /\.md$/i.test(path)) {
                    pending.push(path);
                    if (pending.length === 8)
                        await flush();
                }
            }
        };
        await walk(this.fs.getVaultPath());
        await flush();
        await stat(this.fs.getVaultPath());
        await this.store.finishScan();
        await this.storage.verifiedTree('memory-read-v1');
    }
    async capture(p) {
        const revision = this.revision;
        const unavailable = (reason) => ({ notes: [], truncated: true, generation: revision, reason, candidatePaths: new Set(), assertCurrent: async () => { } });
        if (!this.store || this.state !== 'ready')
            return unavailable('memory_index_' + this.state);
        if (memoryQueryNeedsSource(p.query))
            return unavailable('strict_query_requires_exact_source_read');
        const terms = positiveSearchTerms(p.query);
        if (terms.length > 32)
            return unavailable('memory_query_budget');
        try {
            await stat(this.fs.getVaultPath());
            await this.storage.verifiedTree('memory-read-v1');
            const generation = await this.store.generation(), notes = new Map();
            const filters = { prefix: p.prefix || p.root, ...(p.role && { role: p.role }), ...(p.dateFrom && { dateFrom: p.dateFrom }), ...(p.dateTo && { dateTo: p.dateTo }) };
            let after, truncated = false, scanned = 0;
            const candidates = new Set();
            do {
                const page = await this.store.page({ ...filters, terms, ...(after && { after }), limit: 64 });
                scanned += page.notes.length;
                for (const note of page.notes)
                    if (p.canAccess(note.path) && this.allowed(note.path)) {
                        notes.set(note.path, note);
                        candidates.add(note.path);
                    }
                truncated = page.truncated;
                after = page.notes.at(-1)?.path;
            } while (truncated && scanned < 256 && notes.size < 64);
            // A bounded contextual pool is independent of literal hits: synonyms must
            // remain eligible. Incomplete partitions are explicitly partial, not absent.
            if (p.semantic && terms.length) {
                const context = await this.store.page({ ...filters, terms: [], limit: 64 });
                truncated ||= context.truncated;
                for (const note of context.notes)
                    if (p.canAccess(note.path) && this.allowed(note.path))
                        notes.set(note.path, note);
            }
            // Resolve inverse corrections/support outside the query prefix, with current ACL.
            let frontier = [...notes.keys()], edges = 0;
            for (let depth = 0; frontier.length && depth < 8; depth++) {
                const page = await this.store.dependents(frontier, 201 - edges);
                edges += page.notes.length;
                if (page.truncated || edges > 200)
                    return unavailable('memory_dependency_budget');
                frontier = [];
                for (const note of page.notes)
                    if (!notes.has(note.path) && p.canAccess(note.path) && this.allowed(note.path)) {
                        notes.set(note.path, note);
                        frontier.push(note.path);
                    }
                if (depth === 7 && frontier.length)
                    return unavailable('memory_correction_depth');
            }
            const assertCurrent = async () => {
                if (this.state !== 'ready' || revision !== this.revision || generation !== await this.store.generation()
                    || [...notes.keys()].some(path => !p.canAccess(path) || !this.allowed(path)))
                    throw Error('Memory index changed; repeat request');
                await stat(this.fs.getVaultPath());
            };
            await assertCurrent();
            return { notes: [...notes.values()], truncated, generation, candidatePaths: candidates, assertCurrent };
        }
        catch {
            return unavailable('memory_index_unavailable');
        }
    }
    async close() { this.state = 'closed'; this.revision++; this.unsubscribe?.(); this.reconcileUnsubscribe?.(); await this.tail; try {
        await this.store?.close();
    }
    finally {
        this.owner.emitDestroy();
    } }
}
