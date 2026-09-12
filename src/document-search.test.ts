import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';
import * as documentResource from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentSearch } from './document-search.js';
import { derivedCacheBudget } from './cache-budget.js';
import { DocumentTopK } from './document-ranking.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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

test('a repaired failed candidate invalidates warm fragment continuation', async () => {
  await writeFile(join(root, 'a.txt'), 'needle first\n\nneedle second');
  await writeFile(join(root, 'b.txt'), Buffer.from([0xff, 0xfe, 0xff]));
  (index as any).catalog = { allPathsSnapshot: async () => ['a.txt', 'b.txt'] };
  const search = new DocumentSearch(index, { searchNotes: async () => [], skillDiscoveryAllowed: () => true });
  try {
    const first = await search.search({ query: 'needle', limit: 1 });
    expect(first.total).toBe(2);
    expect(first.cursor).toBeTruthy();
    await writeFile(join(root, 'b.txt'), 'needle repaired');
    await expect(search.search({ query: 'needle', limit: 1, cursor: first.cursor })).rejects.toThrow(/changed|invalidat/i);
  } finally { search.close(); }
});

test('cached reference strings do not retain sliced source backing storage', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--allow-natives-syntax', '--import', 'tsx',
    fileURLToPath(new URL('../tests/document-search-string-ownership.mjs', import.meta.url))], { windowsHide: true, maxBuffer: 64000 });
  const [baseline, cached] = stdout.split('CACHE_REFERENCE');
  expect(baseline).toMatch(/SLICED.*STRING_TYPE/);
  expect(cached).toBeDefined();
  expect(cached).not.toMatch(/SLICED.*STRING_TYPE/);
}, 30000);

test('fragment pagination uses bounded ranking rather than sorting all matches', async () => {
  await writeFile(join(root, 'note.md'), Array.from({ length: 350 }, (_, i) => `needle ${i}`).join('\n\n'));
  let largest = 0;
  const offer = DocumentTopK.prototype.offer;
  const add = vi.spyOn(DocumentTopK.prototype, 'offer').mockImplementation(function (this: DocumentTopK<unknown>, row: unknown) {
    offer.call(this, row); largest = Math.max(largest, this.size);
  });
  const search = new DocumentSearch(index);
  const first = await search.search({ query: 'needle', path: 'note.md', limit: 1 });
  expect(first.total).toBe(350);
  expect(add).toHaveBeenCalled();
  expect(largest).toBeLessThanOrEqual(100);
  const second = await search.search({ query: 'needle', path: 'note.md', limit: 1, cursor: first.cursor });
  expect(second.items[0].startOffset).toBeGreaterThan(first.items[0].startOffset);
  expect(second.total).toBe(350);
});

