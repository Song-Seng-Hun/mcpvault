import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, readdir, rename, link } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { loadHostWorkStorage, type HostWorkWriter } from './host-work-storage.js';
import { loadCompilationHostConfig } from './compilation-host.js';
import { loadEvolutionStorage } from './evolution/host.js';
import { EvolutionRepository } from './evolution/repository.js';
import { EvolutionRuntimeEvidence } from './evolution/runtime-evidence.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';

type FixtureState = { version: 1; marker: string };
const validate = (value: unknown): FixtureState & { enabled: boolean } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid fixture state');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.marker !== 'string' || typeof raw.enabled !== 'boolean') throw new Error('invalid fixture state');
  return { version: 1, marker: raw.marker, enabled: raw.enabled };
};

let root: string, vault: string, hostRoot: string, config: string, identity: string;
const writers: HostWorkWriter[] = [];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'host-work-storage-')));
  vault = join(root, 'Vault'); hostRoot = join(root, 'Host'); config = join(hostRoot, 'config.json');
  await mkdir(vault); await mkdir(hostRoot, { mode: 0o700 });
  identity = createHash('sha256').update((await realpath(vault)).toLowerCase()).digest('hex');
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [hostRoot, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  await writeFile(config, JSON.stringify({ version: 1, enabled: true, marker: 'config', vaultPath: vault }), { mode: 0o600 });
});

afterEach(async () => {
  for (const writer of writers) await writer.close().catch(() => {});
  writers.length = 0;
  await rm(root, { recursive: true, force: true });
});

test('maintenance and compilation use isolated state and leases', async () => {
  const maintenance = await loadHostWorkStorage(config, vault, { namespace: 'maintenance', maxStateBytes: 4096, validate });
  const compilation = await loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, validate });
  const maintenanceWriter = await maintenance.acquire();
  const compilationWriter = await compilation.acquire();
  writers.push(maintenanceWriter, compilationWriter);
  await maintenance.readState(); await compilation.readState();
  await maintenance.writeState({ version: 1, enabled: true, marker: 'maintenance' });
  await compilation.writeState({ version: 1, enabled: true, marker: 'compilation' });
  await expect(maintenance.readState()).resolves.toMatchObject({ marker: 'maintenance' });
  await expect(compilation.readState()).resolves.toMatchObject({ marker: 'compilation' });
  await maintenanceWriter.close(); await compilationWriter.close();
  expect(await readdir(hostRoot)).toEqual(expect.arrayContaining([
    `maintenance-${identity}.json`, `compilation-${identity}.json`,
  ]));
});

test('evolution records use private native storage, survive restart, and reject policy revocation', async () => {
  await writeFile(config, JSON.stringify({ version: 1, enabled: true, vaultPath: vault }), { mode: 0o600 });
  const store = await loadEvolutionStorage(config, vault), writer = await store.acquire(); writers.push(writer);
  const current = async () => { if (!(await store.refresh()).enabled) throw Error('revoked'); await writer.assertHeld(); };
  const repo = new EvolutionRepository(store.records!, 'owner:test', current, 'alice');
  const prior = await repo.read('feedback', 'sample');
  const saved = await repo.write('feedback', 'sample', { version: 1, marker: '한국어 synthetic' }, prior.revision);
  await repo.add('feedback', 'sample'); await writer.close();
  const reopened = await loadEvolutionStorage(config, vault);
  const next = new EvolutionRepository(reopened.records!, 'owner:test', async () => { if (!(await reopened.refresh()).enabled) throw Error('revoked'); }, 'alice');
  expect(await next.read('feedback', 'sample')).toEqual({ revision: saved.revision, value: { version: 1, marker: '한국어 synthetic' } });
  expect((await next.index()).value.feedback).toEqual(['sample']);
  await writeFile(config, JSON.stringify({ version: 1, enabled: false, vaultPath: vault }), { mode: 0o600 });
  await expect(next.read('feedback', 'sample')).rejects.toThrow();
});

