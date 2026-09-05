import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultGraphIndex } from './vault-graph.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { SearchService } from './search.js';

let vault: string;
let catalog: VaultFileCatalog;
let index: VaultMetadataIndex;
let graph: VaultGraphIndex;
let service: LlmWikiService;
let search: SearchService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-read-barrier-'));
  await seed('Root.md', '# Root');
  const filter = new PathFilter();
  const frontmatter = new FrontmatterHandler();
  catalog = new VaultFileCatalog(vault, filter);
  // Inject the delivery boundary explicitly instead of sleeping for OS watches.
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
  index = new VaultMetadataIndex(vault, filter, frontmatter, catalog);
  graph = new VaultGraphIndex(vault, filter, frontmatter, catalog);
  search = new SearchService(vault, filter, catalog);
  // The catalog is shared by the indexes above; argument seven is the IO
  // coordinator, not a catalog. Use the real default reader for hydration.
  const fs = new FileSystemService(vault, undefined, frontmatter, undefined, index, graph);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  await index.list();
  await graph.getBacklinks('Root.md', 20, () => true);
});
afterEach(async () => {
  await search.close();
  graph.close();
  await index.close();
  catalog.close();
  vi.restoreAllMocks();
  await rm(vault, { recursive: true, force: true });
});
async function seed(path: string, content: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), content);
}
function received(path?: string) { (catalog as any).onFilesystemEvent(path); }
const waiting = '---\nnote_kind: project\nlifecycle: active\ntask_status: waiting\nwaiting_for: external review\nwaiting_since: 2020-01-01T00:00:00Z\n---\n# Waiting';

test('a received new-note event reaches the waiting dashboard before its debounce timer', async () => {
  expect((await service.reviewDashboard()).sections.waiting.items).toEqual([]);
  await seed('Projects/Waiting.md', waiting);
  received('Projects/Waiting.md');
  const full = vi.spyOn(index as any, 'refreshAll');
  const result = await service.reviewDashboard();
  expect(result.sections.waiting.items).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Projects/Waiting.md', followUpNeeded: true })]));
  expect(full).not.toHaveBeenCalled();
});

test('received edits and deletes invalidate metadata filter and sorted caches before read', async () => {
  await seed('Note.md', '---\nstatus: old\n---\nOld');
  index.invalidate('Note.md', 'upsert');
  expect(await index.count({ status: 'old' })).toBe(1);
  await index.listSorted({}, '', 'path');
  await seed('Note.md', '---\nstatus: new\n---\nNew');
  received('Note.md');
  expect(await index.count({ status: 'old' })).toBe(0);
  expect(await index.count({ status: 'new' })).toBe(1);
  await rm(join(vault, 'Note.md'));
  received('Note.md');
  expect((await index.listSorted({}, '', 'path')).map(note => note.path)).not.toContain('Note.md');
});

