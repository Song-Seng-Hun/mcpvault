import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultMetadataIndex } from './vault-index.js';
import { SearchService } from './search.js';

// Real directory reads, with an exact after-readdir/before-cache-publication
// boundary for races that wrapper-level spies cannot reproduce.
const readHook = vi.hoisted(() => ({ afterRead: undefined as undefined | ((path: string) => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: async (...args: unknown[]) => {
      const result = await (actual.readdir as (...args: unknown[]) => Promise<unknown>)(...args);
      await readHook.afterRead?.(String(args[0]));
      return result;
    },
  };
});

const fixtures: Array<{ vault: string; catalog: VaultFileCatalog; graph: VaultGraphIndex }> = [];
afterEach(async () => {
  readHook.afterRead = undefined;
  vi.restoreAllMocks();
  for (const { vault, catalog, graph } of fixtures.splice(0)) {
    graph.close(); catalog.close();
    await rm(vault, { recursive: true, force: true });
  }
});

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-catalog-reconcile-'));
  await mkdir(join(vault, 'Wiki/Deep'), { recursive: true });
  await mkdir(join(vault, 'Hot'));
  await writeFile(join(vault, 'Root.md'), '# Root');
  await writeFile(join(vault, 'Wiki/Deep/Old.md'), '# Old');
  await writeFile(join(vault, 'Hot/Work.md'), '# Work');
  const filter = new PathFilter();
  const catalog = new VaultFileCatalog(vault, filter);
  const start = (catalog as any).startWatcher.bind(catalog);
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => {
    start();
    (catalog as any).watcher?.removeAllListeners('change');
  });
  const graph = new VaultGraphIndex(vault, filter, new FrontmatterHandler(), catalog);
  fixtures.push({ vault, catalog, graph });
  await graph.getBacklinks('Root.md', 10, () => true);
  expect((catalog as any).watcher).toBeDefined();
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return { vault, catalog, graph, advance: (ms = 60_001) => { now += ms; } };
}

test.each(['add', 'delete', 'rename'] as const)('periodic inventory reconciliation repairs a missed nested %s', async operation => {
  const { vault, catalog, advance } = await fixture();
  const rootBefore = await stat(vault);
  if (operation === 'add') await writeFile(join(vault, 'Wiki/Deep/New.md'), '[[Root]]');
  if (operation === 'delete') await rm(join(vault, 'Wiki/Deep/Old.md'));
  if (operation === 'rename') await rename(join(vault, 'Wiki/Deep/Old.md'), join(vault, 'Wiki/Deep/New.md'));
  const rootAfter = await stat(vault);
  expect(rootAfter.mtimeMs).toBe(rootBefore.mtimeMs);
  expect(rootAfter.size).toBe(rootBefore.size);
  advance();
  const paths = await catalog.listNotePaths();
  if (operation !== 'delete') expect(paths).toContain('Wiki/Deep/New.md');
  if (operation !== 'add') expect(paths).not.toContain('Wiki/Deep/Old.md');
});

test('reconciliation bypasses local directory-entry reuse when mtimes are restored', async () => {
  const { vault, catalog, advance } = await fixture();
  const directory = join(vault, 'Wiki/Deep');
  const before = await stat(directory);
  await rename(join(directory, 'Old.md'), join(directory, 'New.md'));
  await utimes(directory, before.atimeMs / 1000, before.mtimeMs / 1000);
  advance();
  const paths = await catalog.listAllPaths();
  expect(paths).toContain('Wiki/Deep/New.md');
  expect(paths).not.toContain('Wiki/Deep/Old.md');
});

test('graph discovery receives missed incoming notes from the catalog census', async () => {
  const { vault, graph, advance } = await fixture();
  await writeFile(join(vault, 'Wiki/Deep/New.md'), '[[Root]]');
  advance();
  expect(await graph.getBacklinks('Root.md', 10, () => true)).toMatchObject({
    total: 1, backlinks: [{ path: 'Wiki/Deep/New.md' }],
  });
});

test('frequent observed hot-folder refreshes cannot postpone the full census indefinitely', async () => {
  const { vault, catalog, advance } = await fixture();
  await writeFile(join(vault, 'Wiki/Deep/New.md'), '[[Root]]');
  for (let index = 0; index < 3; index++) {
    advance(20_001);
    await writeFile(join(vault, 'Hot/Work.md'), `# Work ${index}`);
    catalog.invalidate('Hot/Work.md');
    await catalog.listNotePaths();
  }
  expect(await catalog.listNotePaths()).toContain('Wiki/Deep/New.md');
});

