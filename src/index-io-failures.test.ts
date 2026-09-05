import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultGraphIndex } from './vault-graph.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const faults = vi.hoisted(() => ({
  stat: new Map<string, string>(), readFile: new Map<string, string>(), readdir: new Map<string, string>(),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const wrap = (name: keyof typeof faults, operation: keyof typeof real = name) => async (...args: any[]) => {
    const code = faults[name].get(String(args[0]));
    if (code) throw Object.assign(new Error(`private-path=${args[0]} secret-driver-detail`), { code });
    return (real[operation] as any)(...args);
  };
  // The same source-read fault covers whole-file and bounded-handle readers.
  return { ...real, stat: wrap('stat'), readFile: wrap('readFile'), open: wrap('readFile', 'open'), readdir: wrap('readdir') };
});
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  const { EventEmitter } = await import('node:events');
  return { ...real, watch: () => Object.assign(new EventEmitter(), { close() {}, unref() {} }) };
});

let vault: string;
let catalog: VaultFileCatalog;
const closers: Array<() => unknown> = [];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-io-fault-'));
  await mkdir(join(vault, 'Area'));
  await writeFile(join(vault, 'Root.md'), '# Root');
  await writeFile(join(vault, 'Area/Note.md'), '---\nstatus: original\n---\n[[Root]] originalphrase');
  catalog = new VaultFileCatalog(vault, new PathFilter());
  await catalog.listNotePaths();
});
afterEach(async () => {
  for (const map of Object.values(faults)) map.clear();
  for (const close of closers.splice(0)) await close();
  catalog.close();
  vi.useRealTimers();
  await rm(vault, { recursive: true, force: true });
});
function event(path = 'Area/Note.md') { (catalog as any).onFilesystemEvent(path); }
async function rejectsSafely(read: Promise<unknown>) {
  const result = await read.then(value => ({ value }), error => ({ error }));
  expect(result).toHaveProperty('error');
  const error = (result as any).error;
  expect(error.message).toMatch(/unavailable.*retry/i);
  expect(error.message).not.toContain(vault);
  expect(error.message).not.toContain('secret-driver-detail');
  expect(error.message.length).toBeLessThan(256);
}

