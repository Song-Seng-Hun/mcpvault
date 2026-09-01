import { expect, test } from 'vitest';
import { McpVaultClientVectorIndex } from './client-vector.js';
import type { AsyncClientKeyValueStore, ClientKeyValueStore } from './client-cache.js';

test('ranks supplied vectors locally with bounded top-k results', () => {
  const index = new McpVaultClientVectorIndex({ maxDocuments: 3, dimension: 2 });
  index.upsert('near.md', 'a'.repeat(64), [1, 0]);
  index.upsert('far.md', 'b'.repeat(64), [0, 1]);
  index.upsert('newest.md', 'c'.repeat(64), [0.9, 0.1]);
  const result = index.search([1, 0], { limit: 2, minScore: 0.5 });
  expect(result.complete).toBe(false);
  expect(result.indexedDocuments).toBe(3);
  expect(result.dimension).toBe(2);
  expect(result.results.map(item => item.path)).toEqual(['near.md', 'newest.md']);
});

test('rejects inconsistent or unsafe vectors', () => {
  const index = new McpVaultClientVectorIndex({ dimension: 2 });
  expect(() => index.upsert('zero.md', 'a'.repeat(64), [0, 0])).toThrow('zero');
  expect(() => index.upsert('wrong.md', 'a'.repeat(64), [1, 0, 0])).toThrow('dimension');
  index.upsert('ok.md', 'a'.repeat(64), [1, 0]);
  expect(() => index.search([Number.NaN, 0])).toThrow('finite');
  expect(() => index.search([1, 0], { minScore: 2 })).toThrow('minScore');
});

test('persists and restores normalized vector metadata', () => {
  const values = new Map<string, string>();
  const store: ClientKeyValueStore = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const original = new McpVaultClientVectorIndex();
  original.upsert('semantic.md', 'a'.repeat(64), [3, 4]);
  original.persist(store, 'vectors');
  const restored = new McpVaultClientVectorIndex();
  expect(restored.hydrate(store, 'vectors')).toBe(1);
  expect(restored.search([0.6, 0.8]).results[0]!.path).toBe('semantic.md');
});

test('supports async vector persistence for host stores', async () => {
  const values = new Map<string, string>();
  const store: AsyncClientKeyValueStore = {
    getItem: async key => values.get(key) || null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const original = new McpVaultClientVectorIndex({ dimension: 2 });
  original.upsert('async.md', 'a'.repeat(64), [1, 1]);
  await original.persistAsync(store, 'async-vectors');
  const restored = new McpVaultClientVectorIndex();
  await expect(restored.hydrateAsync(store, 'async-vectors')).resolves.toBe(1);
  expect(restored.size()).toBe(1);
});
