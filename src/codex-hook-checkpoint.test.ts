import { beforeEach, expect, test } from 'vitest';
import { CodexHookCheckpointStore } from './codex-hook-checkpoint.js';
import type { CodexHookContext } from './codex-hook-service.js';
import type { CodexHookHost } from './codex-hook-host.js';

let state: any, host: CodexHookHost, context: CodexHookContext, saves: number, allowed: boolean;
const hash = 'a'.repeat(64);
const payload = { topic: 'Pinned work', summary: 'Agent-authored public-facing work summary, not a transcript.', nextAction: 'Read the pinned source.',
  references: [{ path: 'Note.md', revision: hash }] };
beforeEach(() => {
  state = undefined; saves = 0; allowed = true;
  const config = { version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', workspace: 'E:/dev/wiki', definitionHash: hash,
    events: ['SessionEnd'], actions: ['checkpoint'], paths: ['Note.md'] }] };
  host = { refresh: async () => structuredClone(config), readState: async () => structuredClone(state),
    writeState: async value => { state = structuredClone(value); saves++; },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }) } as any;
  context = { ticket: { accountId: 'operator', projectId: 'p', authorityRevision: hash, inputRevision: hash, paths: ['Note.md'] },
    signal: new AbortController().signal, deadline: Date.now() + 10000, assertCurrent: async () => { if (!allowed) throw Error(); } } as any;
});
test('stores restrictions before prepared text and verifies preservation without a shutdown rewrite', async () => {
  const snapshots: any[] = [], save = host.writeState;
  host.writeState = async value => { snapshots.push(structuredClone(value)); await save(value); };
  const store = new CodexHookCheckpointStore(host), prepared = await store.prepare('prepared', payload, context);
  expect(snapshots[0].entries[0]).not.toHaveProperty('payload');
  expect(snapshots[0].entries[0]).toMatchObject({ accountId: 'operator', paths: ['Note.md'] });
  const count = saves;
  expect(await new CodexHookCheckpointStore(host).flush('prepared', prepared.revision, context)).toEqual({ status: 'completed', revision: prepared.revision });
  expect(saves).toBe(count);
});
test('same checkpoint is idempotent; changed text never overwrites the saved record', async () => {
  const store = new CodexHookCheckpointStore(host), result = await store.prepare('prepared', payload, context), count = saves;
  expect(await store.prepare('prepared', payload, context)).toEqual(result); expect(saves).toBe(count);
  await expect(store.prepare('prepared', { ...payload, summary: 'Replacement' }, context)).rejects.toThrow('Prepared checkpoint unavailable');
});
test('failure after restriction persistence leaves pending protection and no body', async () => {
  const save = host.writeState; host.writeState = async value => { await save(value); allowed = false; };
  await expect(new CodexHookCheckpointStore(host).prepare('prepared', payload, context)).rejects.toThrow('Prepared checkpoint unavailable');
  expect(state.entries[0]).not.toHaveProperty('payload');
});
test('revoked authority, wrong revision and damaged history cannot claim successful preservation', async () => {
  const store = new CodexHookCheckpointStore(host), result = await store.prepare('prepared', payload, context);
  expect(await store.inspect('prepared', 'b'.repeat(64), context)).toEqual({ status: 'partial' });
  allowed = false; await expect(store.flush('prepared', result.revision, context)).rejects.toThrow('Prepared checkpoint unavailable');
  allowed = true; state.entries[0].payload.summary = 'Corruption'; const original = structuredClone(state);
  await expect(store.inspect('prepared', result.revision, context)).rejects.toThrow('Prepared checkpoint unavailable'); expect(state).toEqual(original);
});
test('transcript fields and out-of-grant references are rejected before saving', async () => {
  const store = new CodexHookCheckpointStore(host);
  for (const value of [{ ...payload, transcript: 'private' }, { ...payload, references: [{ path: 'Hidden.md', revision: hash }] }]) {
    await expect(store.prepare('prepared', value, context)).rejects.toThrow('Prepared checkpoint unavailable');
  }
  expect(saves).toBe(0);
});

test('a later authorized host resume can read the preserved payload without writing it to the Vault', async () => {
  const store = new CodexHookCheckpointStore(host), prepared = await store.prepare('prepared', payload, context), count = saves;
  expect(await store.read('prepared', prepared.revision, context)).toMatchObject({ status: 'completed', packet: { checkpoint: payload } });
  expect(saves).toBe(count); context.ticket.authorityRevision = 'b'.repeat(64);
  expect(await store.read('prepared', prepared.revision, context)).toEqual({ status: 'partial' });
});
