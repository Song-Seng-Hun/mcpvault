import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

const fixtures: Array<{ vault: string; graph: VaultGraphIndex; catalog?: VaultFileCatalog }> = [];
const stamp = new Date('2026-01-01T00:00:00Z');
const visible = () => true;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { vault, graph, catalog } of fixtures.splice(0)) {
    graph.close();
    catalog?.close();
    await rm(vault, { recursive: true, force: true });
  }
});

async function fixture(sharedCatalog = false, source = '[[Former]] #old', activeWatcher = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-graph-reconcile-'));
  const filter = new PathFilter();
  const catalog = sharedCatalog ? new VaultFileCatalog(vault, filter) : undefined;
  // Simulate either no watcher or a live watcher losing change events. Keep
  // actual timed reconciliation and watched directory-cache behavior intact.
  const suppressEvents = (index: VaultGraphIndex | VaultFileCatalog) => {
    const start = (index as any).startWatcher.bind(index);
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => {
      if (activeWatcher) {
        start();
        (index as any).watcher?.removeAllListeners('change');
      }
    });
  };
  if (catalog) suppressEvents(catalog);
  const io = new VaultIoCoordinator();
  const graph = new VaultGraphIndex(vault, filter, new FrontmatterHandler(), catalog, io);
  suppressEvents(graph);
  fixtures.push({ vault, graph, catalog });
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph);
  await writeFile(join(vault, 'Root.md'), source);
  await utimes(join(vault, 'Root.md'), stamp, stamp);
  await writeFile(join(vault, 'Former.md'), '# Former');
  await writeFile(join(vault, 'Target.md'), '# Target');
  await graph.getOutlinks('Root.md', 10, visible);
  if (activeWatcher) expect(((catalog || graph) as any).watcher).toBeDefined();
  const read = io.readUtf8Bounded.bind(io);
  const reads = vi.spyOn(io, 'readUtf8Bounded');
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return { vault, graph, fs, reads, read, advance: () => { now += activeWatcher ? 60_001 : 5_001; } };
}

async function rewritePreservingMtime(vault: string, content: string) {
  const path = join(vault, 'Root.md');
  const before = await stat(path);
  let after = before;
  // Same-tick rewrites can retain ctime on Windows. This fixture specifically
  // exercises a changed-ctime reconciliation, so establish that precondition
  // with bounded real I/O retries (Date.now is mocked by the graph fixture).
  for (let attempt = 0; attempt < 25; attempt++) {
    if (attempt) await new Promise<void>(resolve => setTimeout(resolve, 10));
    await writeFile(path, content);
    await utimes(path, stamp, stamp);
    after = await stat(path);
    if (after.ctimeMs !== before.ctimeMs) break;
  }
  expect(after.size).toBe(before.size);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.ctimeMs).not.toBe(before.ctimeMs);
}

const modes = [
  { shared: false, activeWatcher: false }, { shared: true, activeWatcher: false },
  { shared: false, activeWatcher: true }, { shared: true, activeWatcher: true },
];

test.each(modes)('timed reconciliation discovers an unobserved new incoming edge ($shared/$activeWatcher)', async ({ shared, activeWatcher }) => {
  const { vault, graph, fs, reads, advance } = await fixture(shared, undefined, activeWatcher);
  expect((await fs.getBacklinks('Target.md')).total).toBe(0);
  await rewritePreservingMtime(vault, '[[Target]] #new');
  advance();
  // Query the unchanged target, not the author: source-query guards cannot
  // discover an incoming edge absent from the cached graph.
  const result = await fs.getBacklinks('Target.md', 10, visible, 0, { includeSourceRevision: true });
  expect(result).toMatchObject({ total: 1, backlinks: [{ path: 'Root.md' }] });
  expect(result.backlinks[0]!.sourceRevision).toBe(await fs.readNoteRevision('Root.md'));
  expect((await graph.getBacklinks('Former.md', 10, visible)).total).toBe(0);
  expect(reads.mock.calls.map(([path]) => path)).toEqual([join(vault, 'Root.md')]);
});

