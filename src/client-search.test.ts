import { expect, test } from 'vitest';
import { McpVaultClientSearchIndex } from './client-search.js';
import type { AsyncClientKeyValueStore, ClientKeyValueStore } from './client-cache.js';

test('searches only cached notes and ranks title matches', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'Wiki/AI.md', revision: 'a'.repeat(64), content: '인공지능 연구의 최신 결과', frontmatter: { tags: ['wiki'] } });
  index.upsert({ path: 'Notes/other.md', revision: 'b'.repeat(64), content: '인공지능에 대한 짧은 메모' });

  const result = index.search('AI', { limit: 10 });
  expect(result.complete).toBe(false);
  expect(result.indexedDocuments).toBe(2);
  expect(result.results[0]).toMatchObject({ path: 'Wiki/AI.md', revision: 'a'.repeat(64) });
});

test('updates and removes cached documents', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'note.md', revision: 'a'.repeat(64), content: 'old content' });
  expect(index.search('old').results).toHaveLength(1);
  index.upsert({ path: 'note.md', revision: 'b'.repeat(64), content: 'new content' });
  expect(index.search('old').results).toHaveLength(0);
  expect(index.search('new').results[0]!.revision).toBe('b'.repeat(64));
  index.remove('note.md');
  expect(index.size()).toBe(0);
});

test('updates the local inverted index for Korean candidates', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'korean.md', revision: 'a'.repeat(64), content: '한국어 검색 후보' });
  index.upsert({ path: 'english.md', revision: 'b'.repeat(64), content: 'unrelated content' });
  expect(index.search('한국어').results.map(result => result.path)).toEqual(['korean.md']);
  index.remove('korean.md');
  expect(index.search('한국어').results).toHaveLength(0);
});

test('keeps only the requested top results while ranking candidates', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'a.md', revision: 'a'.repeat(64), content: 'shared' });
  index.upsert({ path: 'b.md', revision: 'b'.repeat(64), content: 'shared shared shared' });
  index.upsert({ path: 'c.md', revision: 'c'.repeat(64), content: 'shared shared' });

  expect(index.search('shared', { limit: 2 }).results.map(result => result.path)).toEqual(['b.md', 'c.md']);
});

test('persists and restores a bounded local search index', () => {
  const values = new Map<string, string>();
  const store: ClientKeyValueStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const original = new McpVaultClientSearchIndex({ maxDocuments: 2 });
  original.upsert({ path: 'one.md', revision: '1'.repeat(64), content: 'alpha' });
  original.upsert({ path: 'two.md', revision: '2'.repeat(64), content: 'beta' });
  original.persist(store, 'search-index');

  const restored = new McpVaultClientSearchIndex({ maxDocuments: 2 });
  expect(restored.hydrate(store, 'search-index')).toBe(2);
  expect(restored.search('alpha').results[0]!.path).toBe('one.md');
  original.upsert({ path: 'three.md', revision: '3'.repeat(64), content: 'gamma' });
  expect(original.size()).toBe(2);
  expect(original.search('alpha').results).toHaveLength(0);
});

test('persists only changed local search documents incrementally', () => {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const store: ClientKeyValueStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'one.md', revision: '1'.repeat(64), content: 'one' });
  index.upsert({ path: 'two.md', revision: '2'.repeat(64), content: 'two' });
  index.persistIncremental(store, 'search-index');
  writes.length = 0;

  index.upsert({ path: 'two.md', revision: '3'.repeat(64), content: 'updated' });
  index.persistIncremental(store, 'search-index');
  expect(writes).toEqual(['search-index:document:two.md', 'search-index']);

  writes.length = 0;
  index.remove('one.md');
  index.persistIncremental(store, 'search-index');
  expect(writes).toEqual(['search-index']);
  expect(values.has('search-index:document:one.md')).toBe(false);

  const restored = new McpVaultClientSearchIndex();
  expect(restored.hydrateIncremental(store, 'search-index')).toBe(1);
  expect(restored.search('updated').results[0]!.path).toBe('two.md');
});

test('supports asynchronous incremental search-index persistence', async () => {
  const values = new Map<string, string>();
  const store: AsyncClientKeyValueStore = {
    getItem: async key => values.get(key) || null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  const original = new McpVaultClientSearchIndex();
  original.upsert({ path: 'async.md', revision: 'a'.repeat(64), content: 'async search' });
  await original.persistIncrementalAsync(store, 'async-index');
  const restored = new McpVaultClientSearchIndex();
  await expect(restored.hydrateIncrementalAsync(store, 'async-index')).resolves.toBe(1);
  expect(restored.search('async').results[0]!.path).toBe('async.md');
});

test('builds the local search index in yielding batches and can abort idle work', async () => {
  const index = new McpVaultClientSearchIndex();
  const controller = new AbortController();
  let yields = 0;
  const notes = Array.from({ length: 5 }, (_, index) => ({
    path: `idle-${index}.md`,
    revision: String(index).repeat(64),
    content: `idle note ${index}`,
  }));
  await expect(index.upsertMany(notes, {
    batchSize: 2,
    yield: async () => {
      yields += 1;
      if (yields === 2) controller.abort();
    },
    signal: controller.signal,
  })).rejects.toThrow('aborted');
  expect(yields).toBe(2);
  expect(index.size()).toBe(4);
});
