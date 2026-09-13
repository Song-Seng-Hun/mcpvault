import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const events = vi.hoisted(() => ({ callback: undefined as undefined | ((event: string, file?: string) => void), emitter: undefined as any }));
const pinned = vi.hoisted(() => new Map<string, { size: number; mtimeMs: number; ctimeMs: number }>());
const statFault = vi.hoisted(() => ({ path: undefined as string | undefined, beforeThrow: undefined as (() => void) | undefined }));
vi.mock('node:fs/promises', async load => {
  const real = await load<typeof import('node:fs/promises')>();
  return { ...real, stat: async (...args: Parameters<typeof real.stat>) => {
    if (statFault.path === String(args[0])) { statFault.path = undefined; statFault.beforeThrow?.(); throw Object.assign(Error('fixture stat failure'), { code: 'EACCES' }); }
    const result = await real.stat(...args), pin = pinned.get(String(args[0]));
    return pin ? new Proxy(result, { get: (target, key, receiver) => key in pin ? pin[key as keyof typeof pin] : Reflect.get(target, key, receiver) }) : result;
  } };
});
vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>(), watch: (_root: string, _options: unknown, callback: typeof events.callback) => {
  events.callback = callback; events.emitter = Object.assign(new EventEmitter(), { close() {}, unref() {} }); return events.emitter;
} }));
let base: string, vault: string, graph: VaultGraphIndex, catalog: VaultFileCatalog;
afterEach(async () => {
  graph?.close(); catalog?.close(); vi.restoreAllMocks(); pinned.clear();
  statFault.path = undefined; statFault.beforeThrow = undefined;
  if (vault) {
    const actual = await fs.realpath(vault), rel = relative(base, actual);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('graph-catalog-events-')) throw Error('Unsafe fixture cleanup');
    await fs.rm(actual, { recursive: true, force: true });
  }
});
async function fixture() {
  base = await fs.realpath(tmpdir()); vault = await fs.mkdtemp(join(base, 'graph-catalog-events-')); await fs.mkdir(join(vault, 'Notes'));
  for (let i = 0; i < 32; i++) await fs.writeFile(join(vault, 'Notes', `N${i}.md`), i === 1 ? '[[Alias]]' : '# Note');
  const filter = new PathFilter(), io = new VaultIoCoordinator(); catalog = new VaultFileCatalog(vault, filter);
  graph = new VaultGraphIndex(vault, filter, new FrontmatterHandler(), catalog, io);
  await graph.getBacklinks('Notes/N0.md', 10, () => true);
  return vi.spyOn(io, 'readUtf8Bounded');
}
test('shared known-directory changes retain deletion and aliases with only changed body reads', async () => {
  const reads = await fixture(); await fs.unlink(join(vault, 'Notes/N2.md')); events.callback!('rename', 'Notes/N2.md');
  events.callback!('change', 'Notes');
  await fs.writeFile(join(vault, 'Notes/N0.md'), '---\naliases: [Alias]\n---\n# Note'); events.callback!('change', 'Notes/N0.md');
  const result = await graph.getBacklinks('Notes/N0.md', 10, () => true);
  expect(result.total).toBe(1); expect(result.backlinks[0]!.path).toBe('Notes/N1.md');
  expect(reads.mock.calls.map(([p]) => p)).toEqual([join(vault, 'Notes/N0.md')]);
});
test.each([false, true])('coalesced explicit changes bypass stat collisions (folder first=%s)', async folderFirst => {
  const reads = await fixture(), path = join(vault, 'Notes/N1.md'), info = await fs.stat(path);
  pinned.set(path, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  if (folderFirst) events.callback!('change', 'Notes');
  await fs.writeFile(path, '[[Notes/N0.md]]'); events.callback!('change', 'Notes/N1.md');
  if (!folderFirst) events.callback!('change', 'Notes');
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
  expect(reads.mock.calls.map(([p]) => p)).toEqual([path]);
});
test.each([false, true])('unknown events dominate metadata hints in either order (unknown first=%s)', async unknownFirst => {
  const reads = await fixture();
  events.callback!('change', unknownFirst ? undefined : 'Notes'); events.callback!('change', unknownFirst ? 'Notes' : undefined);
  await graph.getBacklinks('Notes/N0.md', 10, () => true); expect(reads.mock.calls.length).toBe(32);
});
test.each(['rename', 'error'])('shared %s keeps forced content reads even after a known folder event', async type => {
  const reads = await fixture(); events.callback!('change', 'Notes');
  if (type === 'error') events.emitter.emit('error', Error('watcher fault')); else events.callback!('rename', 'Notes');
  events.callback!('change', 'Notes');
  await graph.getBacklinks('Notes/N0.md', 10, () => true); expect(reads.mock.calls.length).toBe(32);
});
test('shared metadata reuse does not postpone full content audits or relax current ACL', async () => {
  const reads = await fixture(); let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  for (let i = 0; i < 14; i++) { now += 60000; events.callback!('change', 'Notes'); await graph.getBacklinks('Notes/N0.md', 10, () => true); }
  expect(reads.mock.calls.length).toBe(0);
  now += 120000; events.callback!('change', 'Notes'); await graph.getBacklinks('Notes/N0.md', 10, () => true);
  expect(reads.mock.calls.length).toBe(32);
  await fs.writeFile(join(vault, 'Notes/N0.md'), '---\naliases: [Alias]\n---\n# Note'); events.callback!('change', 'Notes/N0.md');
  let allowed = true; const canRead = (p: string) => allowed || p !== 'Notes/N1.md';
  expect((await graph.getBacklinks('Notes/N0.md', 10, canRead)).total).toBe(1);
  allowed = false; events.callback!('change', 'Notes');
  const result = await graph.getBacklinks('Notes/N0.md', 10, canRead);
  expect(result.total).toBe(0); expect(JSON.stringify(result)).not.toContain('Notes/N1.md');
});
test('other catalog subscribers retain full-change semantics and immutable metadata context', async () => {
  await fixture(); const single = vi.fn(), batch = vi.fn(); catalog.subscribe(single); catalog.subscribeBatch(batch);
  events.callback!('change', 'Notes/N1.md'); events.callback!('change', 'Notes'); await catalog.flushPendingEvents();
  expect(single.mock.calls).toEqual([[undefined, undefined]]);
  expect(batch.mock.calls).toHaveLength(1); expect(batch.mock.calls[0]![0]).toBeUndefined();
  const context = batch.mock.calls[0]![1];
  expect(context).toEqual({ kind: 'directory_metadata', dirtyPaths: ['Notes/N1.md'] });
  expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.dirtyPaths)).toBe(true);
});
test('shared directory census discovers a new incoming note without a per-file event', async () => {
  const reads = await fixture(); await fs.writeFile(join(vault, 'Notes/New.md'), '[[Notes/N0.md]]'); events.callback!('change', 'Notes');
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
  expect(reads.mock.calls.map(([p]) => p)).toEqual([join(vault, 'Notes/New.md')]);
});
test('coalesced moderation edits remain hidden even when every stat field collides', async () => {
  await fixture(); const path = join(vault, 'Notes/N1.md');
  await fs.writeFile(path, '[[Notes/N0.md]]'); events.callback!('change', 'Notes/N1.md');
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
  const info = await fs.stat(path); pinned.set(path, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  await fs.writeFile(path, '---\nmoderation_status: hidden\n---\n[[Notes/N0.md]]');
  events.callback!('change', 'Notes/N1.md'); events.callback!('change', 'Notes');
  const result = await graph.getBacklinks('Notes/N0.md', 10, () => true);
  expect(result.total).toBe(0); expect(JSON.stringify(result)).not.toContain('Notes/N1.md');
});
test('failed explicit reads keep their obligation across a later directory-only hint', async () => {
  const reads = await fixture(), path = join(vault, 'Notes/N1.md'), info = await fs.stat(path);
  pinned.set(path, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  await fs.writeFile(path, '[[Notes/N0.md]]'); events.callback!('change', 'Notes/N1.md'); events.callback!('change', 'Notes');
  reads.mockRejectedValueOnce(Error('fixture read unavailable'));
  await expect(graph.getBacklinks('Notes/N0.md', 10, () => true)).rejects.toThrow();
  events.callback!('change', 'Notes');
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
  expect(reads.mock.calls.map(([p]) => p)).toEqual([path, path]);
});
test.each([false, true])('a catalog delivery failure cannot downgrade a concurrent directory hint to stat-only reuse (timer=%s)', async timer => {
  await fixture(); const path = join(vault, 'Notes/N1.md'), info = await fs.stat(path);
  pinned.set(path, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  await fs.writeFile(path, '[[Notes/N0.md]]'); events.callback!('change', 'Notes/N1.md');
  statFault.path = path; statFault.beforeThrow = () => events.callback!('change', 'Notes');
  if (timer) await vi.waitFor(() => expect(statFault.path).toBeUndefined(), { interval: 10 });
  else await expect(graph.getBacklinks('Notes/N0.md', 10, () => true)).rejects.toThrow();
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
});
