import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySqliteStore } from './sqlite-store.js';

const roots: string[] = [], stores: MemorySqliteStore[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'reference-store-')); roots.push(root);
  const s = new MemorySqliteStore(join(root, 'index.sqlite')); stores.push(s); await s.ready(); return s;
}
const row = (path: string, text = '', frontmatter: Record<string, unknown> = {}) => ({ path, text, frontmatter, revision: 'a'.repeat(64) });
const query = { keys: ['target'], limit: 2 };

test('empty or restarted stores cannot certify coverage; a completed scan can', async () => {
  const s = await setup(); expect((await s.referenceImpact(query)).complete).toBe(false);
  await s.beginReferenceScan(); await s.putReferenceDocuments([row('A.md')]); await s.seenReferences(['A.md']);
  expect((await s.referenceImpact(query)).complete).toBe(false);
  await s.finishReferenceScan(); expect(await s.referenceImpact(query)).toMatchObject({ complete: true, candidates: [], truncated: false });
  await s.close(); const reopened = new MemorySqliteStore(join(roots.at(-1)!, 'index.sqlite')); stores.push(reopened); await reopened.ready();
  expect((await reopened.referenceImpact(query)).complete).toBe(false);
});

test('private non-memory rows and non-navigational references remain in the private impact index', async () => {
  const s = await setup(); await s.beginReferenceScan();
  const rows = [row('Hidden.md', '[[target]]', { moderation_status: 'hidden' }),
    row('Snapshot.txt', '', { memory_basis: [{ path: 'target.md' }] }), row('World.markdown', '[[target]]', { content_domain: 'fiction' })];
  await s.putReferenceDocuments(rows); await s.seenReferences(rows.map(r => r.path)); await s.finishReferenceScan();
  const result = await s.referenceImpact(query);
  expect(result.candidates).toHaveLength(2); expect(result.truncated).toBe(true); expect(result.complete).toBe(true);
  expect(JSON.stringify(result)).not.toContain('moderation_status');
  expect((await s.page({ terms: [], limit: 20 })).notes).toEqual([]);
  expect((await s.referenceImpactExplain(query)).join('\n')).toMatch(/reference_targets/);
});

test('overflow anywhere blocks absence, not just among rows matching the requested key', async () => {
  const s = await setup(); await s.beginReferenceScan();
  await s.putReferenceDocuments([row('Overflow.md', '[[other]]\n'.repeat(202))]); await s.seenReferences(['Overflow.md']); await s.finishReferenceScan();
  expect(await s.referenceImpact(query)).toMatchObject({ candidates: [], complete: false });
});

test('updates invalidate generations, retries are idempotent, interrupted scans do not sweep', async () => {
  const s = await setup(); await s.beginReferenceScan(); const r = row('A.md', '[[target]]');
  await s.putReferenceDocuments([r]); await s.seenReferences(['A.md']); await s.finishReferenceScan();
  const before = await s.referenceImpact(query); await s.putReferenceDocuments([r]);
  expect((await s.referenceImpact(query)).generation).toBe(before.generation);
  await s.putReferenceDocuments([{ ...r, revision: 'b'.repeat(64), text: 'changed' }]);
  await expect(s.referenceImpact({ ...query, expectedGeneration: before.generation })).rejects.toThrow();
  await s.beginReferenceScan(); expect((await s.referenceImpact(query)).complete).toBe(false);
  await s.putReferenceDocuments([r]);
  expect((await s.referenceImpact(query)).candidates).toHaveLength(1);
  await s.finishReferenceScan(); expect((await s.referenceImpact(query)).candidates).toEqual([]);
});
