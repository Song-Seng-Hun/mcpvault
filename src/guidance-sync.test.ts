import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuidanceSync } from './guidance-sync.js';
import { GuidanceCatalog, serializeGuidanceNote } from './guidance-catalog.js';
const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const definition = { id: 'guid-sync', kind: 'prose' as const, template: 'Read first.', parts: ['Read first.'], binding: 'call' as const, sources: [{ file: 'src/example.ts', line: 1 }] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'guid-sync-')); roots.push(root);
  const catalog = new GuidanceCatalog(root, () => ({ root: '_wiki/Interface', editors: [] }), [definition]);
  return { root, catalog, sync: new GuidanceSync(root, catalog), file: join(root, catalog.pathFor(definition.id)) };
}
test('host synchronization previews, creates once, preserves edits, and detects code conflicts', async () => {
  const { sync, catalog, root, file } = await fixture();
  const preview = await sync.preview(); expect(preview.changes[0]?.action).toBe('create');
  await sync.apply(preview.fingerprint);
  expect(catalog.inspect(definition.id).status).toBe('default');
  expect((await sync.preview()).changes[0]?.action).toBe('unchanged');
  await writeFile(file, serializeGuidanceNote(definition, 'Review carefully.'));
  expect((await sync.preview()).changes[0]?.action).toBe('preserve');
  const next = { ...definition, template: 'New code default.', parts: ['New code default.'] };
  const changed = new GuidanceSync(root, new GuidanceCatalog(root, () => ({ root: '_wiki/Interface', editors: [] }), [next]));
  expect((await changed.preview()).changes[0]?.action).toBe('source_conflict');
  await changed.apply((await changed.preview()).fingerprint);
  expect(await readFile(file, 'utf8')).toContain('Review carefully.');
});
test('host sync rejects stale previews and never overwrites unrelated Markdown', async () => {
  const { root, sync, file } = await fixture(); const p = await sync.preview();
  await mkdir(join(root, '_wiki/Interface/prose'), { recursive: true });
  await writeFile(file, 'My unrelated note');
  await expect(sync.apply(p.fingerprint)).rejects.toThrow(/changed/i);
  expect((await sync.preview()).changes[0]?.action).toBe('collision');
  expect(await readFile(file, 'utf8')).toBe('My unrelated note');
});

test('unedited old defaults update with current source identity', async () => {
  const { root, catalog, file } = await fixture();
  await mkdir(join(root, '_wiki/Interface/prose'), { recursive: true });
  await writeFile(file, serializeGuidanceNote({ ...definition, template: 'Older default', parts: ['Older default'] }));
  const sync = new GuidanceSync(root, catalog), preview = await sync.preview();
  expect(preview.changes[0]?.action).toBe('update_default');
  await sync.apply(preview.fingerprint);
  expect(catalog.inspect(definition.id).status).toBe('default');
  expect(await readFile(file, 'utf8')).toContain(definition.template);
});
