import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySqliteStore } from './sqlite-store.js';
import { DatabaseSync } from 'node:sqlite';

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

test('graph occurrences retain contrast, contradiction, anchors and separate duplicates in bounded reverse pages', async () => {
  const s = await setup();
  await s.put([row('A.md', '# A\n[[B#Condition|조건]]\n```md\n[[NotEvidence]]\n```', {
    contrasts_with: ['[[B]]', '[[B]]'], contradicts: ['[[B]]'],
  }), row('C.md', '[[B]]')]);
  const first = await s.graph({ direction: 'incoming', keys: ['b'], limit: 2 });
  expect(first.occurrences).toHaveLength(2); expect(first.truncated).toBe(true);
  expect(first.coverage).toBe('candidates_only');
  const second = await s.graph({ direction: 'incoming', keys: ['b'], limit: 20, after: first.next!, expectedGeneration: first.generation });
  expect(new Set([...first.occurrences, ...second.occurrences].map(r => r.id)).size).toBe(5);
  const outgoing = await s.graph({ direction: 'outgoing', keys: ['A.md'], limit: 20 });
  expect(outgoing.occurrences.map(r => r.relation).sort()).toEqual(['contradicts', 'contrasts_with', 'contrasts_with', 'link']);
  expect(JSON.stringify(outgoing)).toContain('B#Condition|조건');
  expect(JSON.stringify(outgoing)).not.toContain('NotEvidence');
  expect((await s.graphExplain({ direction: 'incoming', keys: ['b'], limit: 2 })).join('\n')).toContain('graph_reverse');
});

test('a graph continuation cannot silently combine two index generations', async () => {
  const s = await setup(); await s.put([row('A.md', '[[B]]'), row('C.md', '[[B]]')]);
  const first = await s.graph({ direction: 'incoming', keys: ['b'], limit: 1 });
  await s.put([row('D.md', '[[B]]')]);
  await expect(s.graph({ direction: 'incoming', keys: ['b'], limit: 1, after: first.next!, expectedGeneration: first.generation })).rejects.toThrow();
});

test('graph incremental replacement and deletion remove stale paths without conflating memory correction edges', async () => {
  const s = await setup(); await s.put([row('A.md', '[[B]]', { memory_role: 'semantic', memory_corrects: [{ path: 'Old.md', revision: 'a'.repeat(64) }] })]);
  expect((await s.dependents(['Old.md'], 20)).notes).toHaveLength(1);
  await s.put([row('A.md', '[[C]]')]);
  expect((await s.graph({ direction: 'incoming', keys: ['b'], limit: 20 })).occurrences).toHaveLength(0);
  expect((await s.graph({ direction: 'incoming', keys: ['c'], limit: 20 })).occurrences).toHaveLength(1);
  await s.remove(['A.md']); expect((await s.graph({ direction: 'incoming', keys: ['c'], limit: 20 })).occurrences).toHaveLength(0);
});

test('high degree extraction is explicitly incomplete and graph paging enforces its own limits', async () => {
  const s = await setup(); await s.put([row('Hub.md', '', { related: Array.from({ length: 90 }, (_, i) => `[[Target${i}]]`) })]);
  const result = await s.graph({ direction: 'outgoing', keys: ['Hub.md'], limit: 200 });
  expect(result.occurrences).toHaveLength(80); expect(result.incompleteOwners).toEqual(['Hub.md']);
  await expect(s.graph({ direction: 'outgoing', keys: ['../escape.md'], limit: 200 })).rejects.toThrow();
  await expect(s.graph({ direction: 'incoming', keys: ['x'], limit: 201 })).rejects.toThrow();
});

test('multi-key graph windows bound each indexed branch before merging and paginate without duplicates', async () => {
  const s = await setup();
  await s.put(Array.from({ length: 64 }, (_, i) => row(`N${i}.md`, '[[Hub]] [[Other]]')));
  const q = { direction: 'incoming' as const, keys: ['hub', 'other', 'Hub.md'], limit: 7 };
  const expected = (await s.graph({ ...q, limit: 200 })).occurrences.map(a => a.id).sort();
  const ids: string[] = []; let after: string | undefined, generation: number | undefined;
  do {
    const p = await s.graph({ ...q, ...(after && { after, expectedGeneration: generation! }) });
    ids.push(...p.occurrences.map(a => a.id)); after = p.next; generation = p.generation;
  } while (after);
  expect(ids).toEqual(expected); expect(new Set(ids).size).toBe(128);
  const plan = (await s.graphExplain(q)).join('\n');
  expect(plan).toContain('CO-ROUTINE');
  expect(plan.match(/SEARCH g USING.*graph_reverse/g)).toHaveLength(2);
});

test('ordinary knowledge graph rows never become optional memory merely by sharing the read store', async () => {
  const s = await setup();
  await s.put([row('Knowledge.md', 'Deployment [[Hub]]', { llm_wiki_type: 'knowledge' }), row('Memory.md', 'Deployment')]);
  expect((await s.page({ terms: [], limit: 20 })).notes.map(n => n.path)).toEqual(['Memory.md']);
  expect((await s.page({ terms: ['Deployment'], limit: 20 })).notes.map(n => n.path)).toEqual(['Memory.md']);
  expect((await s.graph({ direction: 'incoming', keys: ['hub'], limit: 20 })).occurrences).toHaveLength(1);
  expect((await s.explain({ terms: [], limit: 20 })).join('\n')).toContain('docs_memory_path');
});

test('legacy rows retain memory eligibility and explicitly backfill graph coverage even when bytes are unchanged', async () => {
  const s = await setup(), path = join(roots.at(-1)!, 'memory.sqlite');
  const record = row('Memory.md', '[[Target]]'); await s.put([record]); await s.close();
  const legacy = new DatabaseSync(path);
  legacy.exec(`DROP TABLE graph_occurrences; DROP TABLE graph_documents;
    DROP TRIGGER memory_unit_insert; DROP TRIGGER memory_unit_delete;
    DROP INDEX docs_memory_path; ALTER TABLE docs DROP COLUMN memory;`);
  legacy.close();
  const reopened = new MemorySqliteStore(path); stores.push(reopened); await reopened.ready();
  expect((await reopened.page({ terms: [], limit: 20 })).notes.map(n => n.path)).toEqual(['Memory.md']);
  expect(await reopened.unindexedGraph(['Memory.md'])).toEqual(['Memory.md']);
  await reopened.put([record]);
  expect(await reopened.unindexedGraph(['Memory.md'])).toEqual([]);
  expect((await reopened.graph({ direction: 'incoming', keys: ['target'], limit: 20 })).occurrences).toHaveLength(1);
});

test('relative Markdown graph links are discoverable by destination while preserving original spelling', async () => {
  const s = await setup();
  await s.put([row('Project/A.md', '[Guide](./Target.md#Condition)\n[Upper](../Other.md)', { llm_wiki_type: 'knowledge' })]);
  const local = await s.graph({ direction: 'incoming', keys: ['Project/Target.md'], limit: 20 });
  expect(local.occurrences).toHaveLength(1);
  expect(local.occurrences[0]?.targetReference).toBe('[Guide](./Target.md#Condition)');
  expect((await s.graph({ direction: 'incoming', keys: ['Other.md'], limit: 20 })).occurrences).toHaveLength(1);
});
