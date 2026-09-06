import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { VaultIoCoordinator } from './vault-io.js';

const pinned = vi.hoisted(() => new Map<string, { size: number; mtimeMs: number; ctimeMs: number }>());
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, stat: async (...args: Parameters<typeof real.stat>) => {
    const result = await real.stat(...args), pin = pinned.get(String(args[0]));
    return pin ? new Proxy(result, { get: (target, key, receiver) => key in pin ? pin[key as keyof typeof pin] : Reflect.get(target, key, receiver) }) : result;
  } };
});
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  const { EventEmitter } = await import('node:events');
  return { ...real, watch: () => Object.assign(new EventEmitter(), { close() {}, unref() {} }) };
});
const fixtures: Array<{ vault: string; graph: VaultGraphIndex; catalog?: VaultFileCatalog }> = [];
afterEach(async () => {
  vi.restoreAllMocks(); pinned.clear();
  for (const { vault, graph, catalog } of fixtures.splice(0)) { graph.close(); catalog?.close(); await rm(vault, { recursive: true, force: true }); }
});
async function fixture(shared = false, source = '[[Former]] #old', watcher = true) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-content-reconcile-'));
  const filter = new PathFilter(), frontmatter = new FrontmatterHandler(), io = new VaultIoCoordinator();
  const catalog = shared ? new VaultFileCatalog(vault, filter) : undefined;
  const graph = new VaultGraphIndex(vault, filter, frontmatter, catalog, io);
  if (!watcher) {
    vi.spyOn(graph as any, 'startWatcher').mockImplementation(() => {});
    if (catalog) vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => {});
  }
  fixtures.push({ vault, graph, ...(catalog && { catalog }) });
  await writeFile(join(vault, 'Root.md'), source);
  await writeFile(join(vault, 'Former.md'), '# Former');
  await writeFile(join(vault, 'Target.md'), '# Target');
  const info = await stat(join(vault, 'Root.md'));
  pinned.set(join(vault, 'Root.md'), { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await graph.getOutlinks('Root.md', 10, () => true);
  const reads = vi.spyOn(io, 'readUtf8Bounded');
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph);
  return { vault, graph, fs, reads, frontmatter, advance: (ms = 16 * 60_000) => { now += ms; } };
}

test.each([{ shared: false, watcher: false }, { shared: false, watcher: true }, { shared: true, watcher: false }, { shared: true, watcher: true }])('content reconciliation finds a new incoming link despite identical metadata ($shared/$watcher)', async ({ shared, watcher }) => {
  const { vault, fs, graph, advance } = await fixture(shared, undefined, watcher);
  const before = await stat(join(vault, 'Root.md'));
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe('[[Target]] #new');
  const after = await stat(join(vault, 'Root.md'));
  expect([after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.size, before.mtimeMs, before.ctimeMs]);
  advance();
  const result = await fs.getBacklinks('Target.md', 10, () => true, 0, { includeSourceRevision: true });
  expect(result).toMatchObject({ total: 1, backlinks: [{ path: 'Root.md', sourceRevision: await fs.readNoteRevision('Root.md') }] });
  expect((await graph.getBacklinks('Former.md', 10, () => true)).total).toBe(0);
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
});

test('content reconciliation discovers hidden moderation when all stat metadata collides', async () => {
  const { vault, graph, advance } = await fixture(false, '---\nmoderation_status: active\n---\n[[Target]] #tag');
  expect((await graph.getBacklinks('Target.md', 10, () => true)).total).toBe(1);
  await writeFile(join(vault, 'Root.md'), '---\nmoderation_status: hidden\n---\n[[Target]] #tag');
  advance();
  expect((await graph.getBacklinks('Target.md', 10, () => true)).total).toBe(0);
  expect(await graph.listAllTags(() => true)).toEqual([]);
});

test('ordinary reads reuse parsed graph state before the next content audit', async () => {
  const { graph, reads } = await fixture();
  for (let i = 0; i < 3; i++) await graph.listAllTags(() => true);
  expect(reads).not.toHaveBeenCalled();
});

test('an unchanged content audit hashes bounded sources without reparsing Markdown', async () => {
  const { graph, reads, frontmatter, advance } = await fixture();
  const parses = vi.spyOn(frontmatter, 'parse');
  advance();
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'old', count: 1 }]);
  expect(reads.mock.calls.length).toBeGreaterThan(0);
  for (const [, cap] of reads.mock.calls) expect(cap).toBe(8 * 1024 * 1024);
  expect(parses).not.toHaveBeenCalled();
});

test('failed content validation does not certify stale success or postpone its retry', async () => {
  const { vault, graph, reads, advance } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  advance();
  reads.mockRejectedValueOnce(new Error('private-storage-detail'));
  await expect(graph.listAllTags(() => true)).rejects.toThrow(/^Vault read unavailable; retry after storage access is restored\.$/);
  // Retry at the same clock; failure must not reset the content-check deadline.
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
});

