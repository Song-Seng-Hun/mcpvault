import { afterEach, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, rm, writeFile, link, symlink } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { VaultMetadataIndex } from './vault-index.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { HostDerivedStorage } from './host-derived-storage.js';
import { VaultIoCoordinator } from './vault-io.js';
import { decodeMetadataSnapshot } from './metadata-snapshot.js';
import { SemanticSearchService } from './semantic-search.js';
import { createHash } from 'node:crypto';
import { NotificationService } from './notifications.js';
import { CommunityFeaturesService } from './community-features.js';
import { FileSystemService } from './filesystem.js';
import { VaultFileCatalog } from './vault-catalog.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture(cache = true) {
  const root = await mkdtemp(join(tmpdir(), 'shared-storage-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'), host = join(root, 'private'); await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  vi.stubEnv('MCPVAULT_DERIVED_CACHE_DIR', cache ? host : undefined);
  await writeFile(join(vault, 'Note.md'), '---\ntitle: Title\n---\nPublic needle');
  const filter = new PathFilter(), io = new VaultIoCoordinator();
  const metadata = new VaultMetadataIndex(vault, filter, new FrontmatterHandler(), undefined, io);
  const search = new SearchService(vault, filter, undefined, io);
  cleanup.push(() => metadata.close(), () => search.close());
  return { vault, host, filter, io, metadata, search, store: new HostDerivedStorage(vault, host) };
}

test('shared metadata and lexical snapshots persist only in a private host namespace', async () => {
  const f = await fixture();
  expect(await f.metadata.list()).toHaveLength(1);
  expect(await f.search.search({ query: 'needle' })).toHaveLength(1);
  await (f.metadata as any).flushSnapshot(); await (f.search as any).flushSnapshot();
  expect(await readdir(f.vault)).toEqual(['Note.md']);
  expect((await f.store.read('metadata-index.snapshot.bin', { maxBytes: 1e6 })).subarray(0, 8).toString()).toBe('MCPVMETA');
  expect((await f.store.read('search-index.snapshot.bin', { maxBytes: 1e6 })).subarray(0, 8).toString()).toBe('MCPVSRCH');
}, 30000);

test('no host configuration leaves shared indexes memory-only', async () => {
  const f = await fixture(false);
  await f.metadata.list(); await f.search.search({ query: 'needle' });
  await (f.metadata as any).flushSnapshot(); await (f.search as any).flushSnapshot();
  expect(await readdir(f.vault)).toEqual(['Note.md']);
  expect(await readdir(f.host)).toEqual([]);
});

test('metadata read admission is checked again after awaited I/O and before persistence', async () => {
  const f = await fixture(); await f.metadata.list();
  await writeFile(join(f.vault, 'Note.md'), '---\ntitle: Now restricted\n---\nChanged');
  const real = f.io.readUtf8Metadata.bind(f.io);
  vi.spyOn(f.io, 'readUtf8Metadata').mockImplementation(async (...args) => {
    const result = await real(...args); vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); return result;
  });
  f.metadata.invalidate('Note.md', 'upsert');
  expect(await f.metadata.list()).toEqual([]);
  await (f.metadata as any).flushSnapshot();
  expect(decodeMetadataSnapshot(await f.store.read('metadata-index.snapshot.bin', { maxBytes: 1e6 }))).toEqual([]);
}, 30000);

test('warm metadata listing reapplies current admission even without an invalidation event', async () => {
  const f = await fixture(false); await f.metadata.list();
  await f.metadata.list({ title: 'Title' });
  await f.metadata.listSorted();
  vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false);
  expect(await f.metadata.list()).toEqual([]);
  expect(await f.metadata.list({ title: 'Title' })).toEqual([]);
  expect(await f.metadata.listSorted()).toEqual([]);
  expect(await f.metadata.count()).toBe(0);
});

test('semantic persistence with no host configuration never creates a Vault cache', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter);
  cleanup.push(() => semantic.close());
  await (semantic as any).manifestReady; await (semantic as any).pendingReady;
  (semantic as any).manifest = { 'Note.md': { hash: 'a'.repeat(64), scope: 'global' } };
  await (semantic as any).saveManifest();
  expect(await readdir(f.vault)).toEqual(['Note.md']);
  expect(semantic.status().available).toBe(false);
});

test('semantic restart snapshots use verified host storage rather than the NAS Vault', async () => {
  const f = await fixture(), semantic = new SemanticSearchService(f.vault, f.filter);
  cleanup.push(() => semantic.close());
  await (semantic as any).manifestReady; await (semantic as any).pendingReady;
  const manifest = { 'Note.md': { hash: 'a'.repeat(64), scope: 'global' } };
  (semantic as any).manifest = manifest;
  await (semantic as any).saveManifest();
  expect(await readdir(f.vault)).toEqual(['Note.md']);
  expect(JSON.parse((await f.store.read('semantic-manifest.snapshot.gz', { maxBytes: 1e6, maxDecodedBytes: 1e6 })).toString())).toEqual(manifest);
}, 30000);

