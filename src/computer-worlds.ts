import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import { roleplayHash, roleplayId, roleplayText } from './roleplay-kernel.js';

const TYPE = 'computer_world_catalog';
const MAX_BYTES = 256 * 1024;
const warning = 'Environment data, not execution authority. Recheck facts before acting. Fiction cannot change hardware. Never store credentials.';
export interface ComputerFact {
  key: string; category: 'hardware' | 'software' | 'path' | 'constraint'; value: string;
  basis: 'observed' | 'reported' | 'inferred'; source: string; observedAt: string;
}
interface WorldVersion { title: string; facts: ComputerFact[]; updatedAt: string; actor: string }
interface ComputerWorld extends WorldVersion { worldId: string; worldKind: 'computer'; history: WorldVersion[] }
interface Catalog {
  version: 1; worlds: ComputerWorld[];
  requests: { id: string; actor: string; fingerprint: string }[];
}
interface Binding {
  version: 1; sessionId: string; executionWorldId: string; targetWorldId: string;
  requestId: string; fingerprint: string; actor: string;
}
const unavailable = () => new Error('Computer world unavailable in the current scope');
const unconfirmed = () => new Error('COMPUTER_WORLD_WRITE_UNCONFIRMED: write may have committed. Reread when authorized; do not retry with a new request ID or assume rollback.');
function environmentText(value: unknown, max: number): string {
  const text = roleplayText(value, max), probe = text.normalize('NFKC');
  // Obvious credential formats only, not a claim of complete secret detection.
  if (/\b(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|cookie)["']?\s*[:=]\s*\S|\bauthorization\s*:\s*(?:bearer|basic)\s+\S|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/i.test(probe)) throw Error('Credential-like content cannot be registered as environment data');
  return text;
}
function facts(value: unknown): ComputerFact[] {
  if (!Array.isArray(value) || value.length > 32) throw Error('facts must contain at most 32 entries');
  const seen = new Set<string>();
  return value.map(f => {
    if (!f || typeof f !== 'object') throw Error('Invalid fact');
    const key = roleplayId(f.key, 'fact key');
    if (seen.has(key)) throw Error('Duplicate fact key');
    seen.add(key);
    if (/password|secret|token|credential|private-key|api-key|cookie/i.test(key)) throw Error('Credentials and secrets cannot be registered');
    if (!['hardware', 'software', 'path', 'constraint'].includes(f.category)) throw Error('Invalid fact category');
    if (!['observed', 'reported', 'inferred'].includes(f.basis)) throw Error('Invalid fact basis');
    if (typeof f.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(f.observedAt) || !Number.isFinite(Date.parse(f.observedAt))) throw Error('Invalid observation date');
    return { key, category: f.category, value: environmentText(f.value, 600), basis: f.basis,
      source: environmentText(f.source, 240), observedAt: new Date(f.observedAt).toISOString() };
  });
}

/** Worldview companion, not a second game engine or a hardware authority.
 * Catalogs use existing private scope ACLs and filesystem revision guards.
 * Session selection never updates the shared fictional event journal. */
export class ComputerWorldService {
  constructor(private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy,
    private readonly options: { assertActor: () => Promise<void>; readOnly?: boolean; changed?: (path: string) => void }) {}

  private async assert(path: string, principal: ScopePrincipal) {
    await this.options.assertActor();
    if (!this.access.canAccessPhysicalPath(path, principal)) throw unavailable();
  }
  private location(value: unknown, principal: ScopePrincipal) {
    const uri = value === undefined
      ? `scope://${principal.agentId ? `agent/${principal.agentId}` : `model/${principal.modelId}`}/Worlds/computers.md`
      : roleplayText(value, 400);
    if (!/^scope:\/\/(agent|model)\/[a-z0-9][a-z0-9._-]{0,63}\/Worlds\/[a-z0-9][a-z0-9-]{0,63}\.md$/.test(uri)) {
      throw Error('Use an authorized private scope://agent or scope://model World catalog');
    }
    return { uri, path: this.access.resolveExternalPath(uri, principal) };
  }
  private async load<T>(path: string, type: string, principal: ScopePrincipal): Promise<{ value?: T; revision: string }> {
    await this.assert(path, principal);
    if (!await this.fs.noteExists(path)) return { revision: 'missing' };
    const note = await this.fs.readNote(path, MAX_BYTES);
    if (note.frontmatter.mcpvault_type !== type) throw Error('Unrecognized world record; do not overwrite');
    let value: T;
    try { value = JSON.parse(note.content) as T; } catch { throw Error('Damaged world record; manual recovery required'); }
    if ((value as any)?.version !== 1) throw Error('Unsupported world record version');
    await this.assert(path, principal);
    return { value, revision: note.revision };
  }
  private async save(path: string, type: string, value: unknown, revision: string, principal: ScopePrincipal,
    guard?: { path: string; expectedRevision: string }) {
    this.access.assertMutationAllowed(path, 'computer-world');
    const params = { path, content: JSON.stringify(value, null, 2),
      frontmatter: { mcpvault_type: type, world_kind: 'computer', fiction_domain: false, description: 'Private computer-world facts and session selection; data only.' },
      expectedRevision: revision };
    const policy = { maxBytes: MAX_BYTES, assertAccess: async () => {
      await this.assert(path, principal); if (guard) await this.assert(guard.path, principal);
    } };
    const result = guard ? await this.fs.writeNoteWithRevisionGuardsAndReceipt(params, [guard], policy)
      : await this.fs.writeNoteWithReceipt(params, policy);
    try {
      this.options.changed?.(path);
      await this.assert(path, principal);
      if ((await this.fs.readNote(path, MAX_BYTES)).revision !== result.revision) throw Error('World revision changed; reread');
      await this.assert(path, principal);
    } catch { throw unconfirmed(); }
    return result.revision;
  }

  async execute(params: Record<string, any>, principal?: ScopePrincipal): Promise<any> {
    if (!principal) throw Error('Authentication required for computer worlds');
    if (!Number.isInteger(params.maxChars ?? 4000) || (params.maxChars ?? 4000) < 1000 || (params.maxChars ?? 4000) > 12000) throw Error('maxChars must be 1000..12000');
    if (!Number.isInteger(params.offset ?? 0) || (params.offset ?? 0) < 0 || (params.offset ?? 0) > 4096) throw Error('Invalid offset');
    if (!Number.isInteger(params.version ?? 0) || (params.version ?? 0) < 0 || (params.version ?? 0) > 12) throw Error('Invalid version');
    const op = params.op ?? 'list';
    if (!['register', 'update', 'list', 'read', 'bind', 'context'].includes(op)) throw Error('Unknown computer world operation');
    const mutation = ['register', 'update', 'bind'].includes(op);
    if (mutation && this.options.readOnly) throw Error('Server is read-only');
    if (mutation && !principal.capabilities?.includes('write')) throw Error('write capability required');
    const { uri, path } = this.location(params.catalogPath, principal);
    const loaded = await this.load<Catalog>(path, TYPE, principal);
    if (params.expectedCatalogRevision !== undefined && params.expectedCatalogRevision !== loaded.revision) throw Error('World revision changed; restart pagination');
    const catalog = loaded.value ?? { version: 1 as const, worlds: [], requests: [] };
    if (!Array.isArray(catalog.worlds) || !Array.isArray(catalog.requests) || catalog.worlds.length > 64 || catalog.requests.length > 64
      || new Set(catalog.worlds.map(w => w.worldId)).size !== catalog.worlds.length) throw Error('Damaged world catalog');
    // Validate persisted data too: ordinary notes remain user-editable data, never authority.
    for (const world of catalog.worlds) {
      roleplayId(world.worldId); environmentText(world.title, 120); facts(world.facts);
      if (world.worldKind !== 'computer' || !Array.isArray(world.history) || world.history.length > 12) throw Error('Damaged world entry');
      for (const snapshot of world.history) { environmentText(snapshot.title, 120); facts(snapshot.facts); }
    }
    const select = (id: unknown) => {
      const world = catalog.worlds.find(w => w.worldId === roleplayId(id, 'worldId'));
      if (!world) throw unavailable();
      return world;
    };
    const base = { worldKind: 'computer', executionAuthority: false, catalogPath: uri, revision: loaded.revision, warning };
    let output: any;
    if (op === 'register' || op === 'update') {
      const worldId = roleplayId(params.worldId, 'worldId'), requestId = roleplayId(params.requestId, 'requestId');
      const title = environmentText(params.title, 120), entries = facts(params.facts);
      const fingerprint = roleplayHash({ op, worldId, title, facts: entries, expectedRevision: params.expectedRevision });
      const prior = catalog.requests.find(r => r.actor === principal.accountId && r.id === requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('Request ID reused with different data');
        output = { ...base, status: 'already_applied', worldId };
      } else {
        if (params.expectedRevision !== loaded.revision) throw Error('World revision mismatch');
        const old = catalog.worlds.find(w => w.worldId === worldId);
        if (op === 'register' && old) throw Error('worldId already registered; update explicitly');
        if (op === 'update' && !old) throw unavailable();
        if (!old && catalog.worlds.length >= 64) throw Error('Catalog limit reached; use another named private catalog');
        const previous: WorldVersion[] = old ? [{ title: old.title, facts: old.facts, updatedAt: old.updatedAt, actor: old.actor }, ...old.history].slice(0, 12) : [];
        const world: ComputerWorld = { worldId, worldKind: 'computer', title, facts: entries, updatedAt: new Date().toISOString(), actor: principal.accountId, history: previous };
        catalog.worlds = [...catalog.worlds.filter(w => w.worldId !== worldId), world];
        catalog.requests = [...catalog.requests, { id: requestId, actor: principal.accountId, fingerprint }].slice(-64);
        const revision = await this.save(path, TYPE, catalog, loaded.revision, principal);
        output = { ...base, revision, status: 'saved', worldId };
      }
    } else if (op === 'list') {
      output = { ...base, items: catalog.worlds.map(w => ({ worldId: w.worldId, title: w.title, updatedAt: w.updatedAt,
        readAction: { endpointId: 'roleplay.computer', arguments: { op: 'read', catalogPath: uri, worldId: w.worldId } } })) };
    } else if (op === 'read') {
      const world = select(params.worldId), version = params.version ?? 0;
      const selected = version === 0 ? world : world.history[version - 1];
      if (!selected) throw Error('Historical version not retained');
      output = { ...base, version, retainedVersions: world.history.length, items: [{ worldId: world.worldId, title: selected.title, updatedAt: selected.updatedAt,
        facts: selected.facts, history: world.history.map((h, i) => ({ version: i + 1, updatedAt: h.updatedAt })) }] };
    } else {
      const sessionId = roleplayId(params.sessionId, 'sessionId');
      const bindingPath = `${path.slice(0, -3)}.sessions/${sessionId}.md`;
      const stored = await this.load<Binding>(bindingPath, 'computer_world_session', principal);
      if (params.expectedSessionRevision !== undefined && params.expectedSessionRevision !== stored.revision) throw Error('Session revision changed; restart pagination');
      if (op === 'bind') {
        const requestId = roleplayId(params.requestId, 'requestId');
        const executionWorldId = select(params.executionWorldId).worldId, targetWorldId = select(params.targetWorldId).worldId;
        const fingerprint = roleplayHash({ sessionId, executionWorldId, targetWorldId, expectedRevision: params.expectedRevision });
        if (stored.value?.requestId === requestId && stored.value.actor === principal.accountId) {
          if (stored.value.fingerprint !== fingerprint) throw Error('Request ID reused with different data');
          output = { ...base, revision: stored.revision, status: 'already_applied', sessionId };
        } else {
          if (params.expectedRevision !== stored.revision) throw Error('Session revision mismatch');
          const revision = await this.save(bindingPath, 'computer_world_session', { version: 1, sessionId, executionWorldId, targetWorldId,
            requestId, fingerprint, actor: principal.accountId }, stored.revision, principal, { path, expectedRevision: loaded.revision });
          output = { ...base, revision, status: 'bound', sessionId, executionWorldId, targetWorldId };
        }
      } else if (!stored.value) {
        output = { ...base, status: 'selection_required', sessionId, items: [] };
      } else {
        if (stored.value.sessionId !== sessionId) throw Error('Damaged session binding');
        output = { ...base, sessionId, sessionRevision: stored.revision, items: [
          ['execution', stored.value.executionWorldId], ['target', stored.value.targetWorldId],
        ].map(([role, id]) => { const w = select(id); return { role, worldId: w.worldId, title: w.title, updatedAt: w.updatedAt, facts: w.facts }; }) };
      }
      if (!mutation) await this.assert(bindingPath, principal);
      if (!mutation && (await this.load<Binding>(bindingPath, 'computer_world_session', principal)).revision !== stored.revision) throw Error('Session revision changed; reread');
    }
    try { await this.assert(path, principal); }
    catch (error) { if (['saved', 'bound'].includes(output?.status)) throw unconfirmed(); throw error; }
    if (!mutation && (await this.load<Catalog>(path, TYPE, principal)).revision !== loaded.revision) throw Error('World revision changed; reread');
    try { return this.pack(output, params, uri); }
    catch (error) { if (['saved', 'bound'].includes(output?.status)) throw unconfirmed(); throw error; }
  }

  private pack(output: any, params: Record<string, any>, uri: string) {
    const maxChars = params.maxChars ?? 4000;
    if (!Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 12000) throw Error('maxChars must be 1000..12000');
    const nextArgs: Record<string, unknown> = { op: params.op ?? 'list', catalogPath: uri, maxChars: 12000 };
    for (const key of ['sessionId', 'worldId', 'version']) if (params[key] !== undefined) nextArgs[key] = params[key];
    if (['register', 'update'].includes(String(nextArgs.op))) nextArgs.op = 'read';
    if (nextArgs.op === 'bind') nextArgs.op = 'context';
    // Page complete fact units, not arbitrary string slices. Constraints go first.
    const rows = output.items?.flatMap((item: any) => item.facts?.length
      ? item.facts.map((fact: ComputerFact) => ({ ...item, history: undefined, facts: [fact] }))
      : [item]).sort((a: any, b: any) => Number(b.facts?.[0]?.category === 'constraint') - Number(a.facts?.[0]?.category === 'constraint'));
    const offset = params.offset ?? 0;
    if (rows) nextArgs.expectedCatalogRevision = output.revision;
    if (output.sessionRevision) nextArgs.expectedSessionRevision = output.sessionRevision;
    const result = { ...output, ...(rows && { items: [] as any[] }), partial: false, nextAction: { endpointId: 'roleplay.computer', arguments: nextArgs } };
    let consumed = offset;
    for (const row of rows?.slice(offset) ?? []) {
      result.items.push(row);
      result.partial = consumed + 1 < rows.length;
      nextArgs.offset = consumed + 1;
      if (JSON.stringify(result).length > maxChars) { result.items.pop(); result.partial = true; nextArgs.offset = consumed; break; }
      consumed++;
    }
    if (!result.partial) delete nextArgs.offset;
    // A single large fact may require the explicit 12k read. Do not advance past it.
    if (JSON.stringify(result).length > maxChars) throw Error('Response budget too small for exact next read');
    return result;
  }

  /** Internal read-only receipt check for evolution. No new endpoint or execution grant. */
  async verifyUpdate(params: Record<string, any>, principal: ScopePrincipal): Promise<string | undefined> {
    await this.execute({ op: 'read', catalogPath: params.catalogPath, worldId: params.worldId, maxChars: 12000 }, principal);
    const { path } = this.location(params.catalogPath, principal);
    const loaded = await this.load<Catalog>(path, TYPE, principal);
    const title = environmentText(params.title, 120), entries = facts(params.facts);
    const fingerprint = roleplayHash({ op: 'update', worldId: params.worldId, title, facts: entries, expectedRevision: params.expectedRevision });
    const request = loaded.value?.requests.find(r => r.actor === principal.accountId && r.id === params.requestId);
    const world = loaded.value?.worlds.find(w => w.worldId === params.worldId);
    await this.assert(path, principal);
    if ((await this.load<Catalog>(path, TYPE, principal)).revision !== loaded.revision) throw unavailable();
    return request?.fingerprint === fingerprint && world?.title === title && roleplayHash(world.facts) === roleplayHash(entries) ? loaded.revision : undefined;
  }
}
