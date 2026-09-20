import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { memoryEntries, memoryReferencePath } from '../memory-contract.js';
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
            return { ...row, entries, edges: entries.flatMap(e => ['basis', 'corrects'].flatMap(kind => (e[kind] || []).map(r => ({ kind, target: memoryReferencePath(r.path).toLowerCase() })))) };
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