test('received add and delete events update backlinks before read', async () => {
  await seed('Child.md', '[[Root]]');
  received('Child.md');
  const full = vi.spyOn(graph as any, 'refreshAll');
  const linked = await graph.getBacklinks('Root.md', 20, () => true);
  expect(linked.backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Child.md' })]));
  expect(full).not.toHaveBeenCalled();
  await rm(join(vault, 'Child.md'));
  received('Child.md');
  expect((await graph.getBacklinks('Root.md', 20, () => true)).backlinks).toEqual([]);
});

test('unknown received events refresh newly created directory inventories before query', async () => {
  await seed('New folder/New.md', '# New');
  received();
  expect((await index.list()).map(note => note.path)).toContain('New folder/New.md');
});

test('concurrent barriers coalesce the received batch without waiting on the timer', async () => {
  const batches: unknown[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  received('Root.md'); received('Root.md');
  await Promise.all(Array.from({ length: 20 }, () => (catalog as any).flushPendingEvents()));
  expect(batches).toEqual([[{ path: 'Root.md', kind: 'upsert' }]]);
  expect((catalog as any).pendingTimer).toBeUndefined();
});

test('catalog path reads flush subscribers as well as updating their own inventory', async () => {
  const batches: unknown[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  await seed('Added.md', 'Added');
  received('Added.md');
  expect(await catalog.listNotePaths()).toContain('Added.md');
  expect(batches).toEqual([[{ path: 'Added.md', kind: 'upsert' }]]);
});

test('read barriers share one promise and join an active batch before flushing queued changes', async () => {
  let finish!: () => void;
  (catalog as any).flushPromise = new Promise<void>(resolve => { finish = resolve; });
  const batches: unknown[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  received('Root.md');
  const first = catalog.flushPendingEvents();
  expect(catalog.flushPendingEvents()).toBe(first);
  let done = false;
  void first.then(() => { done = true; });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(batches).toEqual([]);
  finish();
  await first;
  expect(batches).toEqual([[{ path: 'Root.md', kind: 'upsert' }]]);
});

test('events delivered during a flushed batch remain available to the next barrier', async () => {
  await seed('Late.md', 'Late');
  let sent = false;
  catalog.subscribeBatch(batch => {
    if (!sent && batch?.some(change => change.path === 'Root.md')) {
      sent = true;
      received('Late.md');
    }
  });
  received('Root.md');
  await catalog.flushPendingEvents();
  expect((catalog as any).pendingChanges.has('Late.md')).toBe(true);
  expect((await index.list()).map(note => note.path)).toContain('Late.md');
  expect((catalog as any).pendingChanges.size).toBe(0);
});

test('closed catalogs never notify subscribers from a pending read barrier', async () => {
  const batches: unknown[] = [];
  catalog.subscribeBatch(batch => batches.push(batch));
  received('Root.md');
  const pending = catalog.flushPendingEvents();
  catalog.close();
  await pending;
  expect(batches).toEqual([]);
});

test('failed flushes reject the reading call and reconcile on the next call', async () => {
  await seed('Added.md', 'Added');
  received('Added.md');
  vi.spyOn(catalog as any, 'flushPendingChanges').mockRejectedValueOnce(new Error('batch fault'));
  await expect(index.list()).rejects.toThrow('batch fault');
  expect((await index.list()).map(note => note.path)).toContain('Added.md');
});

test('clean concurrent reads do not flush an empty batch or force an inventory walk', async () => {
  const flush = vi.spyOn(catalog as any, 'flushPendingChanges');
  const walk = vi.spyOn(catalog as any, 'refresh');
  await Promise.all([index.list(), index.count(), graph.getBacklinks('Root.md', 20, () => true), catalog.listNotePaths()]);
  expect(flush).not.toHaveBeenCalled();
  expect(walk).not.toHaveBeenCalled();
});

test('received additions invalidate negative search results before the cache fast path', async () => {
  expect(await search.search({ query: 'newlyvisiblephrase' })).toEqual([]);
  await seed('Search.md', 'newlyvisiblephrase');
  received('Search.md');
  const full = vi.spyOn(search as any, 'refreshAll');
  const result = await search.search({ query: 'newlyvisiblephrase' });
  expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ p: 'Search.md' })]));
  expect(full).not.toHaveBeenCalled();
});

test('received moderation edits invalidate cached search hits before returning their text', async () => {
  await seed('Search.md', 'sensitivephrase');
  received('Search.md');
  await catalog.flushPendingEvents();
  expect(await search.search({ query: 'sensitivephrase' })).toHaveLength(1);
  await seed('Search.md', '---\nmoderation_status: hidden\n---\nsensitivephrase');
  received('Search.md');
  expect(await search.search({ query: 'sensitivephrase' })).toEqual([]);
});

test('a search after a received change does not join a pre-change computation', async () => {
  const original = (search as any).ensureIndex.bind(search);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(search as any, 'ensureIndex').mockImplementationOnce(async () => {
    await original();
    entered();
    await gate;
  });
  const oldRead = search.search({ query: 'concurrentphrase' });
  await started;
  try {
    await seed('Concurrent.md', 'concurrentphrase');
    received('Concurrent.md');
    const currentRead = search.search({ query: 'concurrentphrase' });
    // Join the same barrier so the second search has passed invalidation
    // before letting the pre-change index selection finish.
    await catalog.flushPendingEvents();
    release();
    const [, current] = await Promise.all([oldRead, currentRead]);
    expect(current).toEqual(expect.arrayContaining([expect.objectContaining({ p: 'Concurrent.md' })]));
  } finally {
    release();
    await oldRead;
  }
});
