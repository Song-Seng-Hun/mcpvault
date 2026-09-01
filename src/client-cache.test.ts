import { expect, test } from 'vitest';
import { McpVaultClientCache, type ClientEndpointCaller, type ClientKeyValueStore } from './client-cache.js';

test('client cache performs a first read, then conditional reuse and refresh', async () => {
  let revision = 'a'.repeat(64);
  let content = 'version one';
  const calls: Array<Record<string, unknown>> = [];
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      calls.push(arguments_);
      const known = (arguments_.knownRevisions as Record<string, string>)['Note.md'];
      if (known === revision) return { ok: [{ path: 'Note.md', revision, unchanged: true }], err: [] };
      return { ok: [{ path: 'Note.md', revision, content }], err: [] };
    },
  };
  const cache = new McpVaultClientCache(caller);

  const first = await cache.readNotes(['Note.md']);
  expect(first.notes[0]).toMatchObject({ path: 'Note.md', revision, content: 'version one' });
  expect(calls[0]!.knownRevisions).toEqual({});

  const second = await cache.readNotes(['Note.md']);
  expect(second.unchanged).toEqual(['Note.md']);
  expect(second.notes[0]!.content).toBe('version one');

  revision = 'b'.repeat(64);
  content = 'version two';
  const third = await cache.readNotes(['Note.md']);
  expect(third.unchanged).toEqual([]);
  expect(third.notes[0]).toMatchObject({ revision, content: 'version two' });
  expect(calls).toHaveLength(3);
});

test('client cache evicts least recently used entries within its bound', async () => {
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      const path = (arguments_.paths as string[])[0]!;
      return { ok: [{ path, revision: path.padEnd(64, 'x').slice(0, 64), content: path }], err: [] };
    },
  };
  const cache = new McpVaultClientCache(caller, { maxEntries: 2 });
  await cache.readNotes(['a.md', 'b.md']);
  expect(cache.get('a.md')).toBeDefined();
  await cache.readNotes(['c.md']);
  expect(cache.get('a.md')).toBeDefined();
  expect(cache.get('b.md')).toBeUndefined();
});

test('client cache coalesces identical concurrent reads', async () => {
  let calls = 0;
  const caller: ClientEndpointCaller = {
    async callEndpoint() {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: [{ path: 'same.md', revision: 'c'.repeat(64), content: 'same' }], err: [] };
    },
  };
  const cache = new McpVaultClientCache(caller);
  const [first, second] = await Promise.all([cache.readNotes(['same.md']), cache.readNotes(['same.md'])]);
  expect(calls).toBe(1);
  expect(first.notes[0]!.content).toBe(second.notes[0]!.content);
});

test('client cache can persist and restore through a host-provided store', async () => {
  const values = new Map<string, string>();
  const store: ClientKeyValueStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      const path = (arguments_.paths as string[])[0]!;
      return { ok: [{ path, revision: 'd'.repeat(64), content: 'persisted' }], err: [] };
    },
  };
  const original = new McpVaultClientCache(caller);
  await original.readNotes(['persisted.md']);
  original.persist(store, 'mcpvault-cache');

  const restored = new McpVaultClientCache(caller);
  expect(restored.hydrate(store, 'mcpvault-cache')).toBe(1);
  expect(restored.get('persisted.md')!.content).toBe('persisted');
  expect(restored.values()).toHaveLength(1);
});
