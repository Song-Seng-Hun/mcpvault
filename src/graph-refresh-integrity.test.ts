import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { readBoundedSource } from './bounded-source-read.js';
import { VaultFileCatalog } from './vault-catalog.js';

// Deliver filesystem notifications at exact read boundaries, without sleeps.
const watchState = vi.hoisted(() => ({ changed: undefined as undefined | ((event: string, name?: string) => void) }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  watch: (_path: string, _options: unknown, changed: typeof watchState.changed) => {
    watchState.changed = changed;
    return { on: () => undefined, close: () => undefined, unref: () => undefined };
  },
}));
let vault: string;
let graph: VaultGraphIndex;
const all = () => true;
let afterRead: ((path: string, raw: string) => Promise<void>) | undefined;
let unboundedReads: number;
let boundedReads: number;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-graph-refresh-'));
  await writeFile(join(vault, 'Base.md'), '#old');
  unboundedReads = 0; boundedReads = 0; afterRead = undefined;
  const io = new VaultIoCoordinator({
    reader: async path => { unboundedReads++; const raw = await readFile(path, 'utf8'); await afterRead?.(path, raw); return raw; },
    boundedReader: async (path, limit) => { boundedReads++; const raw = await readBoundedSource(path, limit); await afterRead?.(path, raw); return raw; },
  });
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler(), undefined, io);
});
afterEach(async () => { graph.close(); watchState.changed = undefined; await rm(vault, { recursive: true, force: true }); });

test('standalone watcher adds new note membership to graph navigation, not just tags', async () => {
  await graph.listAllTags(all);
  await writeFile(join(vault, 'New.md'), '#new [[Base]]');
  watchState.changed!('rename', 'New.md');
  expect((await graph.getBacklinks('Base.md', 10, all)).backlinks.map(item => item.path)).toEqual(['New.md']);
  await rm(join(vault, 'New.md'));
  watchState.changed!('rename', 'New.md');
  expect((await graph.getBacklinks('Base.md', 10, all)).total).toBe(0);
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'old', count: 1 }]);
});

test('unknown invalidation received during a full read is not overwritten by completion', async () => {
  afterRead = async () => {
    afterRead = undefined;
    await writeFile(join(vault, 'Base.md'), '#new');
    graph.invalidate();
  };
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'new', count: 1 }]);
});

test('a newer change during dirty refresh is applied before returning a known-obsolete view', async () => {
  await graph.listAllTags(all);
  await writeFile(join(vault, 'Base.md'), '#first');
  graph.invalidate('Base.md');
  afterRead = async () => {
    afterRead = undefined;
    await writeFile(join(vault, 'Base.md'), '#final');
    graph.invalidate('Base.md');
  };
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'final', count: 1 }]);
});

test('an explicit full reset rereads even equal-size and restored-mtime content', async () => {
  const fixed = new Date('2026-01-01T00:00:00Z');
  await utimes(join(vault, 'Base.md'), fixed, fixed);
  const before = await stat(join(vault, 'Base.md'));
  await graph.listAllTags(all);
  await writeFile(join(vault, 'Base.md'), '#new');
  await utimes(join(vault, 'Base.md'), before.atime, before.mtime);
  graph.invalidate();
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'new', count: 1 }]);
});

test('continuous observed churn returns a bounded retry error and can recover later', async () => {
  afterRead = async () => { graph.invalidate(); };
  await expect(graph.listAllTags(all)).rejects.toThrow(/Graph changed during refresh.*retry/i);
  expect(unboundedReads + boundedReads).toBeLessThanOrEqual(3);
  afterRead = undefined;
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'old', count: 1 }]);
});

test('oversized source never becomes partial successful graph data and recovers after repair', async () => {
  await writeFile(join(vault, 'Base.md'), '#secret\n' + 'x'.repeat(8 * 1024 * 1024));
  await expect(graph.listAllTags(all)).rejects.toThrow(/Graph source exceeds/);
  expect(unboundedReads).toBe(0);
  await writeFile(join(vault, 'Base.md'), '#repaired');
  graph.invalidate('Base.md');
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'repaired', count: 1 }]);
  expect(boundedReads).toBeGreaterThan(0);
});

test('dirty refresh schedules bounded batches instead of one promise per changed file', async () => {
  for (let i = 0; i < 40; i++) await writeFile(join(vault, `Note${i}.md`), '#tag');
  await graph.listAllTags(all);
  for (let i = 0; i < 40; i++) graph.invalidate(`Note${i}.md`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const beginning = new Promise<void>(resolve => { started = resolve; });
  const original = (graph as any).readEntry.bind(graph);
  let scheduled = 0;
  const spy = vi.spyOn(graph as any, 'readEntry').mockImplementation(async (...args: unknown[]) => {
    scheduled++; started(); await gate; return original(...args);
  });
  const reading = graph.listAllTags(all);
  await beginning;
  const initialScheduled = scheduled;
  release();
  try {
    expect(await reading).toContainEqual({ tag: 'tag', count: 40 });
    expect(initialScheduled).toBeLessThanOrEqual(16);
  } finally { spy.mockRestore(); }
});

test('shared catalog notifications received during reads are drained before publishing the response', async () => {
  graph.close();
  const filter = new PathFilter();
  const catalog = new VaultFileCatalog(vault, filter);
  let changed = false;
  const read = async (path: string) => {
    const raw = await readFile(path, 'utf8');
    if (!changed) {
      changed = true;
      await writeFile(join(vault, 'Base.md'), '#catalog_new');
      watchState.changed!('rename');
    }
    return raw;
  };
  graph = new VaultGraphIndex(vault, filter, new FrontmatterHandler(), catalog,
    new VaultIoCoordinator({ reader: read, boundedReader: read }));
  try {
    expect(await graph.listAllTags(all)).toEqual([{ tag: 'catalog_new', count: 1 }]);
  } finally { catalog.close(); }
});

test('failed dirty reads retain the repair obligation and redact driver/path details', async () => {
  await graph.listAllTags(all);
  await writeFile(join(vault, 'Base.md'), '#repaired');
  graph.invalidate('Base.md');
  afterRead = async () => { throw new Error('private-driver/Base.md'); };
  await expect(graph.listAllTags(all)).rejects.toThrow('Vault read unavailable; retry after storage access is restored.');
  afterRead = undefined;
  expect(await graph.listAllTags(all)).toEqual([{ tag: 'repaired', count: 1 }]);
});