test('frequent stat reconciliation does not postpone the independent content deadline', async () => {
  const { vault, graph, reads, advance } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  for (let i = 0; i < 14; i++) {
    advance(60_001);
    expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'old', count: 1 }]);
  }
  expect(reads).not.toHaveBeenCalled();
  advance(60_001);
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
  expect(reads.mock.calls.filter(([path]) => path === join(vault, 'Root.md'))).toHaveLength(1);
  reads.mockClear();
  await graph.listAllTags(() => true);
  expect(reads).not.toHaveBeenCalled();
});

test('simultaneous audit readers share one content pass', async () => {
  const { graph, reads, advance } = await fixture();
  advance();
  const results = await Promise.all(Array.from({ length: 6 }, () => graph.listAllTags(() => true)));
  for (const result of results) expect(result).toEqual([{ tag: 'old', count: 1 }]);
  expect(reads).toHaveBeenCalledTimes(3);
});

test('an observed edit during an audit prevents publishing the captured stale body', async () => {
  const { vault, graph, reads, advance } = await fixture();
  const read = reads.getMockImplementation();
  const actual = new VaultIoCoordinator();
  let injected = false;
  reads.mockImplementation(async (path, cap, priority) => {
    const raw = read ? await read(path, cap, priority) : await actual.readUtf8Bounded(path, cap, priority);
    if (!injected && path === join(vault, 'Root.md')) {
      injected = true;
      await writeFile(path, '[[Target]] #new');
      graph.invalidate('Root.md');
    }
    return raw;
  });
  advance();
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
  expect(reads.mock.calls.filter(([path]) => path === join(vault, 'Root.md')).length).toBeGreaterThan(1);
});

test('oversized sources cannot bypass an audit via unchanged stat metadata', async () => {
  const { vault, graph, advance } = await fixture();
  await writeFile(join(vault, 'Root.md'), 'x'.repeat(8 * 1024 * 1024 + 1));
  advance();
  await expect(graph.listAllTags(() => true)).rejects.toThrow(/8 MiB/);
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
});

test('audit reads remain bounded in batches and do not parse unchanged bodies', async () => {
  const { vault, graph, reads, frontmatter, advance } = await fixture();
  for (let i = 0; i < 37; i++) await writeFile(join(vault, `Extra${i}.md`), '# Extra');
  graph.invalidate();
  await graph.listAllTags(() => true);
  const actual = new VaultIoCoordinator();
  let active = 0, peak = 0;
  reads.mockClear().mockImplementation(async (path, cap, priority) => {
    active++; peak = Math.max(peak, active);
    try { return await actual.readUtf8Bounded(path, cap, priority); } finally { active--; }
  });
  const parse = vi.spyOn(frontmatter, 'parse');
  advance();
  await graph.listAllTags(() => true);
  expect(reads).toHaveBeenCalledTimes(40);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(16);
  expect(active).toBe(0);
  expect(parse).not.toHaveBeenCalled();
});

test('content auditing refreshes warmed alias resolution and orphan membership', async () => {
  const { vault, graph, advance } = await fixture(false, '---\naliases: [Before]\n---\n# Root');
  await writeFile(join(vault, 'Referrer.md'), '[[Afters]]');
  graph.invalidate();
  expect((await graph.getBacklinks('Root.md', 10, () => true)).total).toBe(0);
  expect((await graph.findUnresolvedLinks(10, () => true)).unresolved.some(item => item.target === 'Afters')).toBe(true);
  await writeFile(join(vault, 'Root.md'), '---\naliases: [Afters]\n---\n# Root');
  advance();
  expect((await graph.getBacklinks('Root.md', 10, () => true)).backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Referrer.md' })]));
  expect((await graph.findUnresolvedLinks(10, () => true)).unresolved).toEqual([]);
  expect((await graph.findOrphanNotes(10, () => true)).orphans.some(item => item.path === 'Root.md')).toBe(false);
});

test('content auditing does not expand caller scope visibility', async () => {
  const { vault, graph, advance } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  advance();
  const restricted = (path: string) => path !== 'Root.md';
  expect((await graph.getBacklinks('Target.md', 10, restricted)).total).toBe(0);
  expect(await graph.listAllTags(restricted)).toEqual([]);
  expect((await graph.getBacklinks('Target.md', 10, () => true)).total).toBe(1);
});

test('frequent dirty refreshes cannot postpone content validation of a different source', async () => {
  const { vault, graph, reads, advance } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Target]] #new');
  for (let i = 0; i < 44; i++) {
    graph.invalidate('Target.md');
    advance(20_000);
    await graph.listAllTags(() => true);
  }
  expect(reads.mock.calls.some(([path]) => path === join(vault, 'Root.md'))).toBe(false);
  graph.invalidate('Target.md'); advance(20_000);
  expect(await graph.listAllTags(() => true)).toEqual([{ tag: 'new', count: 1 }]);
});