test.each(['EACCES', 'EIO'])('a %s event stat is not broadcast as deletion and stays retryable', async code => {
  const batches: any[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  faults.stat.set(join(vault, 'Area/Note.md'), code);
  event();
  await rejectsSafely(catalog.flushPendingEvents());
  await rejectsSafely(catalog.flushPendingEvents());
  expect(batches.flat().filter(Boolean).some(change => change.kind === 'delete')).toBe(false);
  faults.stat.clear();
  await catalog.flushPendingEvents();
  expect(batches.flat()).toContainEqual({ path: 'Area/Note.md', kind: 'upsert' });
});

test('shared stat failures reject all coalesced callers without caching absence', async () => {
  faults.stat.set(join(vault, 'Area/Note.md'), 'EPERM');
  await Promise.all(Array.from({ length: 6 }, () => rejectsSafely(catalog.statPaths(['Area/Note.md']))));
  faults.stat.clear();
  expect((await catalog.statPaths(['Area/Note.md'])).has('Area/Note.md')).toBe(true);
});

test.each([true, false])('unreadable subdirectories reject inventory with watcher=%s and recover', async watching => {
  if (!watching) (catalog as any).watcher = undefined;
  faults.readdir.set(join(vault, 'Area'), 'EACCES');
  catalog.invalidate();
  await rejectsSafely(catalog.listNotePaths());
  await rejectsSafely(catalog.listNotePaths());
  faults.readdir.clear();
  expect(await catalog.listNotePaths()).toContain('Area/Note.md');
});

test('an unavailable Vault root cannot become a successful empty inventory', async () => {
  faults.stat.set(vault, 'ENOENT');
  catalog.invalidate();
  await rejectsSafely(catalog.listNotePaths());
  faults.stat.clear();
  expect(await catalog.listNotePaths()).toContain('Root.md');
});

test('watcher errors invalidate batch and legacy subscribers before their next read', async () => {
  const batches: any[] = [], legacy: any[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  catalog.subscribe((...args) => legacy.push(args));
  (catalog as any).watcher.emit('error', new Error('watch fault'));
  await catalog.flushPendingEvents();
  expect(batches).toEqual([undefined]);
  expect(legacy).toEqual([[undefined, undefined]]);
});

test('background flush failure retains the failed batch and later paths for the next read', async () => {
  for (let i = 0; i < 34; i++) await writeFile(join(vault, `N${i}.md`), '# Note');
  const batches: any[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  vi.useFakeTimers();
  faults.stat.set(join(vault, 'N0.md'), 'EIO');
  for (let i = 0; i < 34; i++) event(`N${i}.md`);
  await vi.advanceTimersByTimeAsync(50);
  await (catalog as any).flushPromise;
  await rejectsSafely(catalog.flushPendingEvents());
  faults.stat.clear();
  await catalog.flushPendingEvents();
  expect(batches.flat()).toContainEqual({ path: 'N33.md', kind: 'upsert' });
  expect(batches.flat().filter(Boolean).some(change => change.kind === 'delete')).toBe(false);
});

test('confirmed file absence still delivers deletion and absent child folders are removable', async () => {
  const batches: any[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  await rm(join(vault, 'Area/Note.md'));
  event();
  await catalog.flushPendingEvents();
  expect(batches.flat()).toContainEqual({ path: 'Area/Note.md', kind: 'delete' });
  await rmdir(join(vault, 'Area'));
  catalog.invalidate();
  expect(await catalog.listNotePaths()).toEqual(['Root.md']);
});

const kinds = ['metadata', 'graph', 'search'] as const;
function model(kind: typeof kinds[number]) {
  const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
  if (kind === 'metadata') {
    const index = new VaultMetadataIndex(vault, filter, frontmatter, catalog);
    closers.push(() => index.close());
    return { read: () => index.list(), invalidate: () => index.invalidate('Area/Note.md', 'upsert') };
  }
  if (kind === 'graph') {
    const index = new VaultGraphIndex(vault, filter, frontmatter, catalog);
    closers.push(() => index.close());
    return { read: () => index.getBacklinks('Root.md', 20, () => true), invalidate: () => index.invalidate('Area/Note.md', 'upsert') };
  }
  const index = new SearchService(vault, filter, catalog);
  closers.push(() => index.close());
  return { read: () => index.search({ query: 'originalphrase' }), invalidate: () => index.invalidate('Area/Note.md') };
}
test.each(kinds)('%s refresh failure does not delete a readable note and retries without another event', async kind => {
  const index = model(kind);
  const before = await index.read();
  faults.readFile.set(join(vault, 'Area/Note.md'), 'EIO');
  index.invalidate();
  await rejectsSafely(index.read());
  await rejectsSafely(index.read());
  faults.readFile.clear();
  expect(await index.read()).toEqual(before);
});
test.each(kinds)('%s can recover from an initial read failure without restart', async kind => {
  faults.readFile.set(join(vault, 'Area/Note.md'), 'EIO');
  const index = model(kind);
  await rejectsSafely(index.read());
  faults.readFile.clear();
  expect(JSON.stringify(await index.read())).toContain('Area/Note.md');
});

test.each(kinds)('%s rejects a full catalog stat failure repeatedly and recovers', async kind => {
  const index = model(kind);
  await index.read();
  faults.stat.set(join(vault, 'Area/Note.md'), 'EIO');
  (catalog as any).onFilesystemEvent();
  await rejectsSafely(index.read());
  await rejectsSafely(index.read());
  faults.stat.clear();
  expect(JSON.stringify(await index.read())).toContain('Area/Note.md');
});

test.each(kinds)('%s refreshes after watcher error even without a named file event', async kind => {
  const index = model(kind);
  await index.read();
  await writeFile(join(vault, 'New.md'), '[[Root]] originalphrase');
  (catalog as any).watcher.emit('error', new Error('watcher stopped'));
  expect(JSON.stringify(await index.read())).toContain('New.md');
});

test('evicted search text is not replaced with empty text after a read fault', async () => {
  const search = new SearchService(vault, new PathFilter(), catalog);
  closers.push(() => search.close());
  await search.search({ query: 'originalphrase' });
  const document = (search as any).documents.get('Area/Note.md');
  // This is the same body-absent state produced by text cache eviction.
  document.body = undefined;
  document.frontmatterText = undefined;
  search.invalidate();
  faults.readFile.set(join(vault, 'Area/Note.md'), 'EIO');
  await rejectsSafely(search.search({ query: 'originalphrase' }));
  await rejectsSafely(search.search({ query: 'originalphrase' }));
  faults.readFile.clear();
  expect((await search.search({ query: 'originalphrase' }))[0]?.p).toBe('Area/Note.md');
});

test('public MCP search returns a bounded path-free error and recovers in the same server', async () => {
  const server = createServer(vault, { version: 'io-test' });
  const client = new Client({ name: 'io-fault-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    faults.readFile.set(join(vault, 'Area/Note.md'), 'EACCES');
    const request = { name: 'call_endpoint', arguments: { endpointId: 'wiki.search', arguments: { query: 'originalphrase', maxChars: 512 } } };
    const result = await client.callTool(request);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/unavailable.*retry/i);
    expect(JSON.stringify(result)).not.toContain(vault);
    expect(JSON.stringify(result)).not.toContain('secret-driver-detail');
    expect(JSON.stringify(result).length).toBeLessThan(512);
    faults.readFile.clear();
    const recovered = await client.callTool(request);
    expect(recovered.isError).not.toBe(true);
    expect(JSON.parse((recovered.content as any)[0].text)[0].p).toBe('Area/Note.md');
  } finally {
    faults.readFile.clear();
    await client.close();
    await server.close();
  }
});
