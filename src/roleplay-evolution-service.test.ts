import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RoleplayService } from './roleplay-service.js';
import { RoleplayStore } from './roleplay-store.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { roleplayRevision } from './roleplay-model.js';
import type { ScopePrincipal } from './scope-auth.js';

let root: string, vaultPath: string, hostPath: string, fs: FileSystemService, store: RoleplayStore, service: RoleplayService;
const principal = (accountId: string): ScopePrincipal => ({ accountId, modelId: 'gpt', agentId: accountId, role: 'agent', capabilities: ['chat'] });
const access = new ScopeAccessPolicy();
const connect = () => new RoleplayService(fs, access, new ReferenceService(fs, access), store, { assertActor: async () => {} });
const write = async (endpoint: string, data: Record<string, any>, actor = 'host') => service.execute(endpoint, { requestId: `req-${(await store.snapshot()).sequence}`, expectedRevision: roleplayRevision(await store.snapshot()), ...data }, principal(actor));
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'roleplay-evolution-')); vaultPath = join(root, 'vault'); hostPath = join(root, 'host');
  await mkdir(vaultPath); await mkdir(hostPath); fs = new FileSystemService(vaultPath);
  store = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['host'] } }); service = connect();
  await write('world', { op: 'initialize', title: 'Archive', places: { hall: [] } });
  await fs.writeNote({ path: 'Community/Lore/Archive.md', content: 'A welcoming place.', frontmatter: { fiction_domain: 'roleplay' } });
  await write('world', { op: 'settings', definition: 'Initial world.', lore: ['Community/Lore/Archive.md'] });
  await write('character', { op: 'character', id: 'iris', name: 'Iris', controller: 'alice', location: 'hall', definition: 'Initially trusting.' });
  await fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: 'Scene', frontmatter: { mcpvault_type: 'chat_room', room_id: 'hall', status: 'open' } });
  await write('scene', { op: 'scene', roomId: 'hall', title: 'Hall', location: 'hall', gm: 'host' });
  await write('world', { op: 'settings', evolutionMode: 'evolving', worldGmAccounts: ['host'] });
});
afterEach(async () => { await store?.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function source() {
  const r = await write('action', { op: 'speak', characterId: 'iris', generation: 1, roomId: 'hall', content: 'I heard a rumor.' }, 'alice');
  return { turnId: r.id, revision: r.revision, noteRevision: r.noteRevision };
}
const propose = (sources: any[], changes = [{ kind: 'belief', target: 'iris', key: 'rumor', text: 'I suspect the rumor may be true.' }]) => write('evolution', { op: 'propose', characterId: 'iris', generation: 1, roomId: 'hall', sources, changes, reason: 'After this scene.' }, 'alice');

it('re-reads the exact proposal and prioritizes current subjective context after restart, without duplicate retries', async () => {
  const sources = [await source()];
  const args = { op: 'propose', requestId: 'same-proposal', expectedRevision: roleplayRevision(await store.snapshot()), characterId: 'iris', generation: 1, roomId: 'hall', sources, changes: [{ kind: 'attitude', target: 'iris', key: 'trust', text: 'I am now more cautious.' }], reason: 'After a rumor.' };
  const r = await service.execute('evolution', args, principal('alice'));
  expect((await service.execute('evolution', args, principal('alice'))).id).toBe(r.id);
  const read = await service.execute('evolution', { op: 'read', proposalId: r.id });
  expect(read.items.find((i: any) => i.kind === 'proposal').status).toBe('applied');
  await store.close(); store = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['host'] } }); service = connect();
  const context = await service.execute('context', { characterId: 'iris', roomId: 'hall', maxChars: 2000 });
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(2000);
  expect(context.items[0]).toMatchObject({ kind: 'evolvingBelief', subjective: true, text: 'I am now more cautious.' });
  expect((await store.snapshot()).characters.iris!.definition).toBe('Initially trusting.');
});
it('rejects forged note revisions, private aliases and embeds without exposing targets', async () => {
  const s = await source();
  await expect(propose([{ ...s, noteRevision: 'a'.repeat(64) }])).rejects.toThrow(/unavailable|reference/);
  await fs.writeNote({ path: '_scopes/agents/other/private.md', content: 'private', frontmatter: { aliases: ['Hidden secret'] } });
  for (const text of ['[[Hidden secret|public alias]]', '![[Hidden secret]]', '[alias](_scopes/agents/other/private.md)']) {
    await expect(propose([s], [{ kind: 'belief', target: 'iris', key: 'rumor', text }])).rejects.toThrow(/reference.*unavailable|unavailable.*reference/);
  }
});
it('filters hidden source rooms before proposal counts, details and current context', async () => {
  const p = await propose([await source()]);
  const room = await fs.readNote('Community/ChatRooms/hall.md');
  await fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'hidden' }, expectedRevision: room.revision });
  const list = await service.execute('evolution', { op: 'list' });
  expect(list.items).toEqual([]); expect(list.total).toBe(0);
  const context = await service.execute('context', { characterId: 'iris', maxChars: 12000 });
  expect(JSON.stringify(context)).not.toContain('I suspect the rumor');
  await expect(service.execute('evolution', { op: 'preview', proposalId: p.id }, principal('alice'))).rejects.toThrow(/unavailable/);
});
it('marks changed external lore for review and refuses an old preview approval', async () => {
  const p = await propose([await source()], [{ kind: 'character_core', target: 'iris', key: 'definition', text: 'Guarded after the rumor.' }]);
  const preview = await service.execute('evolution', { op: 'preview', proposalId: p.id }, principal('alice'));
  const lore = await fs.readNote('Community/Lore/Archive.md');
  await fs.writeNote({ path: 'Community/Lore/Archive.md', content: 'External lore changed.', frontmatter: lore.frontmatter, expectedRevision: lore.revision });
  await expect(write('evolution', { op: 'apply', proposalId: p.id, previewFingerprint: preview.preview.fingerprint }, 'alice')).rejects.toThrow(/reference|unavailable/);
  const read = await service.execute('evolution', { op: 'read', proposalId: p.id });
  expect(read.items.find((i: any) => i.kind === 'proposal').needsReview).toBe(true);
  const context = await service.execute('context', { characterId: 'iris', maxChars: 12000 });
  expect(context.items.some((i: any) => i.kind === 'loreNeedsReview')).toBe(true);
  expect(JSON.stringify(context)).not.toContain('Guarded after the rumor.');
});
it('returns the original opt-in receipt for identical retries immediately and after restart', async () => {
  const record = (await store.read()).records.find(r => r.event.command.op === 'settings' && r.event.command.data.evolutionMode)!;
  const { loreGuards: _guards, ...data } = record.event.command.data;
  const args = { ...data, op: 'settings', requestId: record.event.command.requestId, expectedRevision: record.event.command.expectedRevision };
  const sequence = (await store.snapshot()).sequence;
  expect((await service.execute('world', args, principal('host'))).id).toBe(record.event.receipt.id);
  await store.close(); store = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['host'] } }); service = connect();
  expect((await service.execute('world', args, principal('host'))).id).toBe(record.event.receipt.id);
  expect((await store.snapshot()).sequence).toBe(sequence);
});
it('refuses retracting an invisible target from a different public scene without leaking its controllers', async () => {
  const p = await propose([await source()]);
  const room = await fs.readNote('Community/ChatRooms/hall.md');
  await fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'hidden' }, expectedRevision: room.revision });
  await fs.writeNote({ path: 'Community/ChatRooms/public.md', content: 'Public', frontmatter: { mcpvault_type: 'chat_room', room_id: 'public', status: 'open' } });
  await write('scene', { op: 'scene', roomId: 'public', title: 'Public', location: 'hall', gm: 'host' });
  const s = await write('action', { op: 'speak', characterId: 'iris', generation: 1, roomId: 'public', content: 'Public scene.' }, 'alice');
  const before = roleplayRevision(await store.snapshot());
  await expect(write('evolution', { op: 'propose', characterId: 'iris', generation: 1, roomId: 'public', reason: 'Withdraw.', sources: [{ turnId: s.id, revision: s.revision, noteRevision: s.noteRevision }], changes: [{ kind: 'retract', target: p.id, key: 'retract' }] }, 'alice')).rejects.toThrow(/unavailable|reference/);
  expect(roleplayRevision(await store.snapshot())).toBe(before);
});
