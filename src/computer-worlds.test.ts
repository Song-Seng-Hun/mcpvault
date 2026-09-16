import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ComputerWorldService } from './computer-worlds.js';
import type { ScopePrincipal } from './scope-auth.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const actor: ScopePrincipal = { accountId: 'owner', modelId: 'gpt', agentId: 'worker', role: 'agent', capabilities: ['write', 'chat'] };
const fact = (value = '16 GiB') => ({ key: 'ram', category: 'hardware', value, basis: 'reported', source: 'User report', observedAt: '2026-09-16T00:00:00Z' });
async function setup(readOnly = false) {
  const root = await mkdtemp(join(tmpdir(), 'computer-worlds-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const service = new ComputerWorldService(fs, access, { readOnly, assertActor: async () => {} });
  return { fs, access, service, call: (args: Record<string, unknown>, principal: ScopePrincipal | undefined = actor) => service.execute(args, principal) };
}

it('registers distinct computers and restores explicit execution/target selection after restart', async () => {
  const { fs, access, call } = await setup();
  let result = await call({ op: 'register', worldId: 'desktop', title: 'Desktop (데스크톱)', facts: [fact()], requestId: 'one', expectedRevision: 'missing' });
  result = await call({ op: 'register', worldId: 'nas', title: 'NAS', facts: [fact('8 GiB')], requestId: 'two', expectedRevision: result.revision });
  await call({ op: 'bind', sessionId: 'session-a', executionWorldId: 'desktop', targetWorldId: 'nas', requestId: 'bind-a', expectedRevision: 'missing' });
  const restarted = new ComputerWorldService(fs, access, { assertActor: async () => {} });
  const packet = await restarted.execute({ op: 'context', sessionId: 'session-a' }, actor);
  expect(packet.items.map((item: any) => [item.role, item.worldId])).toEqual([['execution', 'desktop'], ['target', 'nas']]);
  expect(packet.items[0].facts[0].value).toBe('16 GiB');
  expect(packet.executionAuthority).toBe(false);
  expect(packet.worldKind).toBe('computer');
  expect((await call({ op: 'context', sessionId: 'other-session' })).status).toBe('selection_required');
  expect(await fs.noteExists('Community/Roleplay/Turns/0000000001.md')).toBe(false);
});

it('guards updates, preserves provenance/history and rejects request ID reuse with different data', async () => {
  const { call } = await setup();
  const args = { op: 'register', worldId: 'desktop', title: 'Desktop', facts: [fact()], requestId: 'one', expectedRevision: 'missing' };
  const first = await call(args);
  expect((await call(args)).revision).toBe(first.revision);
  await expect(call({ ...args, title: 'Different' })).rejects.toThrow(/request/i);
  await expect(call({ op: 'update', worldId: 'desktop', title: 'Desktop', facts: [fact('32 GiB')], requestId: 'two', expectedRevision: 'missing' })).rejects.toThrow(/revision/i);
  await call({ op: 'update', worldId: 'desktop', title: 'Desktop', facts: [fact('32 GiB')], requestId: 'three', expectedRevision: first.revision });
  const result = await call({ op: 'read', worldId: 'desktop' });
  expect(result.items[0].facts[0].basis).toBe('reported');
  expect((await call({ op: 'read', worldId: 'desktop', version: 1 })).items[0].facts[0].value).toBe('16 GiB');
});

it('does not expose worlds to anonymous/foreign scope or permit public storage', async () => {
  const { service, call } = await setup();
  await call({ op: 'register', worldId: 'secret-pc', title: 'Private machine', facts: [], requestId: 'one', expectedRevision: 'missing' });
  await expect(service.execute({ op: 'list' })).rejects.toThrow(/authentication/i);
  await expect(call({ op: 'list', catalogPath: 'scope://agent/worker/Worlds/computers.md' }, { ...actor, agentId: 'other' })).rejects.toThrow(/unavailable|denied/i);
  await expect(call({ op: 'register', catalogPath: 'Community/computers.md', worldId: 'x', title: 'x', facts: [], requestId: 'public', expectedRevision: 'missing' })).rejects.toThrow(/private/i);
});

it('enforces read-only/capabilities and does not accept secrets, invalid facts or path IDs', async () => {
  const { call } = await setup(true);
  const args = { op: 'register', worldId: 'desktop', title: 'Desktop', facts: [fact()], requestId: 'one', expectedRevision: 'missing' };
  await expect(call(args)).rejects.toThrow(/read.only/i);
  const other = await setup();
  await expect(other.call(args, { ...actor, capabilities: ['chat'] })).rejects.toThrow(/write/i);
  await expect(other.call({ ...args, worldId: '../escape' })).rejects.toThrow(/id/i);
  await expect(other.call({ ...args, facts: [{ ...fact(), key: 'api-token' }] })).rejects.toThrow(/secret|credential/i);
  await expect(other.call({ ...args, facts: [{ ...fact(), basis: 'verified-by-fiction' }] })).rejects.toThrow(/basis/i);
});

it('keeps small packets bounded with exact continuation and no unselected machines', async () => {
  const { call } = await setup();
  let result = await call({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: Array.from({ length: 15 }, (_, i) => ({ ...fact('x'.repeat(200)), key: `property-${i}` })), requestId: 'one', expectedRevision: 'missing' });
  await call({ op: 'register', worldId: 'unselected', title: 'DO NOT INJECT', facts: [], requestId: 'two', expectedRevision: result.revision });
  await call({ op: 'bind', sessionId: 'session-a', executionWorldId: 'desktop', targetWorldId: 'desktop', requestId: 'bind-a', expectedRevision: 'missing' });
  const packet = await call({ op: 'context', sessionId: 'session-a', maxChars: 1000 });
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(1000);
  expect(JSON.stringify(packet)).not.toContain('DO NOT INJECT');
  expect(packet.partial).toBe(true);
  expect(packet.nextAction.arguments.sessionId).toBe('session-a');
});

it('pages every fact once and rejects continuation after a new revision', async () => {
  const { call } = await setup();
  const entries = Array.from({ length: 20 }, (_, i) => ({ ...fact('x'.repeat(300)), key: `fact-${i}`, category: i === 19 ? 'constraint' : 'hardware' }));
  const saved = await call({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: entries, requestId: 'one', expectedRevision: 'missing' });
  let page = await call({ op: 'read', worldId: 'desktop', maxChars: 2000 });
  expect(page.items[0].facts[0].key).toBe('fact-19');
  const continuation = page.nextAction.arguments;
  const keys: string[] = [];
  for (let i = 0; i < 30; i++) {
    keys.push(...page.items.flatMap((row: any) => row.facts.map((f: any) => f.key)));
    if (!page.partial) break;
    page = await call({ ...page.nextAction.arguments, maxChars: 2000 });
  }
  expect(new Set(keys).size).toBe(20); expect(keys).toHaveLength(20);
  await call({ op: 'update', worldId: 'desktop', title: 'Updated', facts: [], requestId: 'two', expectedRevision: saved.revision });
  await expect(call(continuation)).rejects.toThrow(/revision/i);
});

it('rejects revoked access after the read and concurrent updates without overwriting the winner', async () => {
  const { fs, access, service, call } = await setup();
  const saved = await call({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: [], requestId: 'one', expectedRevision: 'missing' });
  const writes = await Promise.allSettled(['first', 'second'].map(title => call({ op: 'update', worldId: 'desktop', title, facts: [], requestId: title, expectedRevision: saved.revision })));
  expect(writes.filter(w => w.status === 'fulfilled')).toHaveLength(1);
  const read = fs.readNote.bind(fs);
  const spy = vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const note = await read(...args); vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return note;
  });
  await expect(service.execute({ op: 'read', worldId: 'desktop' }, actor)).rejects.toThrow(/unavailable/i);
  spy.mockRestore(); vi.restoreAllMocks();
});

