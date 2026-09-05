import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultGraphIndex } from './vault-graph.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { packNavigationPage } from './navigation-page.js';

let vault: string;
let graph: VaultGraphIndex;
const visible = (p: string) => !p.startsWith('_scopes/');
const opts = { offset: 0, limit: 1, maxChars: 12000 };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-navigation-view-'));
  await writeFile(join(vault, 'Target.md'), '# Target');
  await writeFile(join(vault, 'A.md'), '[[Target]]\n[[MissingA]]');
  await writeFile(join(vault, 'B.md'), '[[Target]]\n[[MissingB]]');
  await mkdir(join(vault, '_scopes/models/other'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/other/Private.md'), 'private');
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
});
afterEach(async () => { graph.close(); await rm(vault, { recursive: true, force: true }); });
async function read(kind: string, offset = 0): Promise<any> {
  if (kind === 'backlinks') return graph.getBacklinks('Target.md', 1, visible, offset, undefined, true, true);
  if (kind === 'outlinks') return graph.getOutlinks('A.md', 1, visible, offset, true, true);
  if (kind === 'unresolved') return graph.findUnresolvedLinks(1, visible, offset, true);
  return graph.findOrphanNotes(1, visible, offset, true);
}
const endpoint = (kind: string) => ({ backlinks: 'mcp.get_backlinks', outlinks: 'mcp.get_outlinks', unresolved: 'mcp.find_unresolved_links', orphans: 'mcp.find_orphan_notes' }[kind]!);

test.each(['backlinks', 'outlinks', 'unresolved', 'orphans'])('%s fingerprints guard off-page result changes', async kind => {
  const first = await read(kind);
  expect(first.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const page = JSON.parse(packNavigationPage(kind as any, endpoint(kind), first, opts, {}));
  expect(page.nextAction.arguments.expectedSnapshot).toBe(first.snapshotFingerprint);
  const next = await read(kind, 1);
  expect(next.snapshotFingerprint).toBe(first.snapshotFingerprint);
  expect(() => packNavigationPage(kind as any, endpoint(kind), next, { ...opts, offset: 1 }, page.nextAction.arguments)).not.toThrow();
  const changedPath = kind === 'outlinks' ? 'A.md' : kind === 'unresolved' ? 'MissingB.md' : 'B.md';
  await writeFile(join(vault, changedPath), kind === 'orphans' ? '[[Target]]\n[[A]]' : '# changed');
  graph.invalidate(changedPath);
  const changed = await read(kind, 1);
  expect(changed.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
  expect(() => packNavigationPage(kind as any, endpoint(kind), changed, { ...opts, offset: 1 }, page.nextAction.arguments)).toThrow(/restart at offset 0 without expectedSnapshot/i);
});

test.each(['backlinks', 'outlinks', 'unresolved', 'orphans'])('%s ignores unrelated private edits and stable rebuilds', async kind => {
  const first = await read(kind);
  expect(first.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(vault, '_scopes/models/other/Private.md'), 'private changed [[Target]]');
  graph.invalidate('_scopes/models/other/Private.md');
  expect((await read(kind)).snapshotFingerprint).toBe(first.snapshotFingerprint);
  graph.invalidate();
  expect((await read(kind)).snapshotFingerprint).toBe(first.snapshotFingerprint);
});

test('query fingerprints and malformed guards cannot be reused on another endpoint', async () => {
  const incoming = await read('backlinks');
  const outgoing = await read('outlinks');
  expect(() => packNavigationPage('outlinks', endpoint('outlinks'), outgoing, opts, { expectedSnapshot: incoming.snapshotFingerprint })).toThrow(/view changed/i);
  expect(() => packNavigationPage('outlinks', endpoint('outlinks'), outgoing, opts, { expectedSnapshot: 'invalid' })).toThrow(/SHA-256/);
});

test('observed graph invalidation during asynchronous author checks is not certified', async () => {
  await read('backlinks');
  let once = false;
  await expect(graph.getBacklinks('Target.md', 1, visible, 0, async () => {
    if (!once) { once = true; graph.invalidate('B.md'); }
    return true;
  }, true, true)).rejects.toThrow(/changed during.*retry/i);
});

test('backlink fingerprints do not depend on source insertion order', async () => {
  const first = await read('backlinks');
  graph.invalidate('A.md', 'delete'); // File still exists; refresh reinserts the same source after B.
  const reordered = await read('backlinks');
  expect(reordered.backlinks).toEqual(first.backlinks);
  expect(reordered.snapshotFingerprint).toBe(first.snapshotFingerprint);
  expect((await graph.getBacklinks('Target.md', 1, visible)).snapshotFingerprint).toBeUndefined();
});

test('visibility-dependent context changes invalidate even unchanged source bytes', async () => {
  await writeFile(join(vault, 'A.md'), '[[Target]] [[Masked]]');
  const first = await read('backlinks');
  await writeFile(join(vault, '_scopes/models/other/Masked.md'), '# private');
  graph.invalidate('_scopes/models/other/Masked.md');
  const changed = await read('backlinks');
  expect(changed.backlinks[0].context).not.toBe(first.backlinks[0].context);
  expect(changed.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
});
