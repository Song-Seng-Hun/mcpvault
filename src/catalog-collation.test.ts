import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultFileCatalog } from './vault-catalog.js';
import { PathFilter } from './pathfilter.js';

let root: string, catalog: VaultFileCatalog;
const names = ['Alpha.md', 'zebra.md', '한글.md', '文書.md', '🧠.md', 'é-1.md', 'e\u0301-2.md', 'note10.md', 'note2.md'];
const expected = [...names].sort((a, b) => a.localeCompare(b));
function observeCollator() {
  const NativeCollator = Intl.Collator;
  // Constructor spies must explicitly return the real Intl instance; otherwise
  // the spy's constructed object can lack the native compare getter.
  return vi.spyOn(Intl, 'Collator').mockImplementation(function (locales, options) {
    return new NativeCollator(locales, options);
  });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-collation-'));
  catalog = new VaultFileCatalog(root, new PathFilter());
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
});
afterEach(async () => {
  catalog.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-collation-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

test.each([false, true])('one default collator serves both inventories without per-comparison string dispatch (watcher=%s)', async watched => {
  for (const name of names) await writeFile(join(root, name), '# Note');
  if (watched) (catalog as any).watcher = { close: () => undefined };
  const construct = observeCollator();
  const compare = vi.spyOn(String.prototype, 'localeCompare');
  const paths = await catalog.listAllPaths();
  const dispatches = compare.mock.calls.length;
  compare.mockRestore();
  expect(paths).toEqual(expected); expect(dispatches).toBe(0);
  expect(construct).toHaveBeenCalledExactlyOnceWith();
  expect(await catalog.listNotePaths()).toEqual(expected);
  expect(construct).toHaveBeenCalledTimes(1);
  catalog.invalidate('Alpha.md');
  expect(await catalog.listAllPaths()).toEqual(expected);
  expect(construct).toHaveBeenCalledTimes(2);
});

test.each([0, 1])('an inventory of %i paths needs no collator', async count => {
  if (count) await writeFile(join(root, 'One.md'), '# One');
  const construct = observeCollator();
  expect(await catalog.listAllPaths()).toEqual(count ? ['One.md'] : []);
  expect(construct).not.toHaveBeenCalled();
});

test.each(['Intl', 'Collator'])('missing %s keeps the old localeCompare fallback', async missing => {
  for (const name of names) await writeFile(join(root, name), '# Note');
  const replacement = missing === 'Intl' ? undefined
    : Object.defineProperty(Object.create(Intl), 'Collator', { value: undefined });
  vi.stubGlobal('Intl', replacement);
  const compare = vi.spyOn(String.prototype, 'localeCompare');
  let paths: string[], dispatches: number;
  try { paths = await catalog.listAllPaths(); dispatches = compare.mock.calls.length; }
  finally { compare.mockRestore(); vi.unstubAllGlobals(); }
  expect(paths).toEqual(expected); expect(dispatches).toBeGreaterThan(0);
});

test('unmodified native Intl sorts real Unicode paths exactly as localeCompare', async () => {
  for (const name of names) await writeFile(join(root, name), '# Note');
  expect(await catalog.listAllPaths()).toEqual(expected);
  expect(await catalog.listNotePaths()).toEqual(expected);
});

test.each([0, 1])('multiple attachments do not sort the trivial %i-note sibling array', async count => {
  for (const name of ['b.png', 'a.png', ...(count ? ['One.md'] : [])]) await writeFile(join(root, name), '# Fixture');
  const find = (catalog as any).findPaths.bind(catalog);
  let noteSort: ReturnType<typeof vi.spyOn> | undefined, allSort: ReturnType<typeof vi.spyOn> | undefined;
  vi.spyOn(catalog as any, 'findPaths').mockImplementation(async (...args: any[]) => {
    const inventory = await find(...args);
    noteSort = vi.spyOn(inventory.notes, 'sort'); allSort = vi.spyOn(inventory.all, 'sort');
    return inventory;
  });
  const construct = observeCollator();
  const paths = await catalog.listAllPaths();
  expect(paths).toHaveLength(2 + count);
  expect(noteSort).toHaveBeenCalledTimes(0); expect(allSort).toHaveBeenCalledTimes(1);
  expect(construct).toHaveBeenCalledExactlyOnceWith();
});
