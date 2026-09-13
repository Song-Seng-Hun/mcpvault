import { compilationHash, compilationPath } from './compilation-policy.js';
import { hookHash, hookId, validateCodexHookConfig } from './codex-hook-policy.js';
import { loadHostWorkStorage } from './host-work-storage.js';
const unavailable = () => Error('Prepared checkpoint unavailable');
const record = (v, keys) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
        throw unavailable();
    return v;
};
function payload(value, paths) {
    const p = record(value, ['topic', 'summary', 'nextAction', 'references']);
    for (const key of ['topic', 'summary', 'nextAction'])
        if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 4000)
            throw unavailable();
    if (!Array.isArray(p.references) || p.references.length > 32 || JSON.stringify(p).length > 16000)
        throw unavailable();
    for (const value of p.references) {
        const r = record(value, ['path', 'revision']);
        if (!paths.includes(compilationPath(r.path)) || !hookHash(r.revision))
            throw unavailable();
    }
    return structuredClone(p);
}
const entryRevision = (entry) => {
    const { revision: _revision, payload: _payload, ...basis } = entry;
    return compilationHash(basis);
};
function parse(value) {
    if (value === undefined)
        return { version: 1, entries: [] };
    const state = record(value, ['version', 'entries']);
    if (state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 64)
        throw unavailable();
    const ids = new Set();
    for (const value of state.entries) {
        const e = record(value, ['id', 'accountId', 'projectId', 'paths', 'authorityRevision', 'inputRevision', 'configRevision', 'payloadHash', 'revision', 'payload']);
        if (![e.id, e.accountId, e.projectId].every(hookId) || ids.has(e.id) || !Array.isArray(e.paths) || !e.paths.length || e.paths.length > 128
            || new Set(e.paths).size !== e.paths.length || ![e.authorityRevision, e.inputRevision, e.configRevision, e.payloadHash, e.revision].every(hookHash))
            throw unavailable();
        e.paths.forEach(compilationPath);
        if (e.revision !== entryRevision(e) || e.payload !== undefined && compilationHash(payload(e.payload, e.paths)) !== e.payloadHash)
            throw unavailable();
        ids.add(e.id);
    }
    return structuredClone(state);
}
/** Body preparation happens before shutdown, never from a transcript. A pending
 * restriction-only record survives body failure; no existing ID is overwritten.
 * Shutdown flush verifies bytes already durable in host-private storage only. */
export class CodexHookCheckpointStore {
    host;
    constructor(host) {
        this.host = host;
    }
    async current(context) {
        await context.assertCurrent();
        if (context.signal.aborted || Date.now() >= context.deadline)
            throw unavailable();
        const config = validateCodexHookConfig(await this.host.refresh()), t = context.ticket;
        const p = config.projects.find(p => p.id === t.projectId);
        if (!config.enabled || config.accountId !== t.accountId || !p?.actions.includes('checkpoint') || !t.paths.length
            || t.paths.some(path => !p.paths.includes(path)))
            throw unavailable();
        return compilationHash(config);
    }
    async prepare(id, value, context) {
        try {
            if (!hookId(id))
                throw unavailable();
            const configRevision = await this.current(context), t = context.ticket, body = payload(value, t.paths);
            const base = { id, accountId: t.accountId, projectId: t.projectId, paths: [...t.paths], authorityRevision: t.authorityRevision,
                inputRevision: t.inputRevision, configRevision, payloadHash: compilationHash(body) };
            const entry = { ...base, revision: entryRevision(base) };
            const writer = await this.host.acquire();
            try {
                const check = async () => { if (await this.current(context) !== configRevision)
                    throw unavailable(); await writer.assertHeld(); };
                await check();
                const state = parse(await this.host.readState());
                let existing = state.entries.find(e => e.id === id);
                if (existing && existing.revision !== entry.revision)
                    throw unavailable();
                if (!existing) {
                    if (state.entries.length >= 64)
                        throw unavailable();
                    state.entries.push(entry);
                    await check();
                    await this.host.writeState(state);
                    existing = entry;
                }
                await check();
                if (!existing.payload) {
                    existing.payload = body;
                    await this.host.writeState(state);
                }
                await check();
                const saved = parse(await this.host.readState()).entries.find(e => e.id === id);
                if (saved?.revision !== entry.revision || !saved.payload)
                    throw unavailable();
                await check();
                return { revision: entry.revision };
            }
            finally {
                await writer.close();
            }
        }
        catch {
            throw unavailable();
        }
    }
    flush(id, revision, context) { return this.inspect(id, revision, context); }
    inspect(id, revision, context) { return this.inspectRecord(id, revision, context, false); }
    read(id, revision, context) { return this.inspectRecord(id, revision, context, true); }
    async inspectRecord(id, revision, context, includeBody) {
        try {
            const configRevision = await this.current(context), state = parse(await this.host.readState()), t = context.ticket;
            const entry = state.entries.find(e => e.id === id);
            if (!entry?.payload || entry.revision !== revision || entry.accountId !== t.accountId || entry.projectId !== t.projectId
                || entry.configRevision !== configRevision || entry.authorityRevision !== t.authorityRevision || entry.inputRevision !== t.inputRevision
                || compilationHash(entry.paths) !== compilationHash(t.paths))
                return { status: 'partial' };
            if (await this.current(context) !== configRevision)
                throw unavailable();
            return { status: 'completed', revision: entry.revision, ...(includeBody && { packet: { checkpoint: structuredClone(entry.payload) } }) };
        }
        catch {
            throw unavailable();
        }
    }
}
export const loadCodexHookCheckpointStore = async (path, vaultPath) => new CodexHookCheckpointStore(await loadHostWorkStorage(path, vaultPath, { namespace: 'codex-checkpoints', maxStateBytes: 2 * 1024 * 1024, validate: validateCodexHookConfig }));
