import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Dirent } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as flush } from 'node:timers/promises';
import { VaultFileCatalog } from './vault-catalog.js';
import { PathFilter } from './pathfilter.js';

const hooks = vi.hoisted(() => ({ read: undefined as undefined | ((path: string, entries: Dirent[]) => void) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: async (...args: any[]) => {
    const entries = await (actual.readdir as any)(...args);
    hooks.read?.(String(args[0]), entries);
    return entries;
  } };
});

let root: string, catalog: VaultFileCatalog;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-normalization-'));
  for (let i = 0; i < 600; i++) await writeFile(join(root, `Note${String(i).padStart(3, '0')}.md`), '# Note');
  catalog = new VaultFileCatalog(root, new PathFilter());
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
});
afterEach(async () => {
  await flush(); hooks.read = undefined;
  catalog.close(); vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-normalization-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

function observeNormalization(action: () => void) {
  const state = { calls: 0, observed: 0, reads: 0 };
  hooks.read = (path, entries) => {
    if (path !== root || ++state.reads !== 1) return;
    // Keep real Dirents and their predicates; instrumentation observes the
    // production conversion boundary, not a replacement normalizer/walker.
    for (const entry of entries) {
      const isDirectory = entry.isDirectory.bind(entry);
      vi.spyOn(entry, 'isDirectory').mockImplementation(() => {
        if (++state.calls === 1) setImmediate(() => { state.observed = state.calls; action(); });
        return isDirectory();
      });
    }
  };
  return state;
}

test.each([false, true])('Dirent conversion yields after 256 entries (watcher=%s)', async watched => {
  if (watched) (catalog as any).watcher = { close: () => undefined };
  const state = observeNormalization(() => undefined);
  const paths = await catalog.listNotePaths(); await flush();
  expect(state.observed).toBe(256); expect(state.calls).toBe(600);
  expect(paths).toHaveLength(600);
  expect(paths[0]).toBe('Note000.md'); expect(paths[599]).toBe('Note599.md');
});

test.each([false, true])('closing during Dirent conversion stops conversion and cache publication (watcher=%s)', async watched => {
  if (watched) (catalog as any).watcher = { close: () => undefined };
  const state = observeNormalization(() => catalog.close());
  await expect(catalog.listNotePaths().then(() => undefined)).rejects.toThrow(/catalog.*closed/i);
  expect(state.calls).toBe(256);
  expect((catalog as any).directoryCache.size).toBe(0);
  expect((catalog as any).paths).toBeUndefined();
});

test.each([false, true])('an obsolete census skips sorting and retries current membership (watcher=%s)', async watched => {
  if (watched) (catalog as any).watcher = { close: () => undefined };
  const NativeCollator = Intl.Collator;
  const collator = vi.spyOn(Intl, 'Collator').mockImplementation(function (locales, options) {
    return new NativeCollator(locales, options);
  });
  const state = observeNormalization(() => {
    writeFileSync(join(root, 'Late.md'), '# New membership');
    catalog.invalidate('Late.md');
  });
  const sorting: Array<{ notes: ReturnType<typeof vi.spyOn>; all: ReturnType<typeof vi.spyOn> }> = [];
  const find = (catalog as any).findPaths.bind(catalog);
  vi.spyOn(catalog as any, 'findPaths').mockImplementation(async (...args: any[]) => {
    const inventory = await find(...args);
    if (args[0] === root) sorting.push({ notes: vi.spyOn(inventory.notes, 'sort'), all: vi.spyOn(inventory.all, 'sort') });
    return inventory;
  });
  const paths = await catalog.listNotePaths(); await flush();
  expect(paths).toHaveLength(601); expect(paths).toContain('Late.md');
  expect(state.reads).toBe(2); expect(sorting).toHaveLength(2);
  expect(sorting.map(item => [item.notes.mock.calls.length, item.all.mock.calls.length])).toEqual([[0, 0], [1, 1]]);
  expect(collator).toHaveBeenCalledExactlyOnceWith(); // Only the stable retry.
  expect((catalog as any).needsRefresh).toBe(false);
});

test('normalization invalidation keeps the dirty marker and cannot publish obsolete entries', async () => {
  (catalog as any).watcher = { close: () => undefined };
  observeNormalization(() => {
    writeFileSync(join(root, 'Late.md'), '# New membership');
    catalog.invalidate('Late.md');
  });
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  const snapshots: Array<{ dirty: boolean; cached: boolean }> = [];
  vi.spyOn(catalog as any, 'readDirectoryEntries').mockImplementation(async (...args: any[]) => {
    const entries = await read(...args);
    snapshots.push({ dirty: (catalog as any).dirtyDirectories.has(root), cached: (catalog as any).directoryCache.has(root) });
    return entries;
  });
  const paths = await catalog.listNotePaths(); await flush();
  expect(paths).toHaveLength(601);
  expect(snapshots[0]).toEqual({ dirty: true, cached: false });
  expect(snapshots[1]).toEqual({ dirty: false, cached: true });
});

test.each([[false, 0], [false, 1], [true, 0], [true, 1]] as const)('closure after tiny conversion cannot publish entries (watcher=%s, files=%i)', async (watched, count) => {
  if (watched) (catalog as any).watcher = { close: () => undefined };
  const child = join(root, 'Tiny'); await mkdir(child);
  if (count) await writeFile(join(child, 'One.md'), '# One');
  const normalize = (catalog as any).normalizeDirectoryEntries.bind(catalog);
  // Use a real small directory inventory: the extra await is a microtask
  // boundary even when no 256-item yield is necessary.
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  vi.spyOn(catalog as any, 'normalizeDirectoryEntries').mockImplementation(async (listed: Dirent[]) => {
    const result = await normalize(listed);
    catalog.close();
    return result;
  });
  await expect(read(child).then(() => undefined)).rejects.toThrow(/catalog.*closed/i);
  expect((catalog as any).directoryCache.size).toBe(0);
  expect((catalog as any).paths).toBeUndefined();
});

test('warm-cache invalidation during normalization coalesces a reentrant public reader', async () => {
  (catalog as any).watcher = { close: () => undefined };
  expect(await catalog.listNotePaths()).toHaveLength(600);
  const cache = (catalog as any).directoryCache as Map<string, any>;
  const cached = cache.get(root), originalEntries = Object.freeze(cached.entries);
  let reentrant: Promise<{ paths?: string[]; error?: unknown }> | undefined;
  const state = observeNormalization(() => {
    writeFileSync(join(root, 'Late.md'), '# New membership');
    catalog.invalidate('Late.md');
    reentrant = catalog.listNotePaths().then(paths => ({ paths }), error => ({ error }));
  });
  const read = (catalog as any).readDirectoryEntries.bind(catalog);
  const snapshots: Array<{ dirty: boolean; sameEntries: boolean }> = [];
  vi.spyOn(catalog as any, 'readDirectoryEntries').mockImplementation(async (...args: any[]) => {
    const entries = await read(...args);
    snapshots.push({ dirty: (catalog as any).dirtyDirectories.has(root), sameEntries: cache.get(root)?.entries === originalEntries });
    return entries;
  });
  catalog.invalidate('Note000.md');
  const paths = await catalog.listNotePaths();
  const other = await reentrant;
  expect(other).toBeDefined(); expect(other?.error).toBeUndefined();
  expect(other?.paths).toEqual(paths); expect(paths).toHaveLength(601);
  expect(paths).toContain('Late.md'); expect(state.reads).toBe(2);
  expect(snapshots[0]).toEqual({ dirty: true, sameEntries: true });
  expect(snapshots[1]).toEqual({ dirty: false, sameEntries: false });
  expect(originalEntries).toHaveLength(600);
});
