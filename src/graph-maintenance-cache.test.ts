import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

let vault: string;
let graph: VaultGraphIndex;
const all = () => true;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-maintenance-cache-'));
  await writeFile(join(vault, 'Source.md'), '[[Target]] [[Missing#조건|설명]] [[Missing]] [[Secret]]\n');
  await writeFile(join(vault, 'Target.md'), '# Target\n');
  await writeFile(join(vault, 'Orphan.md'), '# Orphan\n');
  await writeFile(join(vault, 'Secret.md'), '---\nmoderation_status: hidden\n---\n# Secret\n');
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  await graph.getOutlinks('Source.md', 10, all);
});
afterEach(async () => { graph.close(); await rm(vault, { recursive: true, force: true }); });

function traversals() {
  let count = 0;
  const links = (graph as any).entries.get('Source.md').links as unknown[];
  const iterate = links[Symbol.iterator].bind(links);
  links[Symbol.iterator] = function () { count++; return iterate(); };
  return () => count;
}

test('unresolved pages reuse a complete scan, preserving occurrences and fingerprints', async () => {
  const scans = traversals();
  const complete = await graph.findUnresolvedLinks(10, all, 0, true);
  expect(complete.total).toBe(2);
  const page = await graph.findUnresolvedLinks(1, all, 1, true);
  expect(page.unresolved).toEqual(complete.unresolved.slice(1));
  expect(page.snapshotFingerprint).toBe(complete.snapshotFingerprint);
  // Two fresh source-projection checks plus one resolution scan.
  expect(scans()).toBe(3);
  expect(JSON.stringify(page)).not.toContain('Secret');
});

test('orphan cache reapplies a mutable candidate filter before count and fingerprint', async () => {
  const scans = traversals();
  let keep = 'Orphan.md';
  const candidate = (path: string) => path === keep;
  const first = await graph.findOrphanNotes(10, all, 0, true, candidate);
  keep = 'Source.md';
  const second = await graph.findOrphanNotes(10, all, 0, true, candidate);
  expect(first.orphans.map(x => x.path)).toEqual(['Orphan.md']);
  expect(second.orphans.map(x => x.path)).toEqual(['Source.md']);
  expect(second.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
  expect(scans()).toBe(1);
});

test('same-closure visibility revocation invalidates maintenance caches without an event', async () => {
  let allow = true;
  const access = (path: string) => allow || path !== 'Source.md';
  expect((await graph.findUnresolvedLinks(10, access)).total).toBe(2);
  expect((await graph.findOrphanNotes(10, access)).orphans.map(x => x.path)).not.toContain('Target.md');
  allow = false;
  const unresolved = await graph.findUnresolvedLinks(10, access);
  expect(unresolved.total).toBe(0);
  expect(JSON.stringify(unresolved)).not.toContain('Source');
  expect((await graph.findOrphanNotes(10, access)).orphans.map(x => x.path)).toContain('Target.md');
});

test('new alias resolution invalidates a cached broken link and incoming topology', async () => {
  const before = await graph.findUnresolvedLinks(10, all, 0, true);
  await graph.findOrphanNotes(10, all);
  await writeFile(join(vault, 'Orphan.md'), '---\naliases: [Missing]\n---\n# Resolved\n');
  graph.invalidate('Orphan.md');
  const after = await graph.findUnresolvedLinks(10, all, 0, true);
  expect(after.total).toBe(0);
  expect(after.snapshotFingerprint).not.toBe(before.snapshotFingerprint);
  expect((await graph.findOrphanNotes(10, all)).orphans.map(x => x.path)).not.toContain('Orphan.md');
});

test('candidate callbacks cannot return a mixed authorization view from a warm cache', async () => {
  let allowed = true;
  const access = (path: string) => allowed || path !== 'Orphan.md';
  await graph.findOrphanNotes(10, access);
  await expect(graph.findOrphanNotes(10, access, 0, true, () => { allowed = false; return true; })).rejects.toThrow(/changed/i);
});

test('oversized unresolved scans return every occurrence and never retain a prefix', async () => {
  await writeFile(join(vault, 'Source.md'), '[[Missing]]\n'.repeat(4100));
  graph.invalidate('Source.md');
  await graph.getOutlinks('Source.md', 1, all);
  const scans = traversals();
  const first = await graph.findUnresolvedLinks(2, all, 4098, true);
  const second = await graph.findUnresolvedLinks(1, all, 4099, true);
  expect(first.total).toBe(4100);
  expect(second.unresolved).toEqual(first.unresolved.slice(1));
  expect(second.snapshotFingerprint).toBe(first.snapshotFingerprint);
  expect(scans()).toBe(4); // Both full scans and both source projections.
});