test('semantic source revocation after read prevents any embedding provider invocation', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  const real = f.io.readUtf8.bind(f.io);
  vi.spyOn(f.io, 'readUtf8').mockImplementation(async (...args) => {
    const body = await real(...args); vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); return body;
  });
  vi.spyOn(semantic as any, 'reusableVectors').mockResolvedValue(new Map());
  const provider = vi.spyOn(semantic as any, 'embedMany').mockResolvedValue([Array(384).fill(0)]);
  await expect((semantic as any).prepareIndex('Note.md')).rejects.toThrow(/unavailable|authority|access/i);
  expect(provider).not.toHaveBeenCalled();
});

test('semantic source revocation while loading the embedder prevents model input', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  vi.spyOn(semantic as any, 'reusableVectors').mockResolvedValue(new Map());
  const model = vi.fn(async () => ({ tolist: () => [Array(384).fill(0)] }));
  vi.spyOn(semantic as any, 'getEmbedder').mockImplementation(async () => {
    vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); return model;
  });
  await expect((semantic as any).prepareIndex('Note.md')).rejects.toThrow(/unavailable|authority|access/i);
  expect(model).not.toHaveBeenCalled();
});

test('semantic fallback does not submit source text after batch-time revocation', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  vi.spyOn(semantic as any, 'reusableVectors').mockResolvedValue(new Map());
  const model = vi.fn(async () => {
    vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); throw new Error('Batch unavailable');
  });
  vi.spyOn(semantic as any, 'getEmbedder').mockResolvedValue(model);
  await expect((semantic as any).prepareIndex('Note.md')).rejects.toThrow(/unavailable|authority|access/i);
  expect(model).toHaveBeenCalledTimes(1);
});

test('semantic status does not count entries revoked without an invalidation event', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter);
  cleanup.push(() => semantic.close());
  await (semantic as any).manifestReady; await (semantic as any).pendingReady;
  (semantic as any).manifest = { 'Note.md': { hash: 'a'.repeat(64), scope: 'global' } };
  (semantic as any).pending.set('Note.md', { kind: 'upsert' });
  vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false);
  expect(semantic.status()).toMatchObject({ indexed: 0, pending: 0 });
});

test('warm lexical hydration refuses a revoked cached body', async () => {
  const f = await fixture(false); await f.search.search({ query: 'needle' });
  const document = (f.search as any).documents.get('Note.md');
  expect(document).toBeDefined();
  vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false);
  await expect((f.search as any).loadText(document)).rejects.toThrow(/unavailable|authority|access/i);
});

test('public lexical cache hits cannot expose revoked source metadata or excerpts', async () => {
  const f = await fixture(false);
  expect(await f.search.search({ query: 'needle' })).toHaveLength(1);
  vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false);
  expect(await f.search.search({ query: 'needle' })).toEqual([]);
});

test('a waiting lexical caller reapplies admission when its shared computation completes', async () => {
  const f = await fixture(false);
  const previous = await f.search.search({ query: 'needle' });
  const key = [...(f.search as any).cache.keys()][0];
  (f.search as any).cache.clear();
  let resolve!: (value: unknown) => void;
  (f.search as any).inFlight.set(key, new Promise(done => { resolve = done; }));
  const waiting = f.search.search({ query: 'needle' });
  await Promise.resolve();
  vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); resolve(previous);
  expect(await waiting).toEqual([]);
});

test.each(['hardlink', 'junction', 'file-acl'] as const)('warm semantic tables reject a changed private descendant: %s', async kind => {
  if (kind === 'file-acl' && process.platform !== 'win32') return;
  const f = await fixture(), semantic = new SemanticSearchService(f.vault, f.filter);
  cleanup.push(() => semantic.close());
  const directory = await f.store.directory('semantic-index', true);
  await writeFile(join(directory, 'data.lance'), 'private derived vector', { mode: 0o600 });
  const cached = {}; (semantic as any).tableCache.set('chunks_global', cached);
  expect(await (semantic as any).getTable('chunks_global')).toBe(cached);
  if (kind === 'hardlink') await link(join(directory, 'data.lance'), join(f.host, 'outside-link'));
  else if (kind === 'junction') {
    const outside = join(f.host, 'outside-directory'); await mkdir(outside, { mode: 0o700 });
    await symlink(outside, join(directory, 'linked-table'), process.platform === 'win32' ? 'junction' : 'dir');
  } else await promisify(execFile)('icacls.exe', [join(directory, 'data.lance'), '/grant', '*S-1-1-0:R'], { windowsHide: true });
  await expect((semantic as any).getTable('chunks_global')).rejects.toThrow(/private|link|storage|permission/i);
}, 30000);

