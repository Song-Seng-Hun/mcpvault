import { expect, test } from 'vitest';
import { McpVaultClientCache, type AsyncClientKeyValueStore, type ClientEndpointCaller, type ClientKeyValueStore } from './client-cache.js';
import type { ClientBinaryStore } from './client-compression.js';

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

test('stale reads return cached notes immediately and refresh by revision', async () => {
  let revision = 'a'.repeat(64);
  let content = 'old';
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      const known = (arguments_.knownRevisions as Record<string, string>)['note.md'];
      if (known === revision) return { ok: [{ path: 'note.md', revision, unchanged: true }], err: [] };
      return { ok: [{ path: 'note.md', revision, content }], err: [] };
    },
  };
  const cache = new McpVaultClientCache(caller);
  await cache.readNotes(['note.md']);

  revision = 'b'.repeat(64);
  content = 'new';
  const stale = cache.readNotesStale([' note.md ', 'note.md']);
  expect(stale.immediate.notes).toMatchObject([{ path: 'note.md', content: 'old' }]);
  expect(stale.immediate.unchanged).toEqual([]);
  await expect(stale.refresh).resolves.toMatchObject({ notes: [{ path: 'note.md', content: 'new', revision }] });
  expect(cache.get('note.md')!.content).toBe('new');
});

test('persists only changed entries with an incremental manifest', async () => {
  let revisionA = 'a'.repeat(64);
  let contentA = 'one';
  const values = new Map<string, string>();
  const writes: string[] = [];
  const removals: string[] = [];
  const store: ClientKeyValueStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); writes.push(key); },
    removeItem: key => { values.delete(key); removals.push(key); },
  };
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      const paths = arguments_.paths as string[];
      return {
        ok: paths.map(path => path === 'a.md'
          ? { path, revision: revisionA, content: contentA }
          : { path, revision: 'b'.repeat(64), content: 'two' }),
        err: [],
      };
    },
  };
  const cache = new McpVaultClientCache(caller);
  await cache.readNotes(['a.md', 'b.md']);
  cache.persistIncremental(store, 'incremental');
  writes.length = 0;
  revisionA = 'c'.repeat(64);
  contentA = 'updated';
  await cache.readNotes(['a.md']);
  cache.invalidate('b.md');
  cache.persistIncremental(store, 'incremental');

  expect(writes).toEqual(['incremental:note:a.md', 'incremental']);
  expect(removals).toEqual(['incremental:note:b.md']);
  const restored = new McpVaultClientCache(caller);
  expect(restored.hydrateIncremental(store, 'incremental')).toBe(1);
  expect(restored.get('a.md')).toMatchObject({ content: 'updated', revision: 'c'.repeat(64) });
  expect(restored.get('b.md')).toBeUndefined();
});

test('supports asynchronous incremental persistence for IndexedDB-like stores', async () => {
  const values = new Map<string, string>();
  const store: AsyncClientKeyValueStore = {
    getItem: async key => values.get(key) || null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      const path = (arguments_.paths as string[])[0]!;
      return { ok: [{ path, revision: 'e'.repeat(64), content: 'async persisted' }], err: [] };
    },
  };
  const original = new McpVaultClientCache(caller);
  await original.readNotes(['async.md']);
  await original.persistIncrementalAsync(store, 'async-cache');

  const restored = new McpVaultClientCache(caller);
  await expect(restored.hydrateIncrementalAsync(store, 'async-cache')).resolves.toBe(1);
  expect(restored.get('async.md')).toMatchObject({ content: 'async persisted' });
});

test('forwards abort signals and does not let stale responses overwrite newer cache entries', async () => {
  let calls = 0;
  let releaseOld!: () => void;
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_, options) {
      calls += 1;
      const includeContent = arguments_.includeContent === true;
      if (includeContent) {
        await new Promise<void>(resolve => { releaseOld = resolve; });
        return { ok: [{ path: 'race.md', revision: 'old'.repeat(16), content: 'old' }], err: [] };
      }
      return { ok: [{ path: 'race.md', revision: 'new'.repeat(16) }], err: [] };
    },
  };
  const cache = new McpVaultClientCache(caller);
  const oldRead = cache.readNotes(['race.md'], { includeContent: true });
  await Promise.resolve();
  const currentRead = await cache.readNotes(['race.md'], { includeContent: false });
  expect(currentRead.notes[0]!.revision).toBe('new'.repeat(16));
  releaseOld();
  await oldRead;
  expect(cache.get('race.md')!.revision).toBe('new'.repeat(16));

  const controller = new AbortController();
  const abortedCaller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, _arguments_, options) {
      await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted by host')), { once: true }));
      return {};
    },
  };
  const abortCache = new McpVaultClientCache(abortedCaller);
  const pending = abortCache.readNotes(['cancel.md'], { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('aborted');
  expect(calls).toBe(2);
});

test('reads note batches with bounded client-side concurrency', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return {
        ok: (arguments_.paths as string[]).map(path => ({ path, revision: path.replace('.md', '').repeat(64), content: path })),
        err: [],
      };
    },
  };
  const cache = new McpVaultClientCache(caller);
  const paths = Array.from({ length: 25 }, (_, index) => `note-${index}.md`);
  const result = await cache.readNotes(paths, { maxConcurrentBatches: 2 });
  expect(calls).toBe(3);
  expect(peak).toBeLessThanOrEqual(2);
  expect(result.notes).toHaveLength(25);
});

test('rejects an unsafe batch concurrency value', async () => {
  const cache = new McpVaultClientCache({ callEndpoint: async () => ({ ok: [], err: [] }) });
  await expect(cache.readNotes(['note.md'], { maxConcurrentBatches: 9 })).rejects.toThrow('maxConcurrentBatches');
});

test('persists cache snapshots as compressed binary without breaking restore', () => {
  const values = new Map<string, Uint8Array>();
  const store: ClientBinaryStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const original = new McpVaultClientCache({ callEndpoint: async () => ({}) });
  const content = '반복되는 위키 본문입니다. '.repeat(500);
  original.restore(JSON.stringify([{ path: 'compressed.md', revision: 'a'.repeat(64), content }]));
  original.persistCompressed(store, 'compressed-cache');
  expect(values.get('compressed-cache')!.byteLength).toBeLessThan(Buffer.byteLength(original.snapshot()));
  const restored = new McpVaultClientCache({ callEndpoint: async () => ({}) });
  expect(restored.hydrateCompressed(store, 'compressed-cache')).toBe(1);
  expect(restored.get('compressed.md')!.content).toBe(content);
});
