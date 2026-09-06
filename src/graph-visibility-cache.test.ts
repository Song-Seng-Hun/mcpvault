import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { VaultGraphIndex } from './vault-graph.js';

const fixtures: Array<{ vault: string; graph: VaultGraphIndex }> = [];
afterEach(async () => { for (const { vault, graph } of fixtures.splice(0)) { graph.close(); await rm(vault, { recursive: true, force: true }); } });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-graph-visibility-'));
  await writeFile(join(vault, 'Root.md'), '# Links\n[[Secret]]\n[[Visible]]');
  await writeFile(join(vault, 'Secret.md'), '# Secret\n[[Visible]]\n[[Missing]]');
  await writeFile(join(vault, 'Visible.md'), '# Visible');
  const graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fixtures.push({ vault, graph });
  const denied = new Set<string>();
  const canAccess = (path: string) => !denied.has(path);
  return { vault, graph, denied, canAccess };
}

test('a reused predicate cannot keep exposing targets after permission revocation', async () => {
  const { graph, denied, canAccess } = await fixture();
  expect((await graph.getOutlinks('Root.md', 10, canAccess)).total).toBe(2);
  denied.add('Secret.md');
  const next = await graph.getOutlinks('Root.md', 10, canAccess, 0, true, true);
  expect(next.total).toBe(1);
  expect(JSON.stringify(next)).not.toContain('Secret');
});

test('a reused predicate discovers newly granted targets without filesystem changes', async () => {
  const { graph, denied, canAccess } = await fixture();
  denied.add('Secret.md');
  expect((await graph.getOutlinks('Root.md', 10, canAccess)).total).toBe(1);
  denied.clear();
  expect((await graph.getOutlinks('Root.md', 10, canAccess)).total).toBe(2);
});

test('cached unresolved and orphan inventories exclude newly hidden authors and targets', async () => {
  const { graph, denied, canAccess } = await fixture();
  expect((await graph.findUnresolvedLinks(10, canAccess)).total).toBe(1);
  await graph.findOrphanNotes(10, canAccess);
  denied.add('Secret.md');
  const unresolved = await graph.findUnresolvedLinks(10, canAccess, 0, true);
  const orphans = await graph.findOrphanNotes(10, canAccess, 0, true);
  expect(unresolved.total).toBe(0);
  expect(JSON.stringify({ unresolved, orphans })).not.toContain('Secret');
});

test('backlink heading projection rechecks revoked target visibility with the same predicate', async () => {
  const { graph, denied, canAccess } = await fixture();
  await graph.getBacklinks('Visible.md', 10, canAccess);
  denied.add('Secret.md');
  const result = await graph.getBacklinks('Visible.md', 10, canAccess);
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Secret');
});

test.each([false, true])('backlinks reject permission changes during asynchronous source checks (snapshot=%s)', async includeSnapshot => {
  const { graph, denied, canAccess } = await fixture();
  await graph.getBacklinks('Visible.md', 10, canAccess);
  const result = graph.getBacklinks('Visible.md', 10, canAccess, 0, async () => {
    denied.add('Root.md');
    return true;
  }, true, includeSnapshot);
  await expect(result).rejects.toThrow(/visibility changed|Graph changed/i);
});

test('same-size permission swaps rebuild resolution and change the navigation fingerprint', async () => {
  const { graph, denied, canAccess } = await fixture();
  denied.add('Secret.md');
  const first = await graph.getOutlinks('Root.md', 10, canAccess, 0, true, true);
  denied.delete('Secret.md'); denied.add('Visible.md');
  const second = await graph.getOutlinks('Root.md', 10, canAccess, 0, true, true);
  expect(first.total).toBe(1); expect(second.total).toBe(1);
  expect(first.outlinks[0]!.target).toMatch(/visible/i);
  expect(second.outlinks[0]!.target).toMatch(/secret/i);
  expect(second.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
  expect(JSON.stringify(second)).not.toContain('Visible');
});

test('revocation redacts hidden references inside otherwise visible backlink context and headings', async () => {
  const { vault, graph, denied, canAccess } = await fixture();
  await writeFile(join(vault, 'Root.md'), '# [[Secret]]\n[[Secret]] and [[Visible]]');
  await graph.getBacklinks('Visible.md', 10, canAccess);
  denied.add('Secret.md');
  const result = await graph.getBacklinks('Visible.md', 10, canAccess);
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toMatch(/secret/i);
});

test('unchanged permission sets retain stable query results across interleaved identities', async () => {
  const { graph, denied, canAccess } = await fixture();
  const publicOnly = (path: string) => path !== 'Secret.md';
  const first = await graph.getBacklinks('Visible.md', 10, canAccess, 0, undefined, true, true);
  const restricted = await graph.getBacklinks('Visible.md', 10, publicOnly, 0, undefined, true, true);
  const again = await graph.getBacklinks('Visible.md', 10, canAccess, 0, undefined, true, true);
  expect(first.total).toBe(2); expect(restricted.total).toBe(1);
  expect(again).toEqual(first);
  denied.add('Unused.md'); // No current graph membership change.
  expect(await graph.getBacklinks('Visible.md', 10, canAccess, 0, undefined, true, true)).toEqual(first);
});