test('host evidence receipts survive native disk reopening without storing raw feedback or credentials', async () => {
  await writeFile(config, JSON.stringify({ version: 1, enabled: true, vaultPath: vault }), { mode: 0o600 });
  const principal: any = { accountId: 'alice', modelId: 'model', role: 'agent' };
  const raw = { id: 'f', taskId: 't', sessionId: 's', target: { kind: 'persona', id: 'assistant' }, scope: { kind: 'account', id: 'alice' },
    kind: 'preference', signal: 'explicit', key: 'verbosity', value: 'brief', summary: 'Private synthetic feedback marker', basis: [] };
  const store = new EvolutionRuntimeEvidence({ storage: await loadEvolutionStorage(config, vault), authorize: async () => 'authority' });
  const token = await store.captureFeedback(principal, raw, 'human', 'host-event');
  const reopened = new EvolutionRuntimeEvidence({ storage: await loadEvolutionStorage(config, vault), authorize: async () => 'authority' });
  expect(await reopened.attest(token, principal, raw)).toMatchObject({ origin: 'human', eventId: 'host-event' });
  for (const name of (await readdir(hostRoot)).filter(name => name.includes('.record-'))) {
    expect(await readFile(join(hostRoot, name), 'utf8')).not.toContain(raw.summary);
  }
  await writeFile(config, JSON.stringify({ version: 1, enabled: false, vaultPath: vault }), { mode: 0o600 });
  await expect(reopened.attest(token, principal, raw)).rejects.toThrow();
});

test('a namespace lease does not block the other namespace', async () => {
  const maintenance = await loadHostWorkStorage(config, vault, { namespace: 'maintenance', maxStateBytes: 4096, validate });
  const compilation = await loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, validate });
  const maintenanceWriter = await maintenance.acquire();
  const compilationWriter = await compilation.acquire();
  writers.push(maintenanceWriter, compilationWriter);
  await maintenanceWriter.close(); await compilationWriter.close();
});

test('hook receipts and leases are separate from both prior grants', async () => {
  const stores = await Promise.all((['maintenance', 'compilation', 'codex-hooks', 'codex-checkpoints'] as const).map(namespace =>
    loadHostWorkStorage(config, vault, { namespace, maxStateBytes: 4096, validate })));
  for (const [index, store] of stores.entries()) {
    writers.push(await store.acquire()); await store.readState();
    await store.writeState({ version: 1, marker: String(index) });
  }
  for (const [index, store] of stores.entries()) expect(await store.readState()).toEqual({ version: 1, marker: String(index) });
});

test.each(['maintenance', 'compilation', 'codex-hooks'] as const)('rejects %s configuration overlapping hook receipts', async namespace => {
  const target = join(hostRoot, `codex-hooks-${identity}.json`);
  await writeFile(target, '{}', { mode: 0o600 });
  await expect(loadHostWorkStorage(target, vault, { namespace, maxStateBytes: 4096, validate })).rejects.toThrow(/overlaps managed host storage/);
});

test.each(['maintenance', 'compilation', 'codex-hooks', 'codex-checkpoints'] as const)('rejects %s configuration overlapping prepared checkpoints', async namespace => {
  const target = join(hostRoot, `codex-checkpoints-${identity}.json`);
  await writeFile(target, '{}', { mode: 0o600 });
  await expect(loadHostWorkStorage(target, vault, { namespace, maxStateBytes: 4096, validate })).rejects.toThrow(/overlaps managed host storage/);
});

test('captures namespace, limit, and validator before and after asynchronous loading', async () => {
  let options: { namespace: 'maintenance' | 'compilation'; maxStateBytes: number; validate: typeof validate } = {
    namespace: 'maintenance', maxStateBytes: 4096, validate,
  };
  const loading = loadHostWorkStorage(config, vault, options);
  options.namespace = 'compilation'; options.maxStateBytes = 1;
  options.validate = () => { throw new Error('mutated validator must not run'); };
  const storage = await loading;
  expect((await storage.refresh()).enabled).toBe(true);
  options.namespace = 'compilation'; options.maxStateBytes = 1;
  options.validate = () => { throw new Error('post-load validator must not run'); };
  const writer = await storage.acquire();
  writers.push(writer);
  await storage.readState();
  await storage.writeState({ version: 1, enabled: true, marker: 'stable' });
  await writer.close();
  expect(await readdir(hostRoot)).toEqual(expect.arrayContaining([`maintenance-${identity}.json`].map(name => name)));
});

test.each([
  ['maintenance', `maintenance-${'x'.repeat(64)}.json`],
  ['compilation', `compilation-${'x'.repeat(64)}.writer.lock`],
] as const)('rejects config collision with managed %s storage', async (namespace, filename) => {
  const target = join(hostRoot, filename.replace('x'.repeat(64), identity));
  await writeFile(target, '{}', { mode: 0o600 });
  await expect(loadHostWorkStorage(target, vault, { namespace, maxStateBytes: 4096, validate })).rejects.toThrow(/overlaps managed host storage/i);
});

