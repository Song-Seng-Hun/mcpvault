import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { memoryEntries, memoryReferencePath } from '../memory-contract.js';
import { extractGraphAssertions } from '../graph-assertion.js';
import { extractObsidianLinkOccurrences } from '../backlinks.js';
import { buildNoteReferenceIndex, markdownNotePath } from '../note-reference.js';
// Discovery key only, never a resolved path or permission. Preserve raw reference in payload.
function referenceKey(raw) {
    return raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/, 1)[0].trim().replace(/\.md$/i, '').toLowerCase();
}
function occurrenceKey(assertion) {
    if (assertion.syntax !== 'markdown')
        return referenceKey(assertion.targetReference);
    const link = extractObsidianLinkOccurrences(assertion.targetReference, 1)[0];
    // Preserve the original occurrence as evidence. Only its advisory index key
    // resolves explicit Markdown relativity; aliases still require live resolution.
    return link ? referenceKey(markdownNotePath(link.target, assertion.source.path) ?? '')
        : referenceKey(assertion.targetReference);
}
/** One bounded RPC queue. SQLite and its native allocations stay off the request thread. */
export class MemorySqliteStore {
    worker;
    serial = 0;
    closed = false;
    pending = new Map();
    constructor(path) {
        const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number);
        if (major < 22 || major === 22 && (minor < 23 || minor === 23 && patch < 2))
            throw Error('Disk memory requires Node 22.23.2 or newer');
        const js = new URL('./sqlite-worker.js', import.meta.url);
        const url = existsSync(fileURLToPath(js)) ? js : new URL('./sqlite-worker.ts', import.meta.url);
        this.worker = new Worker(url, { workerData: { path }, execArgv: url.pathname.endsWith('.ts') ? ['--experimental-strip-types'] : [], resourceLimits: { maxOldGenerationSizeMb: 128 } });
        this.worker.on('message', ({ id, value, error }) => { const p = this.pending.get(id); if (!p)
            return; this.pending.delete(id); clearTimeout(p.timer); error ? p.reject(Error('Memory read index unavailable')) : p.resolve(value); });
        const fail = () => { this.closed = true; for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(Error('Memory read index unavailable'));
        } this.pending.clear(); };
        this.worker.on('error', fail);
        this.worker.on('exit', fail);
    }
    call(op, data = {}) {
        if (this.closed || this.pending.size >= 8)
            return Promise.reject(Error('Memory index busy or closed'));
        return new Promise((resolve, reject) => {
            const id = ++this.serial, timer = setTimeout(() => { this.pending.delete(id); reject(Error('Memory index timed out')); void this.worker.terminate(); }, 30000);
            this.pending.set(id, { resolve, reject, timer });
            this.worker.postMessage({ id, op, data });
        });
    }
    ready() { return this.call('ready'); }
    generation() { return this.call('generation'); }
    async put(rows) {
        if (rows.length > 128)
            throw Error('Memory index batch exceeds limit');
        const data = rows.map(row => {
            memoryReferencePath(row.path);
            if (!/^[a-f0-9]{64}$/.test(row.revision || '') || typeof row.text !== 'string' || row.text.length > 2_000_000 || JSON.stringify(row.frontmatter).length > 128000)
                throw Error('Invalid memory index row');
            const entries = memoryEntries(row.frontmatter);
            if (!entries.length && row.frontmatter.mcpvault_type === 'journal_entry')
                entries.push({ role: 'episodic', observed_at: row.frontmatter.date });
            const graph = extractGraphAssertions({ repositoryId: 'private-read-index', path: row.path, revision: row.revision, frontmatter: row.frontmatter, content: row.text });
            const identities = buildNoteReferenceIndex([{ path: row.path, title: row.frontmatter.title,
                    aliases: row.frontmatter.aliases, preferredTerm: row.frontmatter.preferred_term, stableId: row.frontmatter.stable_id }]);
            const names = [...new Set([identities.qualified, identities.exact, identities.filenames, identities.terms].flatMap(m => [...m.keys()]))];
            if (names.length > 512)
                throw Error('Graph identity budget exceeded');
            return { ...row, entries, names, graph: { version: 2, partial: graph.partial, occurrences: graph.assertions.map(a => ({ key: occurrenceKey(a), assertion: a })) },
                edges: entries.flatMap(e => ['basis', 'corrects'].flatMap(kind => (e[kind] || []).map(r => ({ kind, target: memoryReferencePath(r.path).toLowerCase() })))) };
        });
        await this.call('put', data);
    }
    remove(paths) { paths.forEach(memoryReferencePath); if (paths.length > 128)
        throw Error('Memory index batch exceeds limit'); return this.call('remove', paths); }
    async page(q) {
        if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 500 || q.terms.length > 32 || q.terms.some(t => typeof t !== 'string' || t.length > 1000))
            throw Error('Invalid memory index query');
        return this.call('page', q);
    }
    dependents(paths, limit) {
        paths.forEach(memoryReferencePath);
        if (paths.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 201)
            throw Error('Invalid dependency window');
        return this.call('dependents', { paths: paths.map(p => p.toLowerCase()), limit });
    }
    get(paths) { paths.forEach(memoryReferencePath); if (paths.length > 500)
        throw Error('Invalid metadata window'); return this.call('get', paths); }
    explain(q) { return this.call('explain', q); }
    graphQuery(q) {
        if (!['incoming', 'outgoing'].includes(q.direction) || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > 200
            || !Array.isArray(q.keys) || !q.keys.length || q.keys.length > 200
            || q.keys.some(k => typeof k !== 'string' || !k.length || k.length > 1024)
            || q.after !== undefined && (!/^[a-f0-9]{64}$/.test(q.after) || q.expectedGeneration === undefined)
            || q.expectedGeneration !== undefined && (!Number.isSafeInteger(q.expectedGeneration) || q.expectedGeneration < 0))
            throw Error('Invalid graph window');
        if (q.direction === 'outgoing')
            q.keys.forEach(memoryReferencePath);
        return { ...q, keys: [...new Set(q.direction === 'incoming' ? q.keys.map(referenceKey) : q.keys)] };
    }
    /** PRIVATE unresolved occurrences. Callers must re-resolve and authorize both endpoints.
     * An empty page never certifies absence of links in the Vault. */
    async graph(q) { return this.call('graph', this.graphQuery(q)); }
    async graphExplain(q) { return this.call('graphExplain', this.graphQuery(q)); }
    referenceQuery(keys, limit) {
        if (!Array.isArray(keys) || !keys.length || keys.length > 8 || keys.some(k => typeof k !== 'string' || !k.trim() || k.length > 1024)
            || !Number.isInteger(limit) || limit < 1 || limit > 64)
            throw Error('Invalid reference window');
        return { keys: [...new Set(keys.map(k => k.trim().toLocaleLowerCase()))], limit };
    }
    /** Private discovery only. Recheck live identities, ACL and generation before resolving. */
    referenceCandidates(keys, limit) { return this.call('references', this.referenceQuery(keys, limit)); }
    referenceExplain(keys, limit) { return this.call('referencesExplain', this.referenceQuery(keys, limit)); }
    unindexedGraph(paths) {
        paths.forEach(memoryReferencePath);
        if (paths.length > 128)
            throw Error('Invalid graph backfill window');
        return this.call('unindexedGraph', paths);
    }
    beginScan() { return this.call('beginScan'); }
    seen(paths) { if (paths.length > 128)
        throw Error('Invalid scan page'); return this.call('seen', paths); }
    finishScan() { return this.call('finishScan'); }
    async close() { if (this.closed)
        return; try {
        await this.call('close');
    }
    finally {
        this.closed = true;
        await this.worker.terminate();
    } }
}
