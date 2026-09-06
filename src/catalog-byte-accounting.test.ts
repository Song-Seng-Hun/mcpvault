import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultFileCatalog } from './vault-catalog.js';
import { PathFilter } from './pathfilter.js';
import { derivedCacheBudget } from './cache-budget.js';
import * as stringBytes from './json-string-bytes.js';

let root: string, catalog: VaultFileCatalog;
const files = ['Alpha.md', '한글.md', 'Emoji🧠.md', 'Child/Child.md', 'Child/image.png'];
const stringify = JSON.stringify.bind(JSON);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-accounting-'));
  await mkdir(join(root, 'Child'));
  for (const path of files) await writeFile(join(root, path), '# Fixture');
  catalog = new VaultFileCatalog(root, new PathFilter());
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
  (catalog as any).watcher = { close: () => undefined };
});
afterEach(async () => {
  catalog.close(); derivedCacheBudget.remove('accounting-test', 'pressure');
  vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-accounting-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

test('catalog registration never serializes a whole directory payload', async () => {
  let serializations = 0;
  vi.spyOn(JSON, 'stringify').mockImplementation(((value: any, ...args: any[]) => {
    if (value && Array.isArray(value.entries) && typeof value.mtimeMs === 'number') serializations++;
    return (stringify as any)(value, ...args);
  }) as typeof JSON.stringify);
  const first = await catalog.listAllPaths();
  expect(first).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  expect(await catalog.listAllPaths()).toEqual(first);
  catalog.invalidate('Alpha.md');
  expect(await catalog.listAllPaths()).toEqual(first);
  expect(serializations).toBe(0);
});

test('registered counters cover the old serialized charge for every nested cache', async () => {
  const register = vi.spyOn(derivedCacheBudget, 'register');
  await catalog.listNotePaths();
  const owner = (catalog as any).cacheOwner;
  for (const [path, cached] of (catalog as any).directoryCache as Map<string, any>) {
    expect(typeof cached.entryBytes).toBe('number');
    expect(typeof cached.noteBytes).toBe('number'); expect(typeof cached.allBytes).toBe('number');
    const legacy = { mtimeMs: cached.mtimeMs, size: cached.size, entries: cached.entries, notes: cached.notes, all: cached.all };
    const minimum = Buffer.byteLength(stringify(legacy), 'utf8') + 64;
    const charges = register.mock.calls.filter(call => call[0] === owner && call[1] === path);
    expect(charges.length).toBeGreaterThan(0);
    const charge = charges.at(-1)![2];
    expect(charge).toBe(256 + cached.entryBytes + cached.noteBytes + cached.allBytes);
    expect(charge).toBeGreaterThanOrEqual(minimum);
  }
});

test('real budget pressure evicts caches without changing paths and close clears accounting', async () => {
  const before = derivedCacheBudget.snapshot();
  const expected = await catalog.listAllPaths();
  expect((catalog as any).directoryCache.size).toBeGreaterThan(0);
  derivedCacheBudget.register('accounting-test', 'pressure', before.maxBytes, () => undefined);
  expect((catalog as any).directoryCache.size).toBe(0);
  catalog.invalidate('Alpha.md');
  expect(await catalog.listAllPaths()).toEqual(expected);
  expect(derivedCacheBudget.snapshot().totalBytes).toBeLessThanOrEqual(before.maxBytes);
  catalog.close(); derivedCacheBudget.remove('accounting-test', 'pressure');
  expect(derivedCacheBudget.snapshot()).toEqual(before);
});

test('a warm child reuses its byte totals without recounting its names or paths', async () => {
  const count = vi.spyOn(stringBytes, 'jsonStringBytes');
  await catalog.listAllPaths();
  expect(count).toHaveBeenCalledWith('Child.md');
  expect(count).toHaveBeenCalledWith('Child/Child.md');
  const child = (catalog as any).directoryCache.get(join(root, 'Child'));
  const notes = child.notes, all = child.all;
  const oldBytes = { noteBytes: child.noteBytes, allBytes: child.allBytes };
  count.mockClear(); catalog.invalidate('Alpha.md');
  const paths = await catalog.listAllPaths();
  expect(paths).toHaveLength(files.length);
  expect(count).toHaveBeenCalledWith('Alpha.md');
  expect(count).not.toHaveBeenCalledWith('Child.md');
  expect(count).not.toHaveBeenCalledWith('Child/Child.md');
  const current = (catalog as any).directoryCache.get(join(root, 'Child'));
  expect(current.notes).toBe(notes); expect(current.all).toBe(all);
  expect({ noteBytes: current.noteBytes, allBytes: current.allBytes }).toEqual(oldBytes);
});

test('deletion updates array membership and matching byte totals together', async () => {
  await catalog.listAllPaths();
  const cache = (catalog as any).directoryCache as Map<string, any>;
  const oldBytes = cache.get(root).noteBytes;
  await unlink(join(root, 'Child', 'Child.md')); catalog.invalidate('Child/Child.md');
  const paths = await catalog.listAllPaths();
  expect(paths).not.toContain('Child/Child.md'); expect(paths).toHaveLength(files.length - 1);
  expect(cache.get(root).noteBytes).toBeLessThan(oldBytes);
  for (const cached of cache.values()) {
    const bytes = (values: string[]) => values.reduce((sum, value) => sum + Buffer.byteLength(stringify(value), 'utf8') + 1, 0);
    expect(cached.noteBytes).toBe(bytes(cached.notes)); expect(cached.allBytes).toBe(bytes(cached.all));
  }
});

test('empty cached children retain valid zero counters across a parent refresh', async () => {
  const empty = join(root, 'Empty'); await mkdir(empty);
  const first = await catalog.listAllPaths();
  const cache = (catalog as any).directoryCache as Map<string, any>;
  const child = cache.get(empty);
  expect({ entry: child.entryBytes, notes: child.noteBytes, all: child.allBytes }).toEqual({ entry: 0, notes: 0, all: 0 });
  const entries = child.entries;
  catalog.invalidate('Alpha.md');
  expect(await catalog.listAllPaths()).toEqual(first);
  expect(cache.get(empty).entries).toBe(entries);
  expect(cache.get(empty).noteBytes).toBe(0); expect(cache.get(empty).allBytes).toBe(0);
});
