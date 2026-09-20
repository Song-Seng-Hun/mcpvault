import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySqliteStore } from './sqlite-store.js';

const roots: string[] = [], stores: MemorySqliteStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'curation-store-')); roots.push(root);
  const store = new MemorySqliteStore(join(root, 'index.sqlite')); stores.push(store); await store.ready(); return store;
}
const row = (path: string, text: string, frontmatter: Record<string, unknown> = {}) => ({ path, text,
  revision: 'a'.repeat(64), frontmatter: { llm_wiki_type: 'knowledge', ...frontmatter } });

test('curation discovery is a separate revision-pinned keyset index, not memory retrieval', async () => {
  const s = await setup();
  expect((s as any).curationPage).toBeTypeOf('function');
  await s.put([row('A.md', '조건 (condition): keep the exception.', { related: ['[[B]]', '[[B]]'] }),
    row('B.md', 'Different.', { related: ['[[A]]', '[[A|Alias]]'] }),
    row('C.md', 'Third.', { related: ['[[B]]', '[[B]]'] })]);
  const first = await s.curationPage({ kind: 'relations', limit: 1 });
  expect(first.notes.map(n => n.path)).toEqual(['A.md']); expect(first.truncated).toBe(true);
  const second = await s.curationPage({ kind: 'relations', limit: 1, after: first.next, expectedGeneration: first.generation });
  expect(second.notes.map(n => n.path)).toEqual(['C.md']); expect(second.truncated).toBe(false);
  expect((await s.page({ terms: [], limit: 20 })).notes).toEqual([]);
});

test('identical bodies are discovery groups, not identity, ownership or merge permission', async () => {
  const s = await setup(); expect((s as any).curationPage).toBeTypeOf('function');
  await s.put([row('Old.md', 'Same exact body.', { version: 1 }), row('New.md', 'Same exact body.', { version: 2 }),
    row('Unique.md', 'Not the same.'), row('Empty.md', ''), row('Blank.md', '')]);
  const page = await s.curationPage({ kind: 'duplicate_content', limit: 8 });
  expect(page.notes.map(n => n.path)).toEqual(['New.md', 'Old.md']);
  expect(page.coverage).toBe('candidates_only'); expect(page).not.toHaveProperty('managed');
  expect((await s.curationExplain({ kind: 'duplicate_content', limit: 8 })).join('\n')).toMatch(/curation_groups_active/);
});

test('incremental updates, unchanged replay, deletion and reconciliation maintain duplicate groups', async () => {
  const s = await setup(); expect((s as any).curationPage).toBeTypeOf('function');
  const a = row('A.md', 'Same.'), b = row('B.md', 'Same.'); await s.put([a, b]);
  const first = await s.curationPage({ kind: 'duplicate_content', limit: 1 });
  await s.put([a, b]); expect(await s.generation()).toBe(first.generation);
  await s.put([{ ...b, text: 'Changed.', revision: 'b'.repeat(64) }]);
  await expect(s.curationPage({ kind: 'duplicate_content', limit: 1, after: first.next, expectedGeneration: first.generation })).rejects.toThrow();
  expect((await s.curationPage({ kind: 'duplicate_content', limit: 8 })).notes).toEqual([]);
  await s.put([b]); expect((await s.curationPage({ kind: 'duplicate_content', limit: 8 })).notes).toHaveLength(2);
  await s.beginScan(); await s.seen(['A.md']); await s.finishScan();
  expect((await s.curationPage({ kind: 'duplicate_content', limit: 8 })).notes).toEqual([]);
});

test('protected and retired content is not a low-risk automation candidate; age and managed labels confer no authority', async () => {
  const s = await setup(); expect((s as any).curationPage).toBeTypeOf('function');
  const unsafe = [{ immutable: true }, { source_only: true }, { legal_hold: true }, { lifecycle: 'archived' },
    { lifecycle: 'superseded' }, { retention_policy: 'preserve' }, { processing_mode: 'source_only' }];
  await s.put(unsafe.map((fm, i) => row(`Protected-${i}.md`, 'Same.', { related: ['[[A]]', '[[A]]'], ...fm })));
  await s.put([row('Old.md', 'Unique.', { modified: '2000-01-01', managed: true })]);
  expect((await s.curationPage({ kind: 'relations', limit: 20 })).notes).toEqual([]);
  expect((await s.curationPage({ kind: 'duplicate_content', limit: 20 })).notes).toEqual([]);
});

test('a large duplicate group pages without sorting all members or re-reading bodies', async () => {
  const s = await setup(); expect((s as any).curationPage).toBeTypeOf('function');
  for (let batch = 0; batch < 8; batch++) await s.put(Array.from({ length: 128 }, (_, i) => row(`N${String(batch * 128 + i).padStart(5, '0')}.md`, 'Hub.')));
  const seen: string[] = []; let after: { group: string; path: string } | undefined;
  for (let i = 0; i < 3; i++) {
    const page = await s.curationPage({ kind: 'duplicate_content', limit: 2, after, ...(after && { expectedGeneration: await s.generation() }) });
    seen.push(...page.notes.map(n => n.path)); after = page.next;
  }
  expect(seen).toEqual(['N00000.md', 'N00001.md', 'N00002.md', 'N00003.md', 'N00004.md', 'N00005.md']);
  const plan = (await s.curationExplain({ kind: 'duplicate_content', limit: 2, after, expectedGeneration: await s.generation() })).join('\n');
  expect(plan).toMatch(/curation_body_path/); expect(plan).not.toMatch(/SCAN (?:docs|curation_documents)\b|USE TEMP B-TREE/);
}, 30000);

test('positive delivery observations are account isolated, idempotent and not continuous usage coverage', async () => {
  const s = await setup(), actor = 'a'.repeat(64), document = 'b'.repeat(64), revision = 'c'.repeat(64);
  const event = { actor, eventId: 'd'.repeat(64), observedAt: 1000, documents: [{ document, revision }] };
  const generation = await s.generation();
  expect((s as any).recordCurationDelivery).toBeTypeOf('function');
  await s.recordCurationDelivery(event); await s.recordCurationDelivery(event);
  expect(await s.curationDelivery(actor, document)).toEqual({ observedAt: 1000, revision });
  expect(await s.curationDelivery('e'.repeat(64), document)).toBeUndefined();
  await s.recordCurationDelivery({ ...event, observedAt: 999, eventId: 'f'.repeat(64), documents: [{ document, revision: 'f'.repeat(64) }] });
  expect(await s.curationDelivery(actor, document)).toEqual({ observedAt: 1000, revision });
  expect(await s.generation()).toBe(generation);
  await expect(s.recordCurationDelivery({ ...event, actor: 'user-supplied path' })).rejects.toThrow();
});
