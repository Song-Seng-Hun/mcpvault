import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySqliteStore } from './sqlite-store.js';

const roots: string[] = [], stores: MemorySqliteStore[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
async function setup() { const root = await mkdtemp(join(tmpdir(), 'memory-sqlite-')); roots.push(root); const store = new MemorySqliteStore(join(root, 'memory.sqlite')); stores.push(store); await store.ready(); return store; }
const row = (path: string, text = 'NAS 배포 TypeScript', frontmatter: Record<string, unknown> = { memory_role: 'episodic' }) => ({ path, revision: 'a'.repeat(64), frontmatter, text });

test('disk candidates intersect prefix/role and Unicode postings before a bounded page', async () => {
  const s = await setup(); await s.put([row('A/one.md'), row('B/hidden.md'), row('A/two.md', '다른 사건'), row('A/three.md', '배포', { memory_role: 'procedural' })]);
  const page = await s.page({ prefix: 'A', terms: ['배포'], role: 'episodic', limit: 1 });
  expect(page.notes.map(n => n.path)).toEqual(['A/one.md']); expect(page.truncated).toBe(false);
  expect(JSON.stringify(page)).not.toContain('hidden');
  expect((await s.page({ prefix: 'A', terms: [], limit: 1 })).truncated).toBe(true);
  expect((await s.page({ prefix: 'A', terms: [], after: 'A/one.md', limit: 1 })).notes[0]?.path).toBe('A/three.md');
});

test('long keywords intersect all substring grams instead of filling top-k with the first three letters', async () => {
  const s = await setup(); await s.put([row('A/first.md', 'department'), row('A/right.md', 'deployment')]);
  expect((await s.page({ prefix: 'A', terms: ['deployment'], limit: 1 })).notes.map(n => n.path)).toEqual(['A/right.md']);
});
test('inverse dependencies find corrections outside the search subtree and preserve revision pins', async () => {
  const s = await setup(); await s.put([row('A/old.md'), row('Else/new.md', 'new', { memory_role: 'semantic', memory_corrects: [{ path: 'A/old.md', revision: 'a'.repeat(64) }] })]);
  const edges = await s.dependents(['A/old.md'], 20);
  expect(edges.notes.map(n => n.path)).toEqual(['Else/new.md']);
  expect(edges.notes[0]?.frontmatter.memory_corrects[0].revision).toBe('a'.repeat(64));
  await s.put([row('Else/new.md', 'new', { memory_role: 'semantic' })]); expect((await s.dependents(['A/old.md'], 20)).notes).toEqual([]);
});
test('identical upserts do not advance generation; deletion and restart preserve current rows', async () => {
  const s = await setup(); await s.put([row('A/one.md')]); const before = await s.generation();
  await s.put([row('A/one.md')]); expect(await s.generation()).toBe(before);
  await s.remove(['A/one.md']); expect(await s.generation()).not.toBe(before); expect((await s.page({ terms: [], limit: 20 })).notes).toEqual([]);
});
test('invalid paths and oversized worker requests fail without partial writes', async () => {
  const s = await setup(); await expect(s.put([row('../escape.md')])).rejects.toThrow();
  await expect(s.page({ terms: [], limit: 10001 })).rejects.toThrow();
  expect((await s.page({ terms: [], limit: 20 })).notes).toEqual([]);
});

test('one writer owns a database; restart retains rows and an unfinished scan cannot sweep them', async () => {
  const s = await setup(), path = join(roots.at(-1)!, 'memory.sqlite');
  await s.put([row('A/one.md'), row('A/two.md')]); await s.beginScan(); await s.seen(['A/one.md']);
  const competing = new MemorySqliteStore(path); stores.push(competing);
  await expect(competing.ready()).rejects.toThrow();
  await s.close();
  const restarted = new MemorySqliteStore(path); stores.push(restarted); await restarted.ready();
  expect((await restarted.page({ terms: [], limit: 10 })).notes).toHaveLength(2);
  await restarted.beginScan(); await restarted.seen(['A/one.md']); await restarted.finishScan();
  expect((await restarted.page({ terms: [], limit: 10 })).notes.map(n => n.path)).toEqual(['A/one.md']);
});

test('date and role apply to the same memory unit before top-k', async () => {
  const s = await setup(); await s.put([row('A/first.md', 'event', { memory_role: 'episodic', observed_at: '2020-01-01' }),
    row('A/recent.md', 'event', { memory_role: 'episodic', observed_at: '2026-09-20' })]);
  const page = await s.page({ terms: [], role: 'episodic', dateFrom: '2026-09-20', dateTo: '2026-09-20', limit: 1 });
  expect(page.notes.map(n => n.path)).toEqual(['A/recent.md']);
  const dateOnly = { terms: [], dateFrom: '2026-09-20', limit: 1 };
  expect((await s.page(dateOnly)).notes.map(n => n.path)).toEqual(['A/recent.md']);
  expect((await s.explain(dateOnly)).join('\n')).toContain('units_doc');
});

test('a damaged database is unavailable and never silently reset', async () => {
  const s = await setup(), path = join(roots.at(-1)!, 'memory.sqlite'); await s.close();
  await writeFile(path, 'damaged private cache'); const before = await readFile(path);
  const reopened = new MemorySqliteStore(path); stores.push(reopened);
  await expect(reopened.ready()).rejects.toThrow(); expect(await readFile(path)).toEqual(before);
});