test('an observed change during enumeration is reconciled before returning inventory', async () => {
  const { vault, catalog, advance } = await fixture();
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  let delivered = false;
  vi.spyOn(catalog as any, 'readDirectoryEntries').mockImplementation(async (...args: unknown[]) => {
    const entries = await read(...args);
    if (!delivered && args[0] === join(vault, 'Wiki/Deep')) {
      delivered = true;
      await writeFile(join(vault, 'Wiki/Deep/New.md'), '[[Root]]');
      catalog.invalidate('Wiki/Deep/New.md');
    }
    return entries;
  });
  // Make the first pass enumerate this branch in the old implementation too.
  catalog.invalidate('Wiki/Deep/Old.md');
  advance();
  expect(await catalog.listNotePaths()).toContain('Wiki/Deep/New.md');
});

test('clean repeated reads share the warm inventory without recursive enumeration', async () => {
  const { catalog } = await fixture();
  const read = vi.spyOn(catalog as any, 'readDirectoryEntries');
  const before = await catalog.notePathsSnapshot();
  const snapshots = await Promise.all(Array.from({ length: 10 }, () => catalog.notePathsSnapshot()));
  for (const snapshot of snapshots) expect(snapshot).toBe(before);
  expect(read).not.toHaveBeenCalled();
});

test('simultaneous overdue reads share one full scan and one committed snapshot', async () => {
  const { vault, catalog, advance } = await fixture();
  await writeFile(join(vault, 'Wiki/Deep/New.md'), '[[Root]]');
  advance();
  const refresh = vi.spyOn(catalog as any, 'refresh');
  const snapshots = await Promise.all(Array.from({ length: 20 }, () => catalog.notePathsSnapshot()));
  expect(refresh).toHaveBeenCalledTimes(1);
  for (const snapshot of snapshots) {
    expect(snapshot).toBe(snapshots[0]);
    expect(snapshot).toContain('Wiki/Deep/New.md');
  }
});

test('persistent received churn fails after bounded retries instead of claiming a stable census', async () => {
  const { vault, catalog, advance } = await fixture();
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  const reads = vi.spyOn(catalog as any, 'readDirectoryEntries').mockImplementation(async (...args: unknown[]) => {
    const entries = await read(...args);
    if (args[0] === vault) catalog.invalidate('Root.md');
    return entries;
  });
  advance();
  await expect(catalog.listNotePaths()).rejects.toThrow(/Catalog changed during refresh/);
  expect(reads.mock.calls.filter(([path]) => path === vault)).toHaveLength(3);
  reads.mockRestore();
  expect(await catalog.listNotePaths()).toContain('Root.md');
});

test('reconciliation filters restricted nested folders and includes ordinary attachments', async () => {
  const { vault, catalog, advance } = await fixture();
  await mkdir(join(vault, 'Wiki/Deep/.git'));
  await writeFile(join(vault, 'Wiki/Deep/.git/secret.md'), 'secret');
  await writeFile(join(vault, 'Wiki/Deep/picture.png'), 'fixture attachment');
  advance();
  const paths = await catalog.listAllPaths();
  expect(paths).toContain('Wiki/Deep/picture.png');
  expect(JSON.stringify(paths)).not.toContain('secret');
  expect(await catalog.listNotePaths()).not.toContain('Wiki/Deep/picture.png');
});

test('a failed directory batch drains sibling reads before allowing another refresh', async () => {
  const { vault, catalog, advance } = await fixture();
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reads = vi.spyOn(catalog as any, 'readDirectoryEntries').mockImplementation(async (...args: unknown[]) => {
    if (args[0] === join(vault, 'Hot')) {
      await entered;
      throw new Error('fixture enumeration failure');
    }
    if (args[0] === join(vault, 'Wiki')) {
      enter();
      await gate;
    }
    return read(...args);
  });
  advance();
  let settled = false;
  const result = catalog.listNotePaths().then(
    value => { settled = true; return value; },
    error => { settled = true; return error; },
  );
  await entered;
  try {
    // Let a possible fail-fast Promise.all rejection propagate while its
    // sibling remains blocked. No filesystem timing sleeps are involved.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally {
    release();
    expect(await result).toBeInstanceOf(Error);
    reads.mockRestore();
  }
  expect(await catalog.listNotePaths()).toContain('Wiki/Deep/Old.md');
});