it('preserves corrupt or unrelated records instead of resetting them', async () => {
  const { fs, call } = await setup();
  const path = '_scopes/agents/worker/Worlds/computers.md';
  await fs.writeNote({ path, content: '{broken', frontmatter: { mcpvault_type: 'computer_world_catalog' } });
  const revision = (await fs.readNote(path)).revision;
  await expect(call({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: [], requestId: 'one', expectedRevision: revision })).rejects.toThrow(/damaged/i);
  expect((await fs.readNote(path)).revision).toBe(revision);
});

it('rejects obvious credential assignments in values and sources, not just keys', async () => {
  const { call } = await setup();
  for (const field of ['value', 'source', 'title']) {
    const args = { op: 'register', worldId: 'desktop', title: 'Desktop', facts: [fact()], requestId: 'one', expectedRevision: 'missing' };
    if (field === 'title') args.title = 'password=synthetic-not-a-secret';
    else (args.facts[0] as any)[field] = 'password=synthetic-not-a-secret';
    await expect(call(args)).rejects.toThrow(/credential/i);
  }
  expect((await call({ op: 'list' })).revision).toBe('missing');
});

it('prioritizes target constraints over execution hardware in a small context', async () => {
  const { call } = await setup();
  const first = await call({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: Array.from({ length: 20 }, (_, i) => ({ ...fact('x'.repeat(300)), key: `item-${i}` })), requestId: 'one', expectedRevision: 'missing' });
  await call({ op: 'register', worldId: 'nas', title: 'NAS', facts: [{ ...fact('Source archive is immutable'), key: 'source-rule', category: 'constraint' }], requestId: 'two', expectedRevision: first.revision });
  await call({ op: 'bind', sessionId: 'session-a', executionWorldId: 'desktop', targetWorldId: 'nas', requestId: 'binding', expectedRevision: 'missing' });
  const result = await call({ op: 'context', sessionId: 'session-a', maxChars: 2000 });
  expect(result.items[0].role).toBe('target');
  expect(result.items[0].facts[0].category).toBe('constraint');
});

it('reports an uncertain committed write without claiming rollback after post-write revocation', async () => {
  const { fs, access } = await setup();
  let revoked = false;
  const service = new ComputerWorldService(fs, access, {
    assertActor: async () => { if (revoked) throw Error('synthetic revoked'); }, changed: () => { revoked = true; },
  });
  await expect(service.execute({ op: 'register', worldId: 'desktop', title: 'Desktop', facts: [], requestId: 'one', expectedRevision: 'missing' }, actor)).rejects.toThrow(/WRITE_UNCONFIRMED/);
  const record = await fs.readNote('_scopes/agents/worker/Worlds/computers.md');
  expect(JSON.parse(record.content).worlds).toHaveLength(1);
});
