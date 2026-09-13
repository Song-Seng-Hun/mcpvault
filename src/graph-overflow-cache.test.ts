import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

let vault: string;
let graph: VaultGraphIndex;
const all = () => true;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-overflow-cache-'));
  await writeFile(join(vault, 'Target.md'), '# Target');
  await writeFile(join(vault, 'Dense.md'), '[[Dense]]\n'.repeat(16385));
  await writeFile(join(vault, 'Source.md'), '---\nsupports: [Target]\n---\n# 출처 😀\n[[Target#조건|별칭]] [[Target#조건|별칭]]\n');
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
});
afterEach(async () => { graph.close(); vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('overflow reuses complete occurrences across repeated pages, without losing identity or revisions', async () => {
  // Observe actual fallback traversal; do not replace the resolver or results.
  const scan = vi.spyOn(graph as any, 'matchingBacklinks');
  const first = await graph.getBacklinks('Target.md', 10, all, 0, undefined, true);
  expect(first.total).toBe(3);
  expect(first.backlinks.filter(row => row.link === '[[Target#조건|별칭]]')).toHaveLength(2);
  expect(first.backlinks.every(row => /^[a-f0-9]{64}$/.test(row.sourceRevision!))).toBe(true);
  const page = await graph.getBacklinks('Target.md', 1, all, 1, undefined, true);
  expect(page.total).toBe(3);
  expect(page.backlinks).toEqual(first.backlinks.slice(1, 2));
  expect(scan).toHaveBeenCalledTimes(1);
});

test('hits recheck current source access before counts, not only when filling', async () => {
  let allowed = true;
  const sourceCheck = vi.fn(async () => allowed);
  expect((await graph.getBacklinks('Target.md', 10, all, 0, sourceCheck)).total).toBe(3);
  allowed = false;
  const result = await graph.getBacklinks('Target.md', 1, all, 0, sourceCheck);
  expect(result.total).toBe(0);
  expect(JSON.stringify(result)).not.toContain('Source.md');
  expect(sourceCheck).toHaveBeenCalledTimes(2);
});

test('same-predicate ACL changes replace the cache view without a content event', async () => {
  let allowed = true;
  const access = (path: string) => allowed || path !== 'Source.md';
  expect((await graph.getBacklinks('Target.md', 10, access)).total).toBe(3);
  allowed = false;
  expect((await graph.getBacklinks('Target.md', 10, access)).total).toBe(0);
  allowed = true;
  expect((await graph.getBacklinks('Target.md', 10, access)).total).toBe(3);
});

test('an inspection budget never commits its incomplete occurrence prefix', async () => {
  const limited = await graph.getBacklinks('Target.md', 1, all, 0, undefined, true, true, undefined, undefined, { remaining: 1 });
  expect(limited).toMatchObject({ total: 1, inspectionTruncated: true, truncated: true });
  const complete = await graph.getBacklinks('Target.md', 10, all);
  expect(complete.total).toBe(3);
  expect(complete.inspectionTruncated).toBeUndefined();
});

test('filtered/compact fills cache raw occurrences, not the first response projection', async () => {
  const relations = await graph.getBacklinks('Target.md', 10, all, 0, undefined, true, true, undefined, ['supports'], undefined, true);
  expect(relations.total).toBe(1);
  expect(relations.backlinks[0].context).toBe('');
  const complete = await graph.getBacklinks('Target.md', 10, all, 0, undefined, true);
  expect(complete.total).toBe(3);
  expect(complete.backlinks.some(row => row.context.includes('Target'))).toBe(true);
});

test('a cached read rejects revision invalidation during an awaited source check', async () => {
  await graph.getBacklinks('Target.md', 10, all);
  await expect(graph.getBacklinks('Target.md', 10, all, 0, async () => {
    graph.invalidate('Source.md'); return true;
  })).rejects.toThrow(/Graph changed/);
});

test('source revision changes, moderation and deletion invalidate retained occurrences', async () => {
  const before = await graph.getBacklinks('Target.md', 10, all, 0, undefined, true);
  await writeFile(join(vault, 'Source.md'), '# Changed\n[[Target#^fact]]');
  graph.invalidate('Source.md');
  const changed = await graph.getBacklinks('Target.md', 10, all, 0, undefined, true);
  expect(changed.total).toBe(1);
  expect(changed.backlinks[0].sourceRevision).not.toBe(before.backlinks[0].sourceRevision);
  expect(changed.backlinks[0].targetBlockId).toBe('fact');
  await writeFile(join(vault, 'Source.md'), '---\nmoderation_status: hidden\n---\n[[Target]]');
  graph.invalidate('Source.md');
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(0);
  await unlink(join(vault, 'Source.md'));
  graph.invalidate('Source.md', 'delete');
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(0);
});

test('permission revocation during a warm asynchronous read rejects the whole view', async () => {
  let allowed = true;
  const access = (path: string) => allowed || path !== 'Source.md';
  await graph.getBacklinks('Target.md', 10, access);
  await expect(graph.getBacklinks('Target.md', 10, access, 0, async () => { allowed = false; return true; }))
    .rejects.toThrow(/visibility changed/);
});

test('alias ambiguity and path reuse are re-resolved in a new generation', async () => {
  await writeFile(join(vault, 'Source.md'), '[[Shared]]');
  await writeFile(join(vault, 'Target.md'), '---\naliases: [Shared]\n---\n# Target');
  graph.invalidate();
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(1);
  await writeFile(join(vault, 'Other.md'), '---\naliases: [Shared]\n---\n# Other');
  graph.invalidate('Other.md');
  expect((await graph.getBacklinks('Other.md', 10, all)).total).toBe(1);
  await writeFile(join(vault, 'Target.md'), '# Reused without alias');
  graph.invalidate('Target.md');
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(0);
  expect((await graph.getBacklinks('Other.md', 10, all)).total).toBe(1);
});
