import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomInt } from 'node:crypto';
import { RoleplayService } from './roleplay-service.js';
import { RoleplayStore } from './roleplay-store.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { roleplayHash, roleplayRevision } from './roleplay-model.js';
import { defaultTrpgRuleset } from './roleplay-trpg.js';
import type { ScopePrincipal } from './scope-auth.js';

vi.mock('node:crypto', async original => { const crypto = await original<typeof import('node:crypto')>(); return { ...crypto, randomInt: vi.fn(crypto.randomInt) }; });
let root: string, fs: FileSystemService, store: RoleplayStore, service: RoleplayService;
let options: Parameters<typeof RoleplayStore.open>[0];
const principal = (accountId: string): ScopePrincipal => ({ accountId, modelId: 'gpt', agentId: accountId, role: 'agent', capabilities: ['chat'] });
const access = new ScopeAccessPolicy();
function connect() { service = new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => {} }); }
async function args(op: string, data = {}) { const s = await store.snapshot(); return { op, requestId: `r-${s.sequence}`, expectedRevision: roleplayRevision(s), ...data }; }
const write = async (endpoint: string, op: string, data = {}, actor = 'host') => service.execute(endpoint, await args(op, data), principal(actor));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'trpg-service-')); const vaultPath = join(root, 'vault'), hostPath = join(root, 'host');
  await mkdir(vaultPath); await mkdir(hostPath); fs = new FileSystemService(vaultPath); options = { vaultPath, hostPath, policy: { administrators: ['host'] } };
  store = await RoleplayStore.open(options); connect();
  await write('world', 'initialize', { title: 'Archive', places: { hall: [] } });
  await fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: 'Scene', frontmatter: { mcpvault_type: 'chat_room', room_id: 'hall', status: 'open' } });
  await write('scene', 'scene', { roomId: 'hall', title: 'Hall', location: 'hall', gm: 'host' });
  for (const id of ['alice', 'bob']) await write('character', 'character', { id, name: id, controller: id, location: 'hall' });
  vi.mocked(randomInt).mockClear();
});
afterEach(async () => { await store?.close(); if (root) await rm(root, { recursive: true, force: true }); });
test('service opt-in, sheet reads and respec preview are bounded and never roll', async () => {
  const legacy = await service.execute('trpg', { op: 'read', maxChars: 2000 }); expect(legacy.mode).toBe('legacy');
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  await write('trpg', 'learn', { characterId: 'alice', generation: 1, skillId: 'guard' }, 'alice');
  const read = await service.execute('trpg', { op: 'read', characterId: 'alice', maxChars: 2000 });
  expect(JSON.stringify(read).length).toBeLessThanOrEqual(2000); expect(read.mode).toBe('trpg');
  const before = roleplayRevision(await store.snapshot());
  const preview = await service.execute('trpg', { op: 'respec_preview', characterId: 'alice', generation: 1, remove: ['guard'], maxChars: 2000 }, principal('alice'));
  expect(preview.previewFingerprint).toMatch(/^[a-f0-9]{64}$/); expect(roleplayRevision(await store.snapshot())).toBe(before);
  expect(randomInt).not.toHaveBeenCalled();
  await write('trpg', 'respec', { characterId: 'alice', generation: 1, remove: ['guard'], previewFingerprint: preview.previewFingerprint }, 'alice');
  expect((await store.snapshot()).trpg!.sheets.alice!.learned).toEqual(['attack']);
});
test('rejects caller outcomes and invalid final revisions before RNG; commits and replays one set of cryptographic dice', async () => {
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  const start = await args('encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  await expect(service.execute('trpg', { ...start, rolls: [20, 1] }, principal('host'))).rejects.toThrow(/caller|outcome|field/);
  await expect(service.execute('trpg', { ...start, expectedRevision: 'stale' }, principal('host'))).rejects.toThrow(/revision/);
  await expect(service.execute('trpg', start, principal('alice'))).rejects.toThrow(/GM/);
  expect(randomInt).not.toHaveBeenCalled();
  const receipt = await service.execute('trpg', start, principal('host')); expect(randomInt).toHaveBeenCalledTimes(2);
  const after = await store.snapshot();
  expect((await service.execute('trpg', start, principal('host'))).id).toBe(receipt.id); expect(randomInt).toHaveBeenCalledTimes(2);
  const record = (await store.read()).records.at(-1)!;
  expect(record.event.command.rolls).toHaveLength(2);
  await store.close(); store = await RoleplayStore.open(options); connect();
  expect(await store.snapshot()).toEqual(after); expect((await service.execute('trpg', start, principal('host'))).id).toBe(receipt.id);
  expect(randomInt).toHaveBeenCalledTimes(2);
});
test('prepared encounter recovers after checkpoint intent without rolling again', async () => {
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  const prior = (await store.read()).records.at(-1)!.event;
  const start = await args('encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const receipt = await service.execute('trpg', start, principal('host'));
  const last = (await store.read()).records.at(-1)!; await store.close();
  const prefix = join(options.hostPath, `roleplay-${roleplayHash(options.vaultPath.toLowerCase())}`);
  await writeFile(`${prefix}.checkpoint.json`, JSON.stringify({ version: 1, vault: options.vaultPath, sequence: prior.sequence, hash: prior.hash, pending: { sequence: last.event.sequence, hash: last.event.hash } }));
  await rm(join(options.vaultPath, receipt.path));
  store = await RoleplayStore.open(options); connect();
  expect((await service.execute('trpg', start, principal('host'))).id).toBe(receipt.id);
  expect(randomInt).toHaveBeenCalledTimes(2); expect(await readFile(join(options.vaultPath, receipt.path), 'utf8')).toBe(last.content);
});
test('durable prepared dice survive interruption before the pending checkpoint was written', async () => {
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  const prior = (await store.read()).records.at(-1)!.event;
  const start = await args('encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const receipt = await service.execute('trpg', start, principal('host'));
  const last = (await store.read()).records.at(-1)!; await store.close();
  const prefix = join(options.hostPath, `roleplay-${roleplayHash(options.vaultPath.toLowerCase())}`);
  await writeFile(`${prefix}.checkpoint.json`, JSON.stringify({ version: 1, vault: options.vaultPath, sequence: prior.sequence, hash: prior.hash }));
  await rm(join(options.vaultPath, receipt.path));
  store = await RoleplayStore.open(options); connect();
  expect((await service.execute('trpg', start, principal('host'))).noteRevision).toBe(receipt.noteRevision);
  expect(randomInt).toHaveBeenCalledTimes(2); expect(await readFile(join(options.vaultPath, receipt.path), 'utf8')).toBe(last.content);
});
test('registered preset is pinned and caller game fields cannot disappear silently', async () => {
  await expect(write('trpg', 'adopt', { preset: 'mcpvault-adventure@latest' })).rejects.toThrow(/preset/);
  await write('trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' });
  await expect(write('trpg', 'learn', { characterId: 'alice', generation: 1, skillId: 'guard', amount: 99 }, 'alice')).rejects.toThrow(/field/);
});
test('final revalidation catches revoked actor and changed room before any dice are consumed', async () => {
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  const command = { op: 'trpg_encounter_start', actor: 'host', requestId: 'direct-test', expectedRevision: roleplayRevision(await store.snapshot()), data: { roomId: 'hall', participants: ['alice', 'bob'] } };
  await expect(store.transact(command, async () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
  await expect(store.transact({ ...command, rolls: [20, 20] })).rejects.toThrow(/Caller/);
  expect(randomInt).not.toHaveBeenCalled();
});
test('concurrent encounter requests share the writer and only the accepted revision consumes dice', async () => {
  await write('trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' });
  const start = await args('encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const replies = await Promise.allSettled([service.execute('trpg', start, principal('host')), service.execute('trpg', { ...start, requestId: 'competitor' }, principal('host'))]);
  expect(replies.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(randomInt).toHaveBeenCalledTimes(2);
});
test('ordinary roleplay context leads with the current encounter and executable loaded skills', async () => {
  await write('trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' });
  await write('trpg', 'encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const state = await store.snapshot(), encounter = state.trpg!.encounters.hall!, characterId = encounter.order[encounter.turn]!;
  const context = await service.execute('context', { characterId, roomId: 'hall', maxChars: 4000 });
  expect(context.nextAction.endpointId).toBe('roleplay.trpg');
  expect(context.items).toContainEqual(expect.objectContaining({ kind: 'trpg_encounter', current: characterId, actions: 1 }));
  expect(context.items).toContainEqual(expect.objectContaining({ kind: 'trpg_action', skillId: 'attack', eligible: true }));
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(4000); expect(randomInt).toHaveBeenCalledTimes(2);
});
test('registered TRPG action reports bounded direct-route provenance without GM/model fallback, including retry and restart', async () => {
  await write('trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' });
  await write('trpg', 'encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const state = await store.snapshot(), encounter = state.trpg!.encounters.hall!, characterId = encounter.order[encounter.turn]!, targetId = encounter.order.find(id => id !== characterId)!;
  const action = await args('act', { characterId, generation: 1, roomId: 'hall', skillId: 'attack', targetId });
  const dispatch = vi.spyOn(service, 'execute');
  const before = await store.snapshot();
  const receipt = await service.execute('trpg', action, principal(characterId));
  expect(receipt.route).toEqual({ kind: 'registered_action', reason: 'Registered declarative mechanics resolved under the canonical writer.', skipped: ['gm_dispatch', 'model_dispatch'] });
  expect(JSON.stringify(receipt.route).length).toBeLessThanOrEqual(256);
  expect(dispatch.mock.calls.map(([endpoint]) => endpoint)).toEqual(['trpg']);
  expect((await store.snapshot()).pending).toEqual(before.pending);
  expect((await store.read()).records.at(-1)!.event.command.op).toBe('trpg_act');
  expect(randomInt).toHaveBeenCalledTimes(3);
  expect(await service.execute('trpg', action, principal(characterId))).toEqual(receipt);
  await expect(service.execute('trpg', { ...action, requestId: 'stale-action' }, principal(characterId))).rejects.toThrow(/revision/);
  await expect(write('trpg', 'act', { characterId, generation: 1, roomId: 'hall', skillId: 'invented', targetId }, characterId)).rejects.toThrow(/skill|GM/);
  expect((await store.snapshot()).pending).toEqual({}); expect(randomInt).toHaveBeenCalledTimes(3);
  dispatch.mockRestore(); await store.close(); store = await RoleplayStore.open(options); connect();
  expect(await service.execute('trpg', action, principal(characterId))).toEqual(receipt); expect(randomInt).toHaveBeenCalledTimes(3);
});
test('hidden encounters are filtered before counts and preview rejects another controller', async () => {
  await write('trpg', 'adopt', { ruleset: defaultTrpgRuleset() });
  await write('trpg', 'encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const room = await fs.readNote('Community/ChatRooms/hall.md');
  await fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'hidden' }, expectedRevision: room.revision });
  const read = await service.execute('trpg', { op: 'read', roomId: 'hall' }); expect(read.items).toEqual([]); expect(read.total).toBe(0);
  await expect(write('trpg', 'encounter_end', { roomId: 'hall' })).rejects.toThrow(/unavailable/);
  await expect(service.execute('trpg', { op: 'respec_preview', characterId: 'alice', generation: 1, remove: ['guard'] }, principal('bob'))).rejects.toThrow(/control/);
});

test.each(['before retry', 'inside writer'] as const)('committed switch retry revalidates the original receipt room after its encounter ends: %s', async timing => {
  await write('trpg', 'adopt', { preset: 'mcpvault-adventure@1.0.0' });
  for (const characterId of ['alice', 'bob']) await write('trpg', 'loadout', { characterId, generation: 1, name: 'spare', skills: ['attack'], equipment: [] }, characterId);
  await write('trpg', 'encounter_start', { roomId: 'hall', participants: ['alice', 'bob'] });
  const encounter = (await store.snapshot()).trpg!.encounters.hall!, characterId = encounter.order[encounter.turn]!;
  const request = await args('switch', { characterId, generation: 1, name: 'spare' });
  const receipt = await service.execute('trpg', request, principal(characterId)); expect(receipt.roomId).toBe('hall');
  await write('trpg', 'encounter_end', { roomId: 'hall' });
  expect(await service.execute('trpg', request, principal(characterId))).toEqual(receipt);
  const room = await fs.readNote('Community/ChatRooms/hall.md');
  const hide = () => fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'hidden' }, expectedRevision: room.revision });
  const original = store.transact.bind(store);
  if (timing === 'before retry') await hide();
  else vi.spyOn(store, 'transact').mockImplementation(async (...a) => { await hide(); return original(...a); });
  const revision = roleplayRevision(await store.snapshot()), rolls = vi.mocked(randomInt).mock.calls.length;
  await expect(service.execute('trpg', request, principal(characterId))).rejects.toThrow(/unavailable/);
  expect(roleplayRevision(await store.snapshot())).toBe(revision); expect(randomInt).toHaveBeenCalledTimes(rolls);
});

test('committed request retry rejects a now-hidden original turn path even while the world root is visible', async () => {
  // A simple TRPG management receipt has no room, so only its exact path guards this replay.
  const command = await args('adopt', { preset: 'mcpvault-adventure@1.0.0' });
  const receipt = await service.execute('trpg', command, principal('host'));
  const allowed = access.canAccessPhysicalPath.bind(access);
  const scope = vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, actor) => path !== receipt.path && allowed(path, actor));
  try { await expect(service.execute('trpg', command, principal('host'))).rejects.toThrow(/unavailable/); }
  finally { scope.mockRestore(); }
});