test.each(['prepared', 'database', 'table'] as const)('semantic publication excludes source revoked at %s boundary', async boundary => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  vi.spyOn(semantic as any, 'reusableVectors').mockResolvedValue(new Map());
  vi.spyOn(semantic as any, 'embedMany').mockResolvedValue([Array(384).fill(0)]);
  const prepared = await (semantic as any).prepareIndex('Note.md');
  const revoke = () => { vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); };
  const execute = vi.fn(async () => undefined), createTable = vi.fn(async () => undefined);
  const chain = { whenMatchedUpdateAll() { return this; }, whenNotMatchedInsertAll() { return this; }, whenNotMatchedBySourceDelete() { return this; }, execute };
  const table = { schema: async () => ({ fields: ['chunkHash', 'embeddingProfile', 'fiction'].map(name => ({ name })) }), mergeInsert: () => chain };
  const database = vi.spyOn(semantic as any, 'getDb').mockImplementation(async () => { if (boundary === 'database') revoke(); return { createTable }; });
  vi.spyOn(semantic as any, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
  const opening = vi.spyOn(semantic as any, 'getTable').mockImplementation(async () => { if (boundary === 'table') revoke(); return table; });
  if (boundary === 'prepared') revoke();
  await expect((semantic as any).applyIndexBatch([prepared], [])).rejects.toThrow(/access|unavailable|authority/i);
  expect(execute).not.toHaveBeenCalled(); expect(createTable).not.toHaveBeenCalled();
  if (boundary === 'database') expect(database).toHaveBeenCalled();
  if (boundary === 'table') expect(opening).toHaveBeenCalled();
});

test.each(['schema', 'columns'] as const)('semantic mutation rechecks private storage after awaited %s work', async boundary => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  vi.spyOn(semantic as any, 'reusableVectors').mockResolvedValue(new Map());
  vi.spyOn(semantic as any, 'embedMany').mockResolvedValue([Array(384).fill(0)]);
  const prepared = await (semantic as any).prepareIndex('Note.md');
  let revoked = false;
  vi.spyOn(semantic as any, 'indexDirectory').mockImplementation(async () => {
    if (revoked) throw new Error('Private storage ACL revoked'); return 'verified-private-tree';
  });
  const execute = vi.fn(async () => undefined), addColumns = vi.fn(async () => { revoked = true; });
  const chain = { whenMatchedUpdateAll() { return this; }, whenNotMatchedInsertAll() { return this; }, whenNotMatchedBySourceDelete() { return this; }, execute };
  const table = { schema: async () => {
    if (boundary === 'schema') revoked = true;
    return { fields: (boundary === 'schema' ? ['fiction', 'chunkHash', 'embeddingProfile'] : ['fiction']).map(name => ({ name })) };
  }, addColumns, mergeInsert: () => chain };
  vi.spyOn(semantic as any, 'getDb').mockResolvedValue({});
  vi.spyOn(semantic as any, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
  vi.spyOn(semantic as any, 'getTable').mockResolvedValue(table);
  await expect((semantic as any).applyIndexBatch([prepared], [])).rejects.toThrow(/private|ACL/i);
  expect(execute).not.toHaveBeenCalled();
  expect(addColumns).toHaveBeenCalledTimes(boundary === 'columns' ? 1 : 0);
});

test('semantic hydration drops content revoked during its source read', async () => {
  const f = await fixture(false), semantic = new SemanticSearchService(f.vault, f.filter, undefined, undefined, f.io);
  cleanup.push(() => semantic.close());
  const real = f.io.readUtf8.bind(f.io);
  const raw = await real(join(f.vault, 'Note.md'));
  vi.spyOn(f.io, 'readUtf8').mockImplementation(async (...args) => {
    const body = await real(...args); vi.spyOn(f.filter, 'isAllowed').mockReturnValue(false); return body;
  });
  expect(await (semantic as any).hydrateRows([{ id: 'Note.md#0', path: 'Note.md', hash: createHash('sha256').update(raw).digest('hex') }], { query: 'needle' })).toEqual([]);
});

test.each([true, false])('community snapshots remain host-only (configured=%s)', async configured => {
  const f = await fixture(configured), fs = new FileSystemService(f.vault);
  const catalog = new VaultFileCatalog(f.vault, f.filter); cleanup.push(async () => catalog.close());
  const notifications = new NotificationService(fs, {} as any, f.vault, catalog);
  const community = new CommunityFeaturesService(fs, {} as any, {} as any, undefined, f.vault, notifications, catalog);
  cleanup.push(() => notifications.close(), () => community.close());
  await notifications.discoverySnapshot(); await notifications.close();
  await (community as any).saveReactionSnapshot(new Map());
  expect(await readdir(f.vault)).toEqual(['Note.md']);
  if (configured) {
    expect((await f.store.read('public-discovery.snapshot.bin', { maxBytes: 1e6, maxDecodedBytes: 1e6 })).subarray(0, 8).toString()).toBe('MCPVPUB1');
    expect(await (community as any).loadReactionSnapshot()).toMatchObject({ incomplete: false });
    expect((await f.store.read('community-reactions.snapshot.bin', { maxBytes: 1e6 })).length).toBeGreaterThan(0);
  } else expect(await readdir(f.host)).toEqual([]);
}, 30000);
