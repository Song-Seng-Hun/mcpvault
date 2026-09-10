import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RoleplayService } from './roleplay-service.js';
import { RoleplayStore } from './roleplay-store.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { roleplayRevision } from './roleplay-model.js';
import { trpgArtifacts } from './roleplay-trpg-projections.js';
import { assertRoleplayMutationBoundary, withRoleplayProjectionWrite } from './roleplay-boundary.js';
import type { ScopePrincipal } from './scope-auth.js';

let root: string, fs: FileSystemService, store: RoleplayStore, service: RoleplayService, access: ScopeAccessPolicy;
const principal: ScopePrincipal = { accountId: 'alice', modelId: 'gpt', agentId: 'alice', role: 'agent', capabilities: ['chat'] };
const paths = ['md', 'canvas', 'base'].map(ext => `Community/Roleplay/Sheets/alice.${ext}`);
const missing = { sheet: 'missing', canvas: 'missing', base: 'missing' };
async function args(extra = {}) { return { op: 'project', characterId: 'alice', generation: 1, requestId: 'projection', expectedRevision: roleplayRevision(await store.snapshot()), expectedArtifacts: missing, ...extra }; }
async function revisions() { const values = await Promise.all(paths.map(path => fs.readNoteRevision(path))); return { sheet: values[0], canvas: values[1], base: values[2] }; }
async function contents() { return Promise.all(paths.map(path => readFile(join(fs.getVaultPath(), path), 'utf8'))); }
async function learn() { await store.transact({ op: 'trpg_learn', actor: 'alice', requestId: 'learn', expectedRevision: roleplayRevision(await store.snapshot()), data: { characterId: 'alice', generation: 1, skillId: 'guard' } }); }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'trpg-project-')); const vaultPath = join(root, 'vault'), hostPath = join(root, 'host');
  await mkdir(vaultPath); await mkdir(hostPath); fs = new FileSystemService(vaultPath); access = new ScopeAccessPolicy();
  store = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['alice'] } });
  service = new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => {} });
  for (const [endpoint, op, data] of [['world', 'initialize', { title: 'Archive', places: { hall: [] } }], ['character', 'character', { id: 'alice', name: 'Alice', controller: 'alice', location: 'hall' }], ['trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' }]] as const) {
    await service.execute(endpoint, { op, ...data, requestId: op, expectedRevision: roleplayRevision(await store.snapshot()) }, principal);
  }
});
afterEach(async () => { vi.restoreAllMocks(); await store?.close(); if (root) await rm(root, { recursive: true, force: true }); });

test('export is read-only; project writes exact current-source artifacts and retries without a game turn', async () => {
  const before = await store.snapshot(), request = await args();
  const exported = await service.execute('trpg', { op: 'export', characterId: 'alice', maxChars: 12000, limit: 100 });
  expect(exported.items.filter((i: any) => i.kind === 'projectionTarget').map((i: any) => i.revision)).toEqual(['missing', 'missing', 'missing']);
  await expect(readFile(join(fs.getVaultPath(), paths[0]!))).rejects.toMatchObject({ code: 'ENOENT' });
  const result = await service.execute('trpg', request, principal);
  expect(result.projected).toBe(true); expect(result.sourceRevision).toBe(roleplayRevision(before));
  expect(await contents()).toEqual(trpgArtifacts(before, 'alice').map(f => f.content));
  const writer = vi.spyOn(fs, 'writeNoteWithReceipt');
  expect(await service.execute('trpg', request, principal)).toEqual(result); expect(writer).not.toHaveBeenCalled();
  expect(await store.snapshot()).toEqual(before);
  await expect(fs.writeNote({ path: paths[0]!, content: 'generic bypass' })).rejects.toThrow(/roleplay|Committed/);
});

test.each(['con', 'aux'])('export and project preserve device-like character IDs: %s', async characterId => {
  await service.execute('character', { op: 'character', id: characterId, name: characterId, controller: 'alice', location: 'hall',
    expectedRevision: roleplayRevision(await store.snapshot()), requestId: `create-${characterId}` }, principal);
  const before = await store.snapshot();
  const exported = await service.execute('trpg', { op: 'export', characterId, maxChars: 12000, limit: 100 });
  expect(exported.items.filter((i: any) => i.kind === 'projectionTarget')).toHaveLength(3);
  const projected = await service.execute('trpg', await args({ characterId, requestId: `project-${characterId}` }), principal);
  expect(projected.projected).toBe(true);
  for (const file of trpgArtifacts(before, characterId)) expect(await readFile(join(fs.getVaultPath(), file.path), 'utf8')).toBe(file.content);
  expect(await store.snapshot()).toEqual(before);
});