test('rejects an invalid namespace at runtime', async () => {
  await expect(loadHostWorkStorage(config, vault, { namespace: 'maintenance\u0000' as never, maxStateBytes: 4096, validate })).rejects.toThrow(/namespace/i);
});

const recordId = (text: string) => createHash('sha256').update(text).digest('hex');
const recordPath = (id: string) => join(hostRoot, `compilation-${identity}.record-${id}.json`);
const paged = () => loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, maxRecordBytes: 1024, validate });

test('cancelled request releases only its owned host lease without permitting another record write', async () => {
  const store = await paged(), id = recordId('cancelled'); let current = true;
  const access = { hasDocumentPolicy: () => true, getEnterpriseProfile: () => undefined } as any;
  await withEnterpriseStorageContext({ access, assertFresh: () => { if (!current) throw Error('request cancelled'); } }, async () => {
    const writer = await store.acquire(); writers.push(writer);
    await store.records!.read(id); const saved = await store.records!.write(id, { kept: true }, 'missing');
    current = false;
    await expect(store.records!.write(id, { forbidden: true }, saved.revision)).rejects.toThrow(/cancelled/);
    await expect(writer.close()).resolves.toBeUndefined();
  });
  expect((await readdir(hostRoot)).filter(name => name.endsWith('.writer.lock'))).toEqual([]);
  expect((await store.records!.read(id)).value).toEqual({ kept: true });
  writers.push(await store.acquire());
});

test('cleanup cannot shed a document boundary inherited by storage construction', async () => {
  let current = true;
  const access = { hasDocumentPolicy: () => true, getEnterpriseProfile: () => undefined } as any;
  await withEnterpriseStorageContext({ access, assertFresh: () => { if (!current) throw Error('owner revoked'); } }, async () => {
    const store = await paged(), writer = await store.acquire(); writers.push(writer); current = false;
    await expect(writer.close()).rejects.toThrow(/owner revoked/);
  });
  expect((await readdir(hostRoot)).filter(name => name.endsWith('.writer.lock'))).toHaveLength(1);
});

test('cancelled cleanup preserves a replaced marker even when its bytes match', async () => {
  const store = await paged(), marker = join(hostRoot, `compilation-${identity}.writer.lock`); let current = true;
  const access = { hasDocumentPolicy: () => true, getEnterpriseProfile: () => undefined } as any;
  let replacement = '';
  await withEnterpriseStorageContext({ access, assertFresh: () => { if (!current) throw Error('request cancelled'); } }, async () => {
    const writer = await store.acquire(); writers.push(writer); replacement = await readFile(marker, 'utf8');
    await rename(marker, marker + '.previous'); await writeFile(marker, replacement, { mode: 0o600 }); current = false;
    await expect(writer.close()).rejects.toThrow();
  });
  expect(await readFile(marker, 'utf8')).toBe(replacement);
});

test('bounded host records survive restart without replacing legacy state', async () => {
  const store = await paged();
  expect(store.records).toBeDefined();
  writers.push(await store.acquire()); await store.readState();
  const legacy = { version: 1, jobs: [{ requestId: 'keep-original' }] };
  await store.writeState(legacy);
  for (const name of ['page-0', 'page-1', 'receipt-1']) {
    const id = recordId(name), prior = await store.records!.read(id);
    expect(prior).toEqual({ revision: 'missing', value: undefined });
    const saved = await store.records!.write(id, { name, text: '승인 required. 😀' }, prior.revision);
    expect(saved.revision).toMatch(/^[a-f0-9]{64}$/);
  }
  await writers[0]!.close();
  const restarted = await paged();
  expect(await restarted.readState()).toEqual(legacy);
  expect((await restarted.records!.read(recordId('page-1'))).value).toEqual({ name: 'page-1', text: '승인 required. 😀' });
  expect(await readdir(vault)).toEqual([]);
  const unpaged = await loadHostWorkStorage(config, vault, { namespace: 'compilation', maxStateBytes: 4096, validate });
  expect(unpaged.records).toBeUndefined();
});

