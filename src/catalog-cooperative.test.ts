import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as flush } from 'node:timers/promises';
import { PathFilter } from './pathfilter.js';
import { VaultFileCatalog } from './vault-catalog.js';

let root: string, catalog: VaultFileCatalog, filter: PathFilter;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-cooperative-'));
  for (let i = 0; i < 600; i++) await writeFile(join(root, `Note${String(i).padStart(3, '0')}.md`), '# Note');
  filter = new PathFilter(); catalog = new VaultFileCatalog(root, filter);
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
});
afterEach(async () => {
  await flush(); // Drain the deterministic immediate before removing its fixture.
  catalog.close(); vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-cooperative-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

test('a pending immediate runs after a bounded prefix rather than the entire directory', async () => {
  const allowed = filter.isAllowedForListing.bind(filter);
  let checks = 0, observed = 0;
  vi.spyOn(filter, 'isAllowedForListing').mockImplementation(path => {
    if (++checks === 1) setImmediate(() => { observed = checks; });
    return allowed(path);
  });
  const paths = await catalog.listNotePaths(); await flush();
  expect(observed).toBe(256);
  expect(checks).toBe(600);
  expect(paths).toHaveLength(600);
  expect(paths[0]).toBe('Note000.md'); expect(paths[599]).toBe('Note599.md');
});

test('closure during a cooperative checkpoint prevents remaining filtering and publication', async () => {
  const allowed = filter.isAllowedForListing.bind(filter);
  let checks = 0;
  vi.spyOn(filter, 'isAllowedForListing').mockImplementation(path => {
    if (++checks === 1) setImmediate(() => catalog.close());
    return allowed(path);
  });
  await expect(catalog.listNotePaths().then(() => undefined)).rejects.toThrow(/catalog.*closed/i);
  expect(checks).toBe(256);
  expect((catalog as any).paths).toBeUndefined();
  expect((catalog as any).directoryCache.size).toBe(0);
});

test('a delivered mutation during yielded filtering cannot publish the old inventory', async () => {
  const allowed = filter.isAllowedForListing.bind(filter);
  let scheduled = false;
  vi.spyOn(filter, 'isAllowedForListing').mockImplementation(path => {
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => {
        // One tiny synchronous fixture write establishes an exact mutation
        // boundary; the production reader and reconciliation remain real.
        writeFileSync(join(root, 'Late.md'), '# Added during filtering');
        catalog.invalidate('Late.md');
      });
    }
    return allowed(path);
  });
  const paths = await catalog.listNotePaths(); await flush();
  expect(paths).toHaveLength(601);
  expect(paths).toContain('Late.md');
  expect((catalog as any).needsRefresh).toBe(false);
});

test('merging a cached subtree yields and rejects closure without mutating the cached arrays', async () => {
  const child = join(root, 'Child'); await mkdir(child);
  for (let i = 0; i < 600; i++) await writeFile(join(child, `Note${String(i).padStart(3, '0')}.md`), '# Child');
  (catalog as any).watcher = { close: () => undefined };
  expect(await catalog.listNotePaths()).toHaveLength(1200);
  const cache = (catalog as any).directoryCache as Map<string, any>;
  const cached = cache.get(child);
  const notes = Object.freeze(cached.notes), all = Object.freeze(cached.all);
  const get = cache.get.bind(cache); let scheduled = false;
  vi.spyOn(cache, 'get').mockImplementation(path => {
    const value = get(path);
    if (path === child && !scheduled) { scheduled = true; setImmediate(() => catalog.close()); }
    return value;
  });
  catalog.invalidate('Note000.md'); // Refresh the parent, reuse the clean child.
  await expect(catalog.listNotePaths().then(() => undefined)).rejects.toThrow(/catalog.*closed/i);
  expect(scheduled).toBe(true);
  expect(notes).toHaveLength(600); expect(all).toHaveLength(600);
  expect((catalog as any).paths).toBeUndefined();
  expect(cache.size).toBe(0);
});