test('controller, generation, source, caller fields and all target revisions are checked before any writes', async () => {
  const writer = vi.spyOn(fs, 'writeNoteWithReceipt');
  await expect(service.execute('trpg', await args(), { ...principal, accountId: 'bob' })).rejects.toThrow(/control/);
  await expect(service.execute('trpg', await args({ generation: 2 }), principal)).rejects.toThrow(/generation/);
  await expect(service.execute('trpg', await args({ expectedRevision: '0'.repeat(64) }), principal)).rejects.toThrow(/revision/);
  await expect(service.execute('trpg', await args({ path: '../secret' }), principal)).rejects.toThrow(/field/);
  await expect(service.execute('trpg', await args({ expectedArtifacts: { ...missing, base: '0'.repeat(64) } }), principal)).rejects.toThrow(/revision/);
  expect(writer).not.toHaveBeenCalled();
});

test('export cursors pin target revisions and metadata reads are revalidated', async () => {
  const readArgs = { op: 'export', characterId: 'alice', maxChars: 2000, limit: 1 };
  const first = await service.execute('trpg', readArgs);
  expect(first.cursor).toBeTruthy(); expect(JSON.stringify(first).length).toBeLessThanOrEqual(2000);
  await service.execute('trpg', await args(), principal);
  await expect(service.execute('trpg', { ...readArgs, cursor: first.cursor })).rejects.toThrow(/cursor|Cursor|changed/);
  const original = fs.readNote.bind(fs); let calls = 0;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...a) => {
    const note = await original(...a);
    if (paths.includes(a[0]) && ++calls === 3) await writeFile(join(fs.getVaultPath(), paths[0]!), 'edit during export');
    return note;
  });
  await expect(service.execute('trpg', readArgs)).rejects.toThrow(/projection.*changed/i);
});

test('permission revocation during writes fails closed and reports incomplete rollback', async () => {
  await service.execute('trpg', await args(), principal); const request = await args({ expectedArtifacts: await revisions() });
  await learn(); request.expectedRevision = roleplayRevision(await store.snapshot());
  const original = fs.writeNoteWithReceipt.bind(fs); let revoked = false;
  service = new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => { if (revoked) throw new Error('Actor revoked'); } });
  const writer = vi.spyOn(fs, 'writeNoteWithReceipt').mockImplementation(async (...a) => { const result = await original(...a); revoked = true; return result; });
  await expect(service.execute('trpg', request, principal)).rejects.toThrow(/rollback incomplete/);
  expect(writer).toHaveBeenCalledTimes(1);
});

test('unmanaged and manually modified artifacts are preserved; every target is checked before the first write', async () => {
  await mkdir(join(fs.getVaultPath(), 'Community/Roleplay/Sheets'), { recursive: true });
  await writeFile(join(fs.getVaultPath(), paths[1]!), '{"nodes":[],"edges":[]}');
  const writer = vi.spyOn(fs, 'writeNoteWithReceipt');
  await expect(service.execute('trpg', await args({ expectedArtifacts: { ...missing, canvas: await fs.readNoteRevision(paths[1]!) } }), principal)).rejects.toThrow(/unmanaged/);
  expect(writer).not.toHaveBeenCalled();
  const desired = trpgArtifacts(await store.snapshot(), 'alice')[1]!;
  await writeFile(join(fs.getVaultPath(), paths[1]!), desired.content + 'manual change');
  await expect(service.execute('trpg', await args({ expectedArtifacts: { ...missing, canvas: await fs.readNoteRevision(paths[1]!) } }), principal)).rejects.toThrow(/unmanaged/);
  expect(writer).not.toHaveBeenCalled();
});

test('refresh requires both source and target revisions, then captures the new source', async () => {
  await service.execute('trpg', await args(), principal); const oldRequest = await args({ expectedArtifacts: await revisions() });
  await learn(); await expect(service.execute('trpg', oldRequest, principal)).rejects.toThrow(/revision/);
  await expect(service.execute('trpg', await args(), principal)).rejects.toThrow(/revision/);
  await service.execute('trpg', await args({ expectedArtifacts: await revisions() }), principal);
  expect(await contents()).toEqual(trpgArtifacts(await store.snapshot(), 'alice').map(f => f.content));
});

