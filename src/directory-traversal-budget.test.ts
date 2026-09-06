import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as flush } from 'node:timers/promises';
import { VaultFileCatalog } from './vault-catalog.js';
import { SemanticSearchService } from './semantic-search.js';
import { PathFilter } from './pathfilter.js';

const filesystem = vi.hoisted(() => ({ read: undefined as undefined | ((path: string) => Promise<unknown[]>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: async (...args: any[]) => filesystem.read
    ? filesystem.read(String(args[0])) : (actual.readdir as any)(...args) };
});

const yes = () => true, no = () => false;
const directory = (name: string) => ({ name, isDirectory: yes, isFile: no });
const file = (name: string) => ({ name, isDirectory: no, isFile: yes });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
let root: string;
let catalog: VaultFileCatalog;
let semantic: SemanticSearchService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-traversal-'));
  catalog = new VaultFileCatalog(root, new PathFilter());
  // Virtual directories exercise the real walker without starting OS watches.
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
  semantic = new SemanticSearchService(root, new PathFilter());
  await (semantic as any).manifestReady;
  await (semantic as any).pendingReady;
});
afterEach(async () => {
  filesystem.read = undefined;
  catalog.close(); await semantic.close();
  vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-traversal-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});

async function inventory(kind: 'catalog' | 'semantic'): Promise<string[]> {
  return kind === 'catalog' ? catalog.listNotePaths() : (semantic as any).findMarkdownFiles(root);
}

test.each([
  ['catalog', 1], ['catalog', 3], ['catalog', 8],
  ['semantic', 1], ['semantic', 3], ['semantic', 8],
] as const)('%s bounds unfinished directory reads over the entire %i-by-8 tree', async (kind, width) => {
  let active = 0, peak = 0;
  filesystem.read = async path => {
    active++; peak = Math.max(peak, active);
    try {
      await flush();
      const depth = relative(root, path).split(/[\\/]/).filter(Boolean).length;
      return depth < 2 ? Array.from({ length: depth === 0 ? width : 8 }, (_, i) => directory(`Dir${i}`)) : [file('Note.md')];
    } finally { active--; }
  };
  const paths = (await inventory(kind)).map(path => path.replace(/\\/g, '/')).sort();
  expect(paths).toEqual(Array.from({ length: width }, (_, a) => Array.from({ length: 8 }, (_, b) => `Dir${a}/Dir${b}/Note.md`)).flat());
  expect(active).toBe(0);
  expect(peak).toBe(8); // Single-child and uneven splits retain the total budget.
});

test.each(['catalog', 'semantic'] as const)('%s merges a large child inventory without spreading function arguments', async kind => {
  filesystem.read = async path => path === root ? [directory('Large')]
    : Array.from({ length: 150_000 }, (_, i) => file(`Note${i}.md`));
  const paths = await inventory(kind);
  expect(paths).toHaveLength(150_000);
  expect(paths.some(path => path.replace(/\\/g, '/') === 'Large/Note149999.md')).toBe(true);
  expect(new Set(paths).size).toBe(paths.length);
}, 20_000); // Includes real filtering/sorting of 150k paths, not a 5s latency SLA.

test('semantic discovery waits for an active sibling before rejecting and releasing scan ownership', async () => {
  const entered = deferred(), release = deferred();
  filesystem.read = async path => {
    if (path === root) return [directory('Failed'), directory('Held')];
    if (basename(path) === 'Failed') {
      await entered.promise;
      throw Object.assign(new Error('private storage detail'), { code: 'EACCES' });
    }
    entered.resolve(); await release.promise; return [];
  };
  (semantic as any).manifest = { 'Old.md': { hash: 'old', scope: 'global' } };
  let settled = false;
  const scan = (semantic as any).scanForChanges().then(
    () => { settled = true; return undefined; },
    (error: unknown) => { settled = true; return error; },
  );
  await entered.promise;
  try {
    await flush();
    expect(settled).toBe(false);
    expect((semantic as any).scanPromise).toBeDefined();
  } finally { release.resolve(); await scan; }
  const error = await scan;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/unavailable.*retry/i);
  expect(error.message).not.toContain('private storage detail');
  expect((semantic as any).scanPromise).toBeUndefined();
  expect((semantic as any).pending.size).toBe(0);
  expect((semantic as any).lastScanAt).toBe(0);
  filesystem.read = async () => [];
  await (semantic as any).scanForChanges();
  expect((semantic as any).pending.get('Old.md')).toEqual({ kind: 'delete' });
});