test('next fragment page reuses bounded metadata ranks without loading full documents again', async () => {
  const raw = Array.from({ length: 6 }, (_, i) => `needle ${i} ` + 'x'.repeat(500) + ' ORIGINAL_BODY_TAIL').join('\n\n');
  await writeFile(join(root, 'note.md'), raw);
  const search = new DocumentSearch(index);
  const first = await search.search({ query: 'needle', path: 'note.md', limit: 1 });
  const load = vi.spyOn(index, 'load');
  const next = await search.search({ query: 'needle', path: 'note.md', limit: 1, cursor: first.cursor });
  expect(next.items[0].startOffset).toBeGreaterThan(first.items[0].startOffset);
  expect(load).not.toHaveBeenCalled();
  expect(JSON.stringify([...(search as any).pages.values()])).not.toContain('ORIGINAL_BODY_TAIL');
  await writeFile(join(root, 'note.md'), 'changed');
  await expect(search.search({ query: 'needle', path: 'note.md', limit: 1, cursor: next.cursor })).rejects.toThrow(/revision|changed/i);
});
test('hidden bodies cannot influence hit counts and stale paginated results reject', async () => {
  await writeFile(join(root, 'hidden.md'), '---\nmoderation_status: hidden\n---\nneedle');
  await expect(new DocumentSearch(index).search({ path: 'hidden.md', query: 'needle' })).rejects.toThrow();
  await writeFile(join(root, 'note.md'), '# A\n\nneedle one\n\nneedle two');
  const search = new DocumentSearch(index), first = await search.search({ path: 'note.md', query: 'needle', limit: 1 });
  await writeFile(join(root, 'note.md'), '# B\n\nneedle other');
  await expect(search.search({ path: 'note.md', query: 'needle', cursor: first.cursor })).rejects.toThrow(/cursor|changed|invalid|revision/i);
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

test('global discovery explicitly rejects exhausted work memory instead of reporting no evidence', async () => {
  const search = await resourceSearch(['note.txt']);
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes);
  try { await expect(search.search({ query: 'needle' })).rejects.toThrow(/work memory budget/i); }
  finally { held.release(); }
});

test('warm discovery classifies only newly added resource paths and keeps permission checks current', async () => {
  const reader = index.reader; await index.close();
  let paths: readonly string[] = ['a.txt', ...Array.from({ length: 1000 }, (_, i) => `image${i}.png`)];
  await writeFile(join(root, 'a.txt'), 'needle one');
  index = new DocumentIndex(reader, { subscribeBatch: () => () => {}, allPathsSnapshot: async () => paths } as any);
  const search = new DocumentSearch(index, { skillDiscoveryAllowed: () => true, searchNotes: async () => [] });
  const media = vi.spyOn(documentResource, 'documentMedia');
  await search.search({ query: 'needle' }); media.mockClear();
  await search.search({ query: 'needle' });
  // Reader media resolution is independent: only count discovery's image entries.
  expect(media.mock.calls.filter(([path]) => path.endsWith('.png'))).toHaveLength(0);
  paths = [...paths, 'added.png']; media.mockClear();
  await search.search({ query: 'needle' });
  expect(media.mock.calls.filter(([path]) => path.endsWith('.png')).map(([path]) => path)).toEqual(['added.png']);
  vi.spyOn(reader.access, 'canAccessPhysicalPath').mockReturnValue(false);
  expect((await search.search({ query: 'needle' })).items).toHaveLength(0);
  search.close();
});
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
}, 30000);
test('byte-budget continuation starts at the first unprocessed file', async () => {
  const search = await resourceSearch(['a.txt', 'b.txt', 'c.txt']);
  const original = index.load.bind(index);
  const actualSnapshots = new WeakMap<object, Awaited<ReturnType<DocumentIndex['load']>>['snapshot']>();
  const assertCurrent = index.reader.assertCurrent.bind(index.reader);
  const pin = index.reader.pin.bind(index.reader);
  vi.spyOn(index.reader, 'pin').mockImplementation(snapshot => pin(actualSnapshots.get(snapshot) ?? snapshot));
  vi.spyOn(index.reader, 'assertCurrent').mockImplementation((snapshot, principal) => assertCurrent(actualSnapshots.get(snapshot) ?? snapshot, principal));
  vi.spyOn(index, 'load').mockImplementation(async (...args) => {
    const loaded = await original(...args);
    // Controlled accounting boundary; no large allocations or parsing fixture.
    const snapshot = { ...loaded.snapshot, bytes: { length: 8 * 1024 * 1024 } as Buffer };
    actualSnapshots.set(snapshot, loaded.snapshot);
    return { ...loaded, snapshot };
  });
  const first = await search.search({ query: 'needle' });
  expect(first.items.map(row => row.path)).not.toContain('c.txt');
  expect(first.nextResourceAction).toBeTruthy();
  const next = await search.search((first.nextResourceAction as any).arguments);
  expect(next.items.map(row => row.path)).toEqual(['c.txt', 'c.txt']);
});