test('a later write failure restores existing preimages without deleting any data', async () => {
  await service.execute('trpg', await args(), principal); const previous = await contents(), expectedArtifacts = await revisions(); await learn();
  const original = fs.writeNoteWithReceipt.bind(fs); let calls = 0;
  vi.spyOn(fs, 'writeNoteWithReceipt').mockImplementation(async (...a) => { if (++calls === 2) throw new Error('disk failure'); return original(...a); });
  await expect(service.execute('trpg', await args({ expectedArtifacts }), principal)).rejects.toThrow(/restored/);
  expect(await contents()).toEqual(previous);
});

test('failed initial creation preserves new output and a same-source retry completes the bundle', async () => {
  const request = await args(), original = fs.writeNoteWithReceipt.bind(fs); let calls = 0;
  const writer = vi.spyOn(fs, 'writeNoteWithReceipt').mockImplementation(async (...a) => { if (++calls === 2) throw new Error('disk failure'); return original(...a); });
  await expect(service.execute('trpg', request, principal)).rejects.toThrow(/new files preserved/);
  expect(await readFile(join(fs.getVaultPath(), paths[0]!), 'utf8')).toBe(trpgArtifacts(await store.snapshot(), 'alice')[0]!.content);
  writer.mockRestore(); expect((await service.execute('trpg', request, principal)).projected).toBe(true);
});

test('rollback preserves a concurrent external edit instead of overwriting it', async () => {
  await service.execute('trpg', await args(), principal); const expectedArtifacts = await revisions(); await learn();
  const original = fs.writeNoteWithReceipt.bind(fs); let calls = 0;
  vi.spyOn(fs, 'writeNoteWithReceipt').mockImplementation(async (...a) => {
    if (++calls === 2) { await writeFile(join(fs.getVaultPath(), paths[0]!), 'concurrent manual edit'); throw new Error('failure'); }
    return original(...a);
  });
  await expect(service.execute('trpg', await args({ expectedArtifacts }), principal)).rejects.toThrow(/rollback incomplete/);
  expect(await readFile(join(fs.getVaultPath(), paths[0]!), 'utf8')).toBe('concurrent manual edit');
});

test('source drift during projection is detected and the previous generated snapshot is restored', async () => {
  await service.execute('trpg', await args(), principal); const previous = await contents();
  await store.transact({ op: 'trpg_growth', actor: 'alice', requestId: 'growth', expectedRevision: roleplayRevision(await store.snapshot()), data: { characterId: 'alice', amount: 1 } });
  const request = await args({ expectedArtifacts: await revisions() }), original = fs.writeNoteWithReceipt.bind(fs); let calls = 0;
  vi.spyOn(fs, 'writeNoteWithReceipt').mockImplementation(async (...a) => { const result = await original(...a); if (++calls === 1) await learn(); return result; });
  await expect(service.execute('trpg', request, principal)).rejects.toThrow(/revision.*restored/);
  expect(await contents()).toEqual(previous); expect((await store.snapshot()).trpg!.sheets.alice!.learned).toContain('guard');
});

test('scope and symlink guards deny target access before metadata or writes', async () => {
  const allowed = access.canAccessPhysicalPath.bind(access);
  const guard = vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, actor) => !path.includes('/Sheets/') && allowed(path, actor));
  await expect(service.execute('trpg', { op: 'export', characterId: 'alice' })).rejects.toThrow(/unavailable/);
  await expect(service.execute('trpg', await args(), principal)).rejects.toThrow(/unavailable/); guard.mockRestore();
  const outside = join(root, 'outside'); await mkdir(outside);
  await symlink(outside, join(fs.getVaultPath(), 'Community/Roleplay/Sheets'), 'junction');
  await expect(service.execute('trpg', await args(), principal)).rejects.toThrow(/symbolic|symlink/);
  await expect(readFile(join(outside, 'alice.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('internal projection grants are exact, reject canonical paths, and expire across async continuations', async () => {
  await expect(withRoleplayProjectionWrite('Community/Roleplay/Turns/0001.md', async () => {})).rejects.toThrow(/projection/);
  let deferred!: () => void; const pending = new Promise<void>(resolve => { deferred = resolve; }); let expired!: Promise<void>;
  await withRoleplayProjectionWrite(paths[0]!, async () => {
    expect(() => assertRoleplayMutationBoundary(paths[0]!)).not.toThrow();
    expect(() => assertRoleplayMutationBoundary(paths[1]!)).toThrow();
    expired = pending.then(() => { expect(() => assertRoleplayMutationBoundary(paths[0]!)).toThrow(); });
  });
  deferred(); await expired; expect(() => assertRoleplayMutationBoundary(paths[0]!)).toThrow();
});
