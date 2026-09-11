import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentSearch } from './document-search.js';
let root: string, index: DocumentIndex;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mcpvault-document-search-')); index = new DocumentIndex(new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy())); });
afterEach(async () => { index.close(); await rm(root, { recursive: true, force: true }); });
test('finds long-note tails and returns exact revision-pinned read actions, not complete bodies', async () => {
  await writeFile(join(root, 'note.md'), '# Topic\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: ${i === 99 ? '종료조건 ZEBRA' : 'normal'}`).join('\n\n'));
  const result = await new DocumentSearch(index).search({ path: 'note.md', query: '종료조건', maxChars: 2200 });
  expect(result.items).toHaveLength(1); expect(result.items[0].description).toContain('ZEBRA');
  expect(result.items[0].readAction.arguments.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(result.items[0].readAction.arguments.fragmentId).toBe(result.items[0].id);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2200);
});
test('plain script searches preserve data and global search reports missing discovery honestly', async () => {
  await writeFile(join(root, 'sample.py'), 'import os\n\n# unique-needle\nprint(1)');
  const search = new DocumentSearch(index);
  const result = await search.search({ path: 'sample.py', query: 'unique-needle' });
  expect(result.items.length).toBeGreaterThan(0);
  await expect(search.search({ query: 'needle' })).rejects.toThrow(/discovery|catalog|path/i);
});
test('hidden bodies cannot influence hit counts and stale paginated results reject', async () => {
  await writeFile(join(root, 'hidden.md'), '---\nmoderation_status: hidden\n---\nneedle');
  await expect(new DocumentSearch(index).search({ path: 'hidden.md', query: 'needle' })).rejects.toThrow();
  await writeFile(join(root, 'note.md'), '# A\n\nneedle one\n\nneedle two');
  const search = new DocumentSearch(index), first = await search.search({ path: 'note.md', query: 'needle', limit: 1 });
  await writeFile(join(root, 'note.md'), '# B\n\nneedle other');
  await expect(search.search({ path: 'note.md', query: 'needle', cursor: first.cursor })).rejects.toThrow(/cursor|changed|invalid/i);
});
test('aggregate results revalidate earlier sources after later candidates finish', async () => {
  await writeFile(join(root, 'a.md'), 'needle A'); await writeFile(join(root, 'b.md'), 'needle B');
  const reader = index.reader; index.close();
  index = new DocumentIndex(reader, { subscribeBatch: () => () => {}, allPathsSnapshot: async () => [] } as any);
  const original = index.load.bind(index);
  vi.spyOn(index, 'load').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'b.md') await writeFile(join(root, 'a.md'), '---\nmoderation_status: hidden\n---\nneedle A');
    return result;
  });
  const search = new DocumentSearch(index, { skillDiscoveryAllowed: () => true, searchNotes: async () => [{ p: 'a.md' }, { p: 'b.md' }] as any });
  await expect(search.search({ query: 'needle' })).rejects.toThrow(/unavailable|changed|revision|hidden/i);
});

async function resourceSearch(paths: string[]) {
  const reader = index.reader; index.close();
  for (const path of paths) await writeFile(join(root, path), 'needle one\n\nneedle two');
  index = new DocumentIndex(reader, { subscribeBatch: () => () => {}, allPathsSnapshot: async () => paths } as any);
  return new DocumentSearch(index, { skillDiscoveryAllowed: () => true, searchNotes: async () => [] });
}
test('resource windows reach later files independently of fragment pagination and reject catalog/query drift', async () => {
  const paths = Array.from({ length: 51 }, (_, i) => `file${String(i).padStart(2, '0')}.txt`);
  const search = await resourceSearch(paths);
  const first = await search.search({ query: 'needle', limit: 1, maxChars: 4000 });
  expect(first.cursor).toBeTruthy();
  expect(first.nextResourceAction).toBeTruthy();
  const args = (first.nextResourceAction as any).arguments;
  const next = await search.search(args);
  expect(next.items[0].path).toBe('file48.txt');
  expect(next.nextResourceAction).toBeUndefined();
  const secondFragment = await search.search({ query: 'needle', limit: 1, cursor: first.cursor });
  expect(secondFragment.items[0].path).toBe('file00.txt');
  await expect(search.search({ ...args, query: 'different' })).rejects.toThrow(/cursor|changed/i);
  paths.push('later.txt');
  await expect(search.search(args)).rejects.toThrow(/cursor|changed/i);
});
test('byte-budget continuation starts at the first unprocessed file', async () => {
  const search = await resourceSearch(['a.txt', 'b.txt', 'c.txt']);
  const original = index.load.bind(index);
  vi.spyOn(index, 'load').mockImplementation(async (...args) => {
    const loaded = await original(...args);
    // Controlled accounting boundary; no large allocations or parsing fixture.
    return { ...loaded, snapshot: { ...loaded.snapshot, bytes: { length: 8 * 1024 * 1024 } as Buffer } };
  });
  const first = await search.search({ query: 'needle' });
  expect(first.items.map(row => row.path)).not.toContain('c.txt');
  expect(first.nextResourceAction).toBeTruthy();
  const next = await search.search((first.nextResourceAction as any).arguments);
  expect(next.items.map(row => row.path)).toEqual(['c.txt', 'c.txt']);
});
