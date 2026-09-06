import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultFileCatalog } from './vault-catalog.js';
import { PathFilter } from './pathfilter.js';

const hooks = vi.hoisted(() => ({
  read: undefined as undefined | ((path: string) => Promise<void>),
  stat: undefined as undefined | ((path: string) => Promise<void>),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: async (...args: any[]) => { const value = await (actual.readdir as any)(...args); await hooks.read?.(String(args[0])); return value; },
    stat: async (...args: any[]) => { const value = await (actual.stat as any)(...args); await hooks.stat?.(String(args[0])); return value; },
  };
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
let root: string, catalog: VaultFileCatalog;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-catalog-close-'));
  await writeFile(join(root, 'Note.md'), '# Note');
  catalog = new VaultFileCatalog(root, new PathFilter());
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
});
afterEach(async () => {
  hooks.read = hooks.stat = undefined;
  catalog.close(); vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-catalog-close-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

test('closed public inventory and stat reads reject without new filesystem work', async () => {
  let reads = 0, stats = 0;
  hooks.read = async () => { reads++; }; hooks.stat = async () => { stats++; };
  catalog.close();
  for (const read of [() => catalog.listNotePaths(), () => catalog.listAllPaths(), () => catalog.notePathsSnapshot(), () => catalog.allPathsSnapshot(), () => catalog.statPaths(['Note.md'])]) {
    await expect(read()).rejects.toThrow(/catalog.*closed/i);
  }
  expect({ reads, stats }).toEqual({ reads: 0, stats: 0 });
});

test.each(['listNotePaths', 'listAllPaths', 'notePathsSnapshot', 'allPathsSnapshot'] as const)('%s rejects closure between inventory completion and public return', async method => {
  const read = (catalog as any).listInventory.bind(catalog);
  vi.spyOn(catalog as any, 'listInventory').mockImplementation(async () => {
    const result = await read();
    catalog.close();
    return result;
  });
  await expect(catalog[method]()).rejects.toThrow(/catalog.*closed/i);
});

test.each([false, true])('late directory results cannot revive a closed catalog (watcher=%s)', async watched => {
  if (watched) (catalog as any).watcher = { close: vi.fn() };
  const entered = deferred(), release = deferred();
  hooks.read = async path => { if (path === root) { entered.resolve(); await release.promise; } };
  const result = catalog.listNotePaths().then(value => ({ value, error: undefined as any }), error => ({ value: undefined, error }));
  await entered.promise;
  let retained = false;
  try { catalog.close(); retained = !!(catalog as any).refreshPromise; }
  finally { release.resolve(); }
  const outcome = await result;
  expect(outcome.error).toBeInstanceOf(Error);
  expect(outcome.error?.message).toMatch(/catalog.*closed/i);
  expect(outcome.value).toBeUndefined();
  expect(retained).toBe(true);
  expect((catalog as any).refreshPromise).toBeUndefined();
  expect((catalog as any).directoryCache.size).toBe(0);
  expect((catalog as any).paths).toBeUndefined();
  expect((catalog as any).allPaths).toBeUndefined();
});

test('late file stats cannot refill a closed stat cache', async () => {
  const entered = deferred(), release = deferred();
  hooks.stat = async path => { if (path === join(root, 'Note.md')) { entered.resolve(); await release.promise; } };
  const result = catalog.statPaths(['Note.md']).then(value => ({ value, error: undefined as any }), error => ({ value: undefined, error }));
  await entered.promise;
  try { catalog.close(); } finally { release.resolve(); }
  const outcome = await result;
  expect(outcome.error).toBeInstanceOf(Error);
  expect(outcome.error?.message).toMatch(/catalog.*closed/i);
  expect((catalog as any).statCache.size).toBe(0);
  expect((catalog as any).statInFlight.size).toBe(0);
});

test('late subscriptions, notifications and invalidations retain nothing after close', () => {
  catalog.close();
  const generation = (catalog as any).changeGeneration;
  const unsubscribe = catalog.subscribe(() => undefined), unsubscribeBatch = catalog.subscribeBatch(() => undefined);
  catalog.invalidate('Note.md'); catalog.invalidate();
  (catalog as any).onFilesystemEvent('Note.md'); (catalog as any).onFilesystemEvent(undefined);
  const retained = {
    listeners: (catalog as any).listeners.size,
    batches: (catalog as any).batchListeners.size,
    pending: (catalog as any).pendingChanges.size,
    full: (catalog as any).pendingFullRefresh,
  };
  unsubscribe(); unsubscribeBatch();
  catalog.close();
  expect(retained).toEqual({ listeners: 0, batches: 0, pending: 0, full: false });
  expect((catalog as any).changeGeneration).toBe(generation);
  expect((catalog as any).listeners.size).toBe(0);
  expect((catalog as any).batchListeners.size).toBe(0);
  expect((catalog as any).pendingChanges.size).toBe(0);
  expect((catalog as any).dirtyDirectories.size).toBe(0);
  expect((catalog as any).pendingFullRefresh).toBe(false);
  expect((catalog as any).pendingTimer).toBeUndefined();
  expect((catalog as any).startWatcher).not.toHaveBeenCalled();
});

test('an already-running failed event barrier cannot requeue refresh after close', async () => {
  const entered = deferred(), release = deferred();
  vi.spyOn(catalog as any, 'flushPendingChanges').mockImplementation(async () => {
    entered.resolve(); await release.promise; throw new Error('fixture flush failure');
  });
  (catalog as any).onFilesystemEvent('Note.md');
  const result = catalog.flushPendingEvents().catch(error => error);
  await entered.promise;
  try { catalog.close(); } finally { release.resolve(); }
  expect((await result).message).toBe('fixture flush failure');
  expect((catalog as any).pendingFullRefresh).toBe(false);
  expect((catalog as any).pendingChanges.size).toBe(0);
  expect((catalog as any).readBarrier).toBeUndefined();
});

test.each(['batch', 'legacy'] as const)('%s subscriber closure prevents stat work for the next notification batch', async kind => {
  for (let i = 0; i < 40; i++) await writeFile(join(root, `Queued${i}.md`), '# Note');
  let stats = 0, delivered = 0;
  hooks.stat = async () => { stats++; };
  const close = () => { delivered++; catalog.close(); };
  if (kind === 'batch') catalog.subscribeBatch(close);
  else catalog.subscribe(close);
  for (let i = 0; i < 40; i++) (catalog as any).onFilesystemEvent(`Queued${i}.md`);
  await catalog.flushPendingEvents();
  expect(delivered).toBe(1);
  expect(stats).toBe(32);
  expect((catalog as any).pendingChanges.size).toBe(0);
});
