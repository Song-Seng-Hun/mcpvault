import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SemanticSearchService } from './semantic-search.js';
import { PathFilter } from './pathfilter.js';
import { chunkSemanticNote } from './semantic-chunks.js';
import { SEMANTIC_EMBEDDING_PROFILE } from './semantic-profile.js';

let vault: string, service: SemanticSearchService, embedded: string[];
const path = 'Knowledge/Note.md';
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const vector = (text: string) => Array.from({ length: 384 }, (_, i) => Math.fround(parseInt(hash(text).slice(i % 32 * 2, i % 32 * 2 + 2), 16) / 255));
function inference() {
  // Substitute expensive inference only; use real filesystem, LanceDB schema,
  // query builders, persistence, row replacement and service reconciliation.
  vi.spyOn(service as any, 'embedMany').mockImplementation(async (texts: any) => {
    embedded.push(...texts); return texts.map(vector);
  });
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-semantic-reuse-'));
  service = new SemanticSearchService(vault, new PathFilter());
  await (service as any).manifestReady; await (service as any).pendingReady;
  embedded = []; inference();
});
afterEach(async () => {
  await service.close(); vi.useRealTimers(); vi.restoreAllMocks();
  const target = await realpath(vault), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-semantic-reuse-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(raw: string, target = path) {
  await mkdir(dirname(join(vault, target)), { recursive: true });
  await writeFile(join(vault, target), raw);
}
async function index(raw: string, target = path) {
  await seed(raw, target);
  const prepared = await (service as any).prepareIndex(target);
  await (service as any).applyIndexBatch([prepared], []);
  return prepared;
}

test('Properties-only edits reuse all vectors and rebuild the source revision and physical anchors', async () => {
  const raw = '---\ntag: old\n---\n# Note\n\n첫째 문단\n\nSecond paragraph';
  await index(raw); embedded.length = 0;
  const changed = raw.replace('tag: old', 'tag: new\nreviewed: today');
  const result = await index(changed);
  expect(embedded).toEqual([]);
  expect(result.rows.map((r: any) => r.line)).toEqual(chunkSemanticNote(path, changed).map(c => c.line));
  expect(result.rows.every((r: any) => r.hash === hash(changed))).toBe(true);
  expect(await readFile(join(vault, path), 'utf8')).toBe(changed);
});

test('one changed paragraph in a 64-chunk note embeds one input rather than 64', async () => {
  const raw = Array.from({ length: 64 }, (_, i) => `Paragraph ${i}`).join('\n\n');
  expect(chunkSemanticNote(path, raw)).toHaveLength(64);
  await index(raw); expect(embedded).toHaveLength(64); embedded.length = 0;
  const changed = raw.replace('Paragraph 37', '수정한 문단 37');
  const result = await index(changed);
  expect(embedded).toEqual(['수정한 문단 37']);
  expect(result.rows).toHaveLength(64);
});

test('reordered paragraphs reuse vectors by content rather than stale ordinal IDs', async () => {
  await index('# Note\n\nA paragraph\n\nB paragraph'); embedded.length = 0;
  const changed = '# Note\n\nB paragraph\n\nA paragraph';
  const result = await index(changed);
  expect(embedded).toEqual([]);
  expect(result.rows.map((r: any) => r.vector)).toEqual(chunkSemanticNote(path, changed).map(c => vector(c.text)));
});

test('persisted rows remain reusable after closing and reopening the service', async () => {
  await index('# Note\n\nShared text'); await (service as any).saveManifest();
  await service.close(); vi.restoreAllMocks();
  service = new SemanticSearchService(vault, new PathFilter());
  await (service as any).manifestReady; await (service as any).pendingReady;
  embedded.length = 0; inference();
  await index('---\nnew: property\n---\n# Note\n\nShared text');
  expect(embedded).toEqual([]);
});

test('legacy table columns migrate without source deletion and old vectors are recomputed', async () => {
  const raw = '# Note\n\nOld text';
  await seed(raw);
  const db = await (service as any).getDb();
  await db.createTable('chunks_global', [{ id: path + '#0', path, hash: hash(raw), title: 'Note', line: 1, wiki: true, updatedAt: 'old', vector: vector('old') }]);
  const result = await index(raw);
  expect(embedded).toHaveLength(chunkSemanticNote(path, raw).length);
  const stored = await (await (service as any).getTable('chunks_global')).query().toArray();
  expect(stored).toHaveLength(result.rows.length);
  expect(stored.every((r: any) => r.embeddingProfile === SEMANTIC_EMBEDDING_PROFILE && r.chunkHash)).toBe(true);
  expect(await readFile(join(vault, path), 'utf8')).toBe(raw);
});

test.each([undefined, 'old-profile'])('unchanged stats with %s profile still schedule bounded rebuilding', async profile => {
  await index('# Note');
  (service as any).manifest[path].embeddingProfile = profile;
  await (service as any).scanForChanges();
  expect((service as any).pending.get(path)).toMatchObject({ kind: 'upsert' });
});

test('fresh profile is persisted and unchanged notes do not schedule rebuilding', async () => {
  await index('# Note'); await (service as any).saveManifest();
  await service.close(); vi.restoreAllMocks();
  service = new SemanticSearchService(vault, new PathFilter());
  await (service as any).manifestReady; await (service as any).pendingReady; inference();
  expect((service as any).manifest[path].embeddingProfile).toBe(SEMANTIC_EMBEDDING_PROFILE);
  await (service as any).scanForChanges();
  expect((service as any).pending.size).toBe(0);
});

test('queries do not compare current query vectors against a different embedding profile', async () => {
  const raw = '# Note';
  const prepared = await index(raw);
  const table = await (service as any).getTable('chunks_global');
  await table.delete('true');
  await table.add(prepared.rows.map((r: any) => ({ ...r, embeddingProfile: 'old-profile' })));
  vi.spyOn(service as any, 'acquireIndexLease').mockResolvedValue(false);
  const result = await service.search({ query: 'Note', queryVector: vector('Note'), maxChars: 512 });
  expect(result.available).toBe(true);
  expect(result.results).toEqual([]);
});

test('different notes and scopes never share a reuse lookup', async () => {
  const raw = '# Note\n\nSame paragraph';
  await index(raw); embedded.length = 0;
  await index(raw, 'Elsewhere/Note.md');
  expect(embedded).toHaveLength(2); embedded.length = 0;
  await index(raw, '_scopes/agents/private-worker/Note.md');
  expect(embedded).toHaveLength(2);
});

test('wrong profiles are cache misses during update, not reusable values', async () => {
  const raw = '# Note\n\nText', prepared = await index(raw);
  const table = await (service as any).getTable('chunks_global');
  await table.delete('true');
  await table.add(prepared.rows.map((r: any) => ({ ...r, embeddingProfile: 'old-profile' })));
  embedded.length = 0;
  await index(raw);
  expect(embedded).toHaveLength(2);
});

test('more than 64 rows cause a bounded miss instead of partial reuse', async () => {
  const raw = '# Note', prepared = await index(raw);
  const table = await (service as any).getTable('chunks_global');
  await table.add(Array.from({ length: 65 }, (_, i) => ({ ...prepared.rows[0], id: `${path}#extra${i}` })));
  embedded.length = 0;
  await index(raw);
  expect(embedded).toHaveLength(1);
  expect(await table.countRows()).toBe(1);
});

test('reuse query failure falls back to embedding without losing the update', async () => {
  const raw = '# Note'; await index(raw); embedded.length = 0;
  const table = await (service as any).getTable('chunks_global');
  vi.spyOn(table, 'query').mockImplementationOnce(() => { throw new Error('native lookup failure'); });
  await index(raw);
  expect(embedded).toHaveLength(1);
  expect(await table.countRows()).toBe(1);
});

test.each([[], Array(384).fill(NaN), Array(384).fill('0')])('invalid cached vectors fall back to inference', async bad => {
  const raw = '# Note', prepared = await index(raw); embedded.length = 0;
  const table = await (service as any).getTable('chunks_global');
  // Fault-inject only corrupt driver output which a typed Arrow write rejects.
  vi.spyOn(table, 'query').mockImplementationOnce(() => ({ where() { return this; }, select() { return this; }, limit(n: number) { expect(n).toBe(65); return this; }, toArray: async () => [{ ...prepared.rows[0], vector: bad }] }));
  await index(raw);
  expect(embedded).toHaveLength(1);
});

test('even an all-reused update rejects a source edit during the lookup', async () => {
  const raw = '# Note'; await index(raw); embedded.length = 0;
  const table = await (service as any).getTable('chunks_global');
  const query = table.query.bind(table);
  vi.spyOn(table, 'query').mockImplementationOnce(() => {
    const builder = query(), toArray = builder.toArray.bind(builder);
    builder.toArray = async () => { const rows = await toArray(); await seed('# Concurrent change'); return rows; };
    return builder;
  });
  await expect((service as any).prepareIndex(path)).rejects.toThrow(/unavailable/i);
  expect(embedded).toEqual([]);
  expect((service as any).manifest[path].hash).toBe(hash(raw));
});

test('SQL-quoted paths remain exact during lookup and replacement', async () => {
  const target = "Knowledge/Agent's Note.md";
  await index('# Note', target); embedded.length = 0;
  await index('---\nnew: true\n---\n# Note', target);
  expect(embedded).toEqual([]);
});

test('model-free reuse still releases idle database handles', async () => {
  await index('# Note');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await (service as any).getDb();
  expect((service as any).db).toBeDefined();
  await vi.advanceTimersByTimeAsync(60_001);
  expect((service as any).db).toBeUndefined();
  expect((service as any).tableCache.size).toBe(0);
});

test('the resource idle timer does not close an in-progress indexing batch', async () => {
  await index('# Note');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await (service as any).getDb();
  (service as any).syncPromise = new Promise(() => {});
  await vi.advanceTimersByTimeAsync(60_001);
  expect((service as any).db).toBeDefined();
  (service as any).syncPromise = undefined;
  await vi.advanceTimersByTimeAsync(60_001);
  expect((service as any).db).toBeUndefined();
});

test('a slow semantic query holds resources until completion, then releases after idle', async () => {
  const prepared = await index('# Note');
  const table = await (service as any).getTable('chunks_global');
  vi.spyOn(service as any, 'acquireIndexLease').mockResolvedValue(false);
  let entered!: () => void, finish!: (rows: any[]) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const rows = new Promise<any[]>(resolve => { finish = resolve; });
  vi.spyOn(table, 'vectorSearch').mockImplementationOnce(() => ({ where() { return this; }, distanceType() { return this; }, limit() { return this; }, toArray() { entered(); return rows; } }));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await (service as any).getDb();
  const request = service.search({ query: 'Note', queryVector: vector('Note'), maxChars: 512 });
  await ready;
  await vi.advanceTimersByTimeAsync(60_001);
  expect((service as any).db).toBeDefined();
  finish(prepared.rows);
  expect((await request).results).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(60_001);
  expect((service as any).db).toBeUndefined();
});