test('host record writes require a read, live lease and current record revision', async () => {
  const store = await paged(); expect(store.records).toBeDefined();
  const id = recordId('record');
  await store.records!.read(id);
  await expect(store.records!.write(id, {}, 'missing')).rejects.toThrow(/writer/i);
  writers.push(await store.acquire());
  await expect(store.records!.write(recordId('unread'), {}, 'missing')).rejects.toThrow(/read/i);
  const saved = await store.records!.write(id, { kept: true }, 'missing');
  await expect(store.records!.write(id, {}, 'missing')).rejects.toThrow(/revision|changed/i);
  await writeFile(recordPath(id), JSON.stringify({ manual: true }));
  await expect(store.records!.write(id, {}, saved.revision)).rejects.toThrow(/changed/i);
  expect(JSON.parse(await readFile(recordPath(id), 'utf8'))).toEqual({ manual: true });
});

test('same-byte replacement and hard links never authorize record replacement', async () => {
  const store = await paged(); expect(store.records).toBeDefined();
  writers.push(await store.acquire());
  const id = recordId('identity'); await store.records!.read(id);
  const saved = await store.records!.write(id, { original: true }, 'missing');
  const bytes = await readFile(recordPath(id), 'utf8');
  await rename(recordPath(id), recordPath(id) + '.previous');
  await writeFile(recordPath(id), bytes, { mode: 0o600 });
  await expect(store.records!.write(id, {}, saved.revision)).rejects.toThrow(/changed/i);
  await link(recordPath(id), recordPath(id) + '.link');
  await expect(store.records!.read(id)).rejects.toThrow(/hard link/i);
  expect(await readFile(recordPath(id), 'utf8')).toBe(bytes);
});

test('corrupt history and revoked approval leave existing record bytes untouched', async () => {
  const store = await paged(); expect(store.records).toBeDefined();
  writers.push(await store.acquire()); const id = recordId('corrupt');
  await store.records!.read(id); const saved = await store.records!.write(id, { kept: true }, 'missing');
  await writeFile(config, JSON.stringify({ version: 1, enabled: false, marker: 'config', vaultPath: vault }));
  await expect(store.records!.write(id, {}, saved.revision)).rejects.toThrow(/revoked|closed/i);
  expect(JSON.parse(await readFile(recordPath(id), 'utf8'))).toEqual({ kept: true });
  await writeFile(recordPath(id), '{damaged');
  await expect(store.records!.read(id)).rejects.toThrow();
  expect(await readFile(recordPath(id), 'utf8')).toBe('{damaged');
});

test('record storage enforces opaque IDs, individual byte limits and configuration separation', async () => {
  const store = await paged(); expect(store.records).toBeDefined(); writers.push(await store.acquire());
  for (const id of ['../config', 'A'.repeat(64), 'page-1', '']) await expect(store.records!.read(id)).rejects.toThrow(/record/i);
  const id = recordId('bounded'); await store.records!.read(id);
  await expect(store.records!.write(id, { text: '한'.repeat(400) }, 'missing')).rejects.toThrow(/size|full|limit/i);
  expect((await store.records!.read(id)).revision).toBe('missing');
  await writeFile(recordPath(id), '{}', { mode: 0o600 });
  await expect(loadHostWorkStorage(recordPath(id), vault, { namespace: 'maintenance', maxStateBytes: 4096, validate })).rejects.toThrow(/overlap/i);
});

test('compilation host exposes bounded pages without granting chapter conversion', async () => {
  await writeFile(config, JSON.stringify({ vaultPath: vault, version: 1, enabled: true, accountId: 'owner', projects: [{
    id: 'project', ruleVersion: '1', sources: [{ path: 'Source.md', classification: 'resolved', mode: 'source_only' }],
    outputPaths: ['Draft.md'], runtimeIds: ['local'], operations: ['index'],
  }] }));
  const store = await loadCompilationHostConfig(config, vault);
  expect(store.records).toBeDefined();
  expect((await store.refresh()).projects[0]).not.toHaveProperty('chapterBundles');
});

test('host record commit rechecks the owner guard after preparing temporary bytes', async () => {
  const store = await paged(); writers.push(await store.acquire());
  const id = recordId('guard'); await store.records!.read(id); let calls = 0;
  await expect(store.records!.write(id, { body: 'new' }, 'missing', async () => {
    if (++calls === 2) throw new Error('Source or authority changed');
  })).rejects.toThrow('Source or authority changed');
  expect((await store.records!.read(id)).value).toBeUndefined();
  expect(calls).toBe(2);
});
