import { expect, test } from 'vitest';
import { McpVaultClientSearchIndex } from './client-search.js';
import type { ClientKeyValueStore } from './client-cache.js';

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
