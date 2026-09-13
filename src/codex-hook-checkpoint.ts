import { compilationHash, compilationPath } from './compilation-policy.js';
import { hookHash, hookId, validateCodexHookConfig } from './codex-hook-policy.js';
import { loadHostWorkStorage } from './host-work-storage.js';
import type { CodexHookHost } from './codex-hook-host.js';
import type { CodexHookContext, CodexHookOutcome } from './codex-hook-service.js';
import type { CodexPreparedCheckpointStore } from './codex-hook-adapter.js';

interface Payload { topic: string; summary: string; nextAction: string; references: Array<{ path: string; revision: string }> }
interface Entry { id: string; accountId: string; projectId: string; paths: string[]; authorityRevision: string; inputRevision: string;
  configRevision: string; payloadHash: string; revision: string; payload?: Payload }
interface State { version: 1; entries: Entry[] }
const unavailable = () => Error('Prepared checkpoint unavailable');
const record = (v: unknown, keys: string[]): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw unavailable();
  return v as Record<string, any>;
};
function payload(value: unknown, paths: readonly string[]): Payload {
  const p = record(value, ['topic', 'summary', 'nextAction', 'references']);
  for (const key of ['topic', 'summary', 'nextAction']) if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 4000) throw unavailable();
  if (!Array.isArray(p.references) || p.references.length > 32 || JSON.stringify(p).length > 16000) throw unavailable();
  for (const value of p.references) {
    const r = record(value, ['path', 'revision']);
    if (!paths.includes(compilationPath(r.path)) || !hookHash(r.revision)) throw unavailable();
  }
  return structuredClone(p) as Payload;
}
const entryRevision = (entry: Omit<Entry, 'revision'> | Entry) => {
  const { revision: _revision, payload: _payload, ...basis } = entry as Entry; return compilationHash(basis);
};
function parse(value: unknown): State {
  if (value === undefined) return { version: 1, entries: [] };
  const state = record(value, ['version', 'entries']);
  if (state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 64) throw unavailable();
  const ids = new Set<string>();
  for (const value of state.entries) {
    const e = record(value, ['id', 'accountId', 'projectId', 'paths', 'authorityRevision', 'inputRevision', 'configRevision', 'payloadHash', 'revision', 'payload']);
    if (![e.id, e.accountId, e.projectId].every(hookId) || ids.has(e.id) || !Array.isArray(e.paths) || !e.paths.length || e.paths.length > 128
      || new Set(e.paths).size !== e.paths.length || ![e.authorityRevision, e.inputRevision, e.configRevision, e.payloadHash, e.revision].every(hookHash)) throw unavailable();
    e.paths.forEach(compilationPath);
    if (e.revision !== entryRevision(e as Entry) || e.payload !== undefined && compilationHash(payload(e.payload, e.paths)) !== e.payloadHash) throw unavailable();
    ids.add(e.id);
  }
  return structuredClone(state) as State;
}
/** Body preparation happens before shutdown, never from a transcript. A pending
 * restriction-only record survives body failure; no existing ID is overwritten.
 * Shutdown flush verifies bytes already durable in host-private storage only. */
export class CodexHookCheckpointStore implements CodexPreparedCheckpointStore {
  constructor(private readonly host: CodexHookHost) {}
  private async current(context: CodexHookContext): Promise<string> {
    await context.assertCurrent();
    if (context.signal.aborted || Date.now() >= context.deadline) throw unavailable();
    const config = validateCodexHookConfig(await this.host.refresh()), t = context.ticket;
    const p = config.projects.find(p => p.id === t.projectId);
    if (!config.enabled || config.accountId !== t.accountId || !p?.actions.includes('checkpoint') || !t.paths.length
      || t.paths.some(path => !p.paths.includes(path))) throw unavailable();
    return compilationHash(config);
  }
  async prepare(id: string, value: unknown, context: CodexHookContext): Promise<{ revision: string }> {
    try {
      if (!hookId(id)) throw unavailable();
      const configRevision = await this.current(context), t = context.ticket, body = payload(value, t.paths);
      const base = { id, accountId: t.accountId, projectId: t.projectId, paths: [...t.paths], authorityRevision: t.authorityRevision,
        inputRevision: t.inputRevision, configRevision, payloadHash: compilationHash(body) };
      const entry: Entry = { ...base, revision: entryRevision(base) };
      const writer = await this.host.acquire();
      try {
        const check = async () => { if (await this.current(context) !== configRevision) throw unavailable(); await writer.assertHeld(); };
        await check(); const state = parse(await this.host.readState());
        let existing = state.entries.find(e => e.id === id);
        if (existing && existing.revision !== entry.revision) throw unavailable();
        if (!existing) {
          if (state.entries.length >= 64) throw unavailable();
          state.entries.push(entry); await check(); await this.host.writeState(state); existing = entry;
        }
        await check();
        if (!existing.payload) { existing.payload = body; await this.host.writeState(state); }
        await check();
        const saved = parse(await this.host.readState()).entries.find(e => e.id === id);
        if (saved?.revision !== entry.revision || !saved.payload) throw unavailable();
        await check(); return { revision: entry.revision };
      } finally { await writer.close(); }
    } catch { throw unavailable(); }
  }
  flush(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome> { return this.inspect(id, revision, context); }
  inspect(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome> { return this.inspectRecord(id, revision, context, false); }
  read(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome> { return this.inspectRecord(id, revision, context, true); }
  private async inspectRecord(id: string, revision: string, context: CodexHookContext, includeBody: boolean): Promise<CodexHookOutcome> {
    try {
      const configRevision = await this.current(context), state = parse(await this.host.readState()), t = context.ticket;
      const entry = state.entries.find(e => e.id === id);
      if (!entry?.payload || entry.revision !== revision || entry.accountId !== t.accountId || entry.projectId !== t.projectId
        || entry.configRevision !== configRevision || entry.authorityRevision !== t.authorityRevision || entry.inputRevision !== t.inputRevision
        || compilationHash(entry.paths) !== compilationHash(t.paths)) return { status: 'partial' };
      if (await this.current(context) !== configRevision) throw unavailable();
      return { status: 'completed', revision: entry.revision, ...(includeBody && { packet: { checkpoint: structuredClone(entry.payload) } }) };
    } catch { throw unavailable(); }
  }
}
export const loadCodexHookCheckpointStore = async (path: string, vaultPath: string): Promise<CodexHookCheckpointStore> =>
  new CodexHookCheckpointStore(await loadHostWorkStorage(path, vaultPath,
    { namespace: 'codex-checkpoints', maxStateBytes: 2 * 1024 * 1024, validate: validateCodexHookConfig }));