test('timed reconciliation refreshes tags and orphan membership after a same-stat edit', async () => {
  const { vault, graph, advance } = await fixture();
  await rewritePreservingMtime(vault, '[[Target]] #new');
  advance();
  expect(await graph.listAllTags(visible)).toEqual([{ tag: 'new', count: 1 }]);
  const orphans = (await graph.findOrphanNotes(10, visible)).orphans.map(row => row.path);
  expect(orphans).toContain('Former.md');
  expect(orphans).not.toContain('Target.md');
});

test('timed reconciliation refreshes hidden moderation without a watcher event', async () => {
  const { vault, graph, advance } = await fixture(false, '---\nmoderation_status: active\n---\n[[Target]]');
  expect((await graph.getBacklinks('Target.md', 10, visible)).total).toBe(1);
  await rewritePreservingMtime(vault, '---\nmoderation_status: hidden\n---\n[[Target]]');
  advance();
  expect((await graph.getBacklinks('Target.md', 10, visible)).total).toBe(0);
});

test.each(modes)('unchanged timed reconciliations retain parsed bodies ($shared/$activeWatcher)', async ({ shared, activeWatcher }) => {
  const { graph, reads, advance } = await fixture(shared, undefined, activeWatcher);
  for (let index = 0; index < 3; index++) {
    advance();
    expect((await graph.getBacklinks('Former.md', 10, visible)).total).toBe(1);
  }
  expect(reads).not.toHaveBeenCalled();
});

test('timed reconciliation updates alias resolution for an unchanged referring note', async () => {
  const { vault, graph, advance } = await fixture(false, '---\naliases: [Before]\n---\n# Root');
  await writeFile(join(vault, 'Referrer.md'), '[[Afters]]');
  graph.invalidate('Referrer.md');
  expect((await graph.getBacklinks('Root.md', 10, visible)).total).toBe(0);
  await rewritePreservingMtime(vault, '---\naliases: [Afters]\n---\n# Root');
  advance();
  expect(await graph.getBacklinks('Root.md', 10, visible)).toMatchObject({
    total: 1, backlinks: [{ path: 'Referrer.md' }],
  });
});

test('a failed changed-body read does not publish stale success and remains retryable', async () => {
  const { vault, graph, reads, advance } = await fixture();
  await rewritePreservingMtime(vault, '[[Target]] #new');
  advance();
  reads.mockRejectedValueOnce(new Error('fixture read unavailable'));
  await expect(graph.getBacklinks('Target.md', 10, visible)).rejects.toThrow();
  expect((await graph.getBacklinks('Target.md', 10, visible)).total).toBe(1);
});

test('an observed edit during the changed-body read cannot be erased by reconciliation', async () => {
  const { vault, graph, reads, read, advance } = await fixture();
  await rewritePreservingMtime(vault, '[[Target]] #new');
  advance();
  reads.mockImplementationOnce(async (path, maxBytes, priority) => {
    const body = await read(path, maxBytes, priority);
    await writeFile(join(vault, 'Root.md'), '[[Former]] #end');
    await utimes(join(vault, 'Root.md'), stamp, stamp);
    graph.invalidate('Root.md');
    return body;
  });
  expect((await graph.getBacklinks('Target.md', 10, visible)).total).toBe(0);
  expect((await graph.getBacklinks('Former.md', 10, visible)).total).toBe(1);
  expect(await graph.listAllTags(visible)).toEqual([{ tag: 'end', count: 1 }]);
});

test('newly discovered edges remain filtered by the caller scope', async () => {
  const { vault, fs, advance } = await fixture(true);
  await rewritePreservingMtime(vault, '[[Target]] #new');
  advance();
  const result = await fs.getBacklinks('Target.md', 10, path => path !== 'Root.md');
  expect(result.total).toBe(0);
  expect(JSON.stringify(result)).not.toContain('Root');
  expect((await fs.getBacklinks('Target.md')).total).toBe(1);
});