test('shared metadata and lexical search discover and remove notes after missed events', async () => {
  const { vault, catalog, advance } = await fixture();
  const filter = new PathFilter();
  const metadata = new VaultMetadataIndex(vault, filter, new FrontmatterHandler(), catalog);
  const search = new SearchService(vault, filter, catalog);
  try {
    expect(await metadata.count({ status: 'pending' })).toBe(0);
    expect(await search.search({ query: 'catalogdiscoverytoken' })).toEqual([]);
    await writeFile(join(vault, 'Wiki/Deep/New.md'), '---\nstatus: pending\n---\ncatalogdiscoverytoken');
    advance();
    expect(await metadata.count({ status: 'pending' })).toBe(1);
    expect(await search.search({ query: 'catalogdiscoverytoken' })).toEqual([
      expect.objectContaining({ p: 'Wiki/Deep/New.md' }),
    ]);
    await rm(join(vault, 'Wiki/Deep/New.md'));
    advance();
    expect(await metadata.count({ status: 'pending' })).toBe(0);
    expect(await search.search({ query: 'catalogdiscoverytoken' })).toEqual([]);
  } finally {
    await search.close();
    await metadata.close();
  }
});

test('an exhausted within-interval scan retains forced recovery for the next request', async () => {
  const { vault, catalog } = await fixture();
  const directory = join(vault, 'Wiki/Deep');
  const fixed = new Date('2026-01-01T00:00:00Z');
  await utimes(directory, fixed, fixed);
  catalog.invalidate('Wiki/Deep/Old.md');
  await catalog.listNotePaths();
  let current = 'Old.md';
  let mutations = 0;
  readHook.afterRead = async path => {
    if (path !== directory) return;
    const next = `New${++mutations}.md`;
    await rename(join(directory, current), join(directory, next));
    await utimes(directory, fixed, fixed);
    catalog.invalidate(`Wiki/Deep/${next}`);
    current = next;
  };
  catalog.invalidate('Wiki/Deep/Old.md');
  await expect(catalog.listNotePaths()).rejects.toThrow(/Catalog changed during refresh/);
  expect(mutations).toBe(3);
  readHook.afterRead = undefined;
  const recovered = await catalog.listNotePaths();
  expect(recovered).toContain('Wiki/Deep/New3.md');
  expect(recovered).not.toContain('Wiki/Deep/New2.md');
});

test('incremental updates within the interval retain untouched subtree reuse', async () => {
  const { vault, catalog } = await fixture();
  const read = vi.spyOn(catalog as any, 'readDirectoryEntries');
  await writeFile(join(vault, 'Hot/New.md'), '# New work');
  catalog.invalidate('Hot/New.md');
  const paths = await catalog.listNotePaths();
  expect(paths).toContain('Hot/New.md');
  expect(paths).toContain('Wiki/Deep/Old.md');
  expect(read.mock.calls.map(([path]) => path)).toEqual([vault, join(vault, 'Hot')]);
});

test('an incremental read failure retains forced recovery from abandoned sibling caches', async () => {
  const { vault, catalog } = await fixture();
  const directory = join(vault, 'Wiki/Deep');
  const fixed = new Date('2026-01-01T00:00:00Z');
  await utimes(directory, fixed, fixed);
  catalog.invalidate('Wiki/Deep/Old.md');
  await catalog.listNotePaths();
  let mutated!: () => void;
  const mutation = new Promise<void>(resolve => { mutated = resolve; });
  readHook.afterRead = async path => {
    if (path === directory) {
      await rename(join(directory, 'Old.md'), join(directory, 'New.md'));
      await utimes(directory, fixed, fixed);
      catalog.invalidate('Wiki/Deep/New.md');
      mutated();
    } else if (path === join(vault, 'Hot')) {
      await mutation;
      throw new Error('fixture sibling failure');
    }
  };
  catalog.invalidate('Wiki/Deep/Old.md');
  catalog.invalidate('Hot/Work.md');
  await expect(catalog.listNotePaths()).rejects.toThrow(/Vault read unavailable/);
  readHook.afterRead = undefined;
  const recovered = await catalog.listNotePaths();
  expect(recovered).toContain('Wiki/Deep/New.md');
  expect(recovered).not.toContain('Wiki/Deep/Old.md');
});