test('bounded pages cross ranking windows and survive eviction without gaps or duplicates', async () => {
  await writeFile(join(root, 'note.md'), Array.from({ length: 235 }, (_, i) => `needle ${i}`).join('\n\n'));
  const search = new DocumentSearch(index), ids: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await search.search({ query: 'needle', path: 'note.md', limit: 17, maxChars: 12000, cursor });
    expect(result.total).toBe(235);
    ids.push(...result.items.map(row => row.id));
    cursor = result.cursor;
    if (ids.length > 30 && ids.length < 50) {
      const pressure = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes); pressure.release();
    } // Evicted metadata is advisory, not cursor authority.
  } while (cursor);
  expect(ids).toHaveLength(235); expect(new Set(ids).size).toBe(235);
  search.close();
});

test('closing during final source validation cannot repopulate document search caches', async () => {
  await writeFile(join(root, 'note.md'), 'needle one\n\nneedle two');
  const search = new DocumentSearch(index);
  let release!: () => void, entered!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const real = index.reader.assertCurrent.bind(index.reader);
  vi.spyOn(index.reader, 'assertCurrent').mockImplementation(async (...args) => {
    await real(...args);
    if (++calls === 2) { entered(); await gate; }
  });
  const pending = search.search({ query: 'needle', path: 'note.md', limit: 1 });
  await waiting; search.close(); release();
  await expect(pending).rejects.toThrow(/closed/i);
  expect((search as any).pages.size).toBe(0);
});

test('collation-equivalent distinct paths resume after metadata eviction without losing results', async () => {
  const search = await resourceSearch(['\u00e9.txt', 'e\u0301.txt']);
  await writeFile(join(root, '\u00e9.txt'), 'needle'); await writeFile(join(root, 'e\u0301.txt'), 'needle');
  const first = await search.search({ query: 'needle', limit: 1 });
  expect(first.total).toBe(2);
  const pressure = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes); pressure.release();
  const next = await search.search({ query: 'needle', limit: 1, cursor: first.cursor });
  expect(next.items).toHaveLength(1); expect(next.items[0].path).not.toBe(first.items[0].path);
  expect(next.truncated).toBe(false);
  search.close();
});

test('a valid long Unicode path produces a usable signed continuation cursor', async () => {
  const path = ['가'.repeat(60), '나'.repeat(60), '다'.repeat(60), '라'.repeat(10) + '.txt'].join('/');
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'needle one\n\nneedle two');
  const search = new DocumentSearch(index);
  const first = await search.search({ query: 'needle', path, limit: 1, maxChars: 12000 });
  expect(first.cursor!.length).toBeGreaterThan(1000);
  const next = await search.search({ query: 'needle', path, limit: 1, maxChars: 12000, cursor: first.cursor });
  expect(next.items[0].id).not.toBe(first.items[0].id);
  expect(next.truncated).toBe(false);
  search.close();
});

test('signed cursor rejects forged rank anchors and context changes on cached pages', async () => {
  await writeFile(join(root, 'note.md'), 'needle one\n\nneedle two\n\nneedle three');
  const search = new DocumentSearch(index);
  const first = await search.search({ query: 'needle', path: 'note.md', limit: 1 });
  const value = JSON.parse(Buffer.from(first.cursor!, 'base64url').toString('utf8'));
  value.a.offset++;
  await expect(search.search({ query: 'needle', path: 'note.md', cursor: Buffer.from(JSON.stringify(value)).toString('base64url') })).rejects.toThrow(/cursor/i);
  await expect(search.search({ query: 'one', path: 'note.md', cursor: first.cursor })).rejects.toThrow(/cursor/i);
  const next = await search.search({ query: 'needle', path: 'note.md', limit: 1, cursor: first.cursor });
  next.items[0].description = 'poisoned response';
  const repeated = await search.search({ query: 'needle', path: 'note.md', limit: 1, cursor: first.cursor });
  expect(repeated.items[0].description).not.toBe('poisoned response');
  search.close();
});
