import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SemanticSearchService } from './semantic-search.js';
import { PathFilter } from './pathfilter.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const faults = vi.hoisted(() => ({ readFile: new Map<string, string>(), readdir: new Map<string, string>(), stat: new Map<string, string>() }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const wrap = (name: keyof typeof faults) => async (...args: any[]) => {
    const code = faults[name].get(String(args[0]));
    if (code) throw Object.assign(new Error(`private-driver-detail ${args[0]}`), { code });
    return (real[name] as any)(...args);
  };
  return { ...real, readFile: wrap('readFile'), readdir: wrap('readdir'), stat: wrap('stat') };
});

let vault: string;
let service: SemanticSearchService;
let catalog: VaultFileCatalog | undefined;
let rows: any[];
const raw = '# Note\n\nsemanticfixture';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
const params = { query: 'fixture', queryVector: vector, maxChars: 512 };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-semantic-integrity-'));
  await mkdir(join(vault, 'Area'));
  await writeFile(join(vault, 'Area/Note.md'), raw);
  rows = [{ id: 'Area/Note.md#0', path: 'Area/Note.md', title: 'Note', hash: hash(raw), line: 1, wiki: false, vector }];
  service = new SemanticSearchService(vault, new PathFilter());
  await (service as any).manifestReady;
  await (service as any).pendingReady;
  const info = await stat(join(vault, 'Area/Note.md'));
  (service as any).manifest = { 'Area/Note.md': { hash: hash(raw), scope: 'global', size: info.size, mtimeMs: info.mtimeMs } };
  // Isolate only native/model operations. Scans, cache, hydration and batch
  // reconciliation still execute the real service against real Markdown.
  vi.spyOn(service as any, 'acquireIndexLease').mockResolvedValue(false);
  vi.spyOn(service as any, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
  vi.spyOn(service as any, 'getTable').mockResolvedValue({ vectorSearch: () => ({ distanceType() { return this; }, limit() { return this; }, toArray: async () => rows }) });
  vi.spyOn(service as any, 'embedMany').mockImplementation(async (texts: any) => texts.map(() => vector));
});
afterEach(async () => {
  Object.values(faults).forEach(map => map.clear());
  await service.close();
  catalog?.close(); catalog = undefined;
  vi.restoreAllMocks();
  await rm(vault, { recursive: true, force: true });
});

test.each(['edit', 'delete', 'hidden'])('cached semantic hits recheck current source after %s without requiring a watcher', async change => {
  expect((await service.search(params)).results[0]?.p).toBe('Area/Note.md');
  if (change === 'delete') await rm(join(vault, 'Area/Note.md'));
  else await writeFile(join(vault, 'Area/Note.md'), change === 'hidden' ? `---\nmoderation_status: hidden\n---\n${raw}` : '# Replaced');
  expect((await service.search(params)).results).toEqual([]);
});

test('an index row matching a currently hidden source is never hydrated', async () => {
  const hidden = `---\nmoderation_status: hidden\n---\n${raw}`;
  await writeFile(join(vault, 'Area/Note.md'), hidden);
  rows[0].hash = hash(hidden);
  expect((await service.search(params)).results).toEqual([]);
});

test('cached hydration IO errors are bounded unavailability, not cached verified text', async () => {
  await service.search(params);
  faults.readFile.set(join(vault, 'Area/Note.md'), 'EACCES');
  const result = await service.search(params);
  expect(result).toMatchObject({ available: false, results: [] });
  expect(JSON.stringify(result)).not.toContain('private-driver-detail');
  expect(JSON.stringify(result).length).toBeLessThan(512);
});

test('backend errors never expose paths or unbounded driver text', async () => {
  vi.mocked((service as any).getTableNames).mockRejectedValue(new Error(`${vault} private-driver-detail ${'x'.repeat(5000)}`));
  const result = await service.search(params);
  expect(result).toMatchObject({ available: false, results: [] });
  expect(JSON.stringify(result)).not.toContain('private-driver-detail');
  expect(JSON.stringify(result).length).toBeLessThan(512);
  expect(service.status().lastError?.length).toBeLessThan(256);
});

test('a generation change during a query cannot bless the old result as current', async () => {
  vi.mocked((service as any).getTable).mockResolvedValue({ vectorSearch: () => ({ distanceType() { return this; }, limit() { return this; }, toArray: async () => { service.notifyChange('Area/Note.md', 'upsert'); return rows; } }) });
  const result = await service.search(params);
  expect(result).toMatchObject({ available: false, results: [] });
  expect((service as any).queryCache.size).toBe(0);
});

test('incomplete fallback directory scans never enqueue deletion or advance the scan watermark', async () => {
  faults.readdir.set(join(vault, 'Area'), 'EIO');
  await expect((service as any).scanForChanges()).rejects.toThrow(/unavailable.*retry/i);
  expect((service as any).pending.get('Area/Note.md')).toBeUndefined();
  expect((service as any).lastScanAt).toBe(0);
  faults.readdir.clear();
  await (service as any).scanForChanges();
  expect((service as any).pending.has('Area/Note.md')).toBe(false);
});

test.each(['stat', 'readFile'] as const)('failed %s during scan remains retryable and cannot certify current indexing', async operation => {
  await writeFile(join(vault, 'Area/Note.md'), '# Changed content');
  faults[operation].set(join(vault, 'Area/Note.md'), 'EIO');
  await expect((service as any).scanForChanges()).rejects.toThrow(/unavailable.*retry/i);
  expect((service as any).lastScanAt).toBe(0);
  faults[operation].clear();
  await (service as any).scanForChanges();
  expect((service as any).pending.get('Area/Note.md')).toMatchObject({ kind: 'upsert' });
});

test('a queued deletion rechecks a recreated source before deleting vectors', async () => {
  service.notifyChange('Area/Note.md', 'delete');
  const apply = vi.spyOn(service as any, 'applyIndexBatch').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'saveManifest').mockResolvedValue(undefined);
  await (service as any).drain(4);
  expect(apply.mock.calls[0]?.[1]).toEqual([]);
  expect(apply.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ path: 'Area/Note.md', contentHash: hash(raw) })]);
});

test('a queued upsert for a confirmed absent source becomes deletion rather than endless retries', async () => {
  await rm(join(vault, 'Area/Note.md'));
  service.notifyChange('Area/Note.md', 'upsert');
  const apply = vi.spyOn(service as any, 'applyIndexBatch').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'saveManifest').mockResolvedValue(undefined);
  await (service as any).drain(4);
  expect(apply).toHaveBeenCalledWith([], ['Area/Note.md']);
  expect((service as any).pending.size).toBe(0);
});

test('a missing Vault root cannot authorize draining queued deletions', async () => {
  service.notifyChange('Area/Note.md', 'delete');
  faults.stat.set(vault, 'ENOENT');
  faults.stat.set(join(vault, 'Area/Note.md'), 'ENOENT');
  const apply = vi.spyOn(service as any, 'applyIndexBatch').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'saveManifest').mockResolvedValue(undefined);
  await expect((service as any).drain(4)).rejects.toThrow(/unavailable.*retry/i);
  expect(apply).not.toHaveBeenCalled();
  expect((service as any).pending.get('Area/Note.md')).toMatchObject({ kind: 'delete', attempt: 1 });
});

test.each(['_scopes/agents/other/Secret.md', '_scopes/users/host/Secret.md'])('a forged relative vector path cannot hydrate %s', async secret => {
  await mkdir(join(vault, secret, '..'), { recursive: true });
  await writeFile(join(vault, secret), 'private content');
  rows = [{ ...rows[0], path: `Area/../${secret}`, hash: hash('private content') }];
  expect((await service.search(params)).results).toEqual([]);
});

test('unsafe queued paths cannot reach background embedding even through a delete intent', async () => {
  service.notifyChange('Area/../_scopes/agents/other/Secret.md', 'delete');
  expect((service as any).pending.size).toBe(0);
});

test('a delivered event invalidates cached misses without starting an embedding job', async () => {
  rows = [];
  catalog = new VaultFileCatalog(vault, new PathFilter());
  // Use the production catalog subscription with an explicit delivery boundary.
  const isolated = new SemanticSearchService(vault, new PathFilter(), undefined, catalog);
  try {
    vi.spyOn(isolated as any, 'acquireIndexLease').mockResolvedValue(false);
    vi.spyOn(isolated as any, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
    const table = { vectorSearch: () => ({ distanceType() { return this; }, limit() { return this; }, toArray: async () => rows }) };
    vi.spyOn(isolated as any, 'getTable').mockResolvedValue(table);
    expect((await isolated.search(params)).results).toEqual([]);
    rows = [{ id: 'Area/Note.md#0', path: 'Area/Note.md', hash: hash(raw), title: 'Note', line: 1, wiki: false, vector }];
    (catalog as any).onFilesystemEvent('Area/Note.md');
    const result = await isolated.search(params);
    expect(result.results[0]?.p).toBe('Area/Note.md');
    expect(isolated.status().indexingActive).toBe(false);
  } finally { await isolated.close(); }
});

test('persisted manifests and queues discard unsafe paths and reconstruct scope from the path', async () => {
  const indexPath = join(vault, '.mcpvault/semantic-index');
  await mkdir(indexPath, { recursive: true });
  const entry = { hash: hash(raw), scope: 'agent:other' };
  await writeFile(join(indexPath, 'manifest.snapshot.gz'), gzipSync(JSON.stringify({ 'Area/Note.md': entry, 'Area/../Outside.md': entry, '_scopes/users/host/Private.md': entry })));
  await writeFile(join(indexPath, 'pending.snapshot.gz'), gzipSync(JSON.stringify([
    { path: 'Area/Note.md', kind: 'upsert' }, { path: 'Area/../Outside.md', kind: 'delete' }, { path: '/absolute.md', kind: 'upsert' },
  ])));
  const isolated = new SemanticSearchService(vault, new PathFilter());
  try {
    await (isolated as any).manifestReady;
    await (isolated as any).pendingReady;
    expect((isolated as any).manifest).toEqual({ 'Area/Note.md': { hash: hash(raw), scope: 'global' } });
    expect([...(isolated as any).pending.keys()]).toEqual(['Area/Note.md']);
  } finally { await isolated.close(); }
});

test('an over-expanded pending snapshot is ignored before queued work is restored', async () => {
  const indexPath = join(vault, '.mcpvault/semantic-index');
  await mkdir(indexPath, { recursive: true });
  const snapshot = ' '.repeat(8 * 1024 * 1024) + JSON.stringify([{ path: 'Area/Note.md', kind: 'delete' }]);
  await writeFile(join(indexPath, 'pending.snapshot.gz'), gzipSync(snapshot));
  const isolated = new SemanticSearchService(vault, new PathFilter());
  try {
    await (isolated as any).pendingReady;
    expect((isolated as any).pending.size).toBe(0);
    expect(await stat(join(vault, 'Area/Note.md'))).toBeDefined();
  } finally { await isolated.close(); }
});

test('a saturated queue cannot advance metadata for an old hash and lose future indexing', async () => {
  const original = { ...(service as any).manifest['Area/Note.md'] };
  await writeFile(join(vault, 'Area/Note.md'), '# A longer changed document requiring a new embedding');
  for (let i = 0; i < 5000; i++) (service as any).pending.set(`Queued${i}.md`, { kind: 'upsert' });
  await (service as any).scanForChanges();
  expect((service as any).manifest['Area/Note.md']).toEqual(original);
  (service as any).pending.clear();
  (service as any).lastScanAt = 0;
  await (service as any).scanForChanges();
  expect((service as any).pending.get('Area/Note.md')).toMatchObject({ kind: 'upsert' });
});

test('a source edited during embedding is retried rather than committed with mismatched metadata', async () => {
  service.notifyChange('Area/Note.md', 'upsert');
  vi.mocked((service as any).embedMany).mockImplementation(async (texts: any) => {
    await writeFile(join(vault, 'Area/Note.md'), '# Changed during embedding');
    return texts.map(() => vector);
  });
  const apply = vi.spyOn(service as any, 'applyIndexBatch').mockResolvedValue(undefined);
  await expect((service as any).drain(4)).rejects.toThrow();
  expect(apply).not.toHaveBeenCalled();
  expect((service as any).manifest['Area/Note.md'].hash).toBe(hash(raw));
  expect((service as any).pending.get('Area/Note.md')).toMatchObject({ kind: 'upsert', attempt: 1 });
});

test('a failed vector write preserves manifest and retries the batch idempotently', async () => {
  const before = { ...(service as any).manifest['Area/Note.md'] };
  const changed = '# Updated semanticfixture';
  await writeFile(join(vault, 'Area/Note.md'), changed);
  service.notifyChange('Area/Note.md', 'upsert');
  let storedRows = [...rows];
  let failAdd = true;
  const table = {
    delete: async () => { storedRows = []; },
    add: async (values: any[]) => { if (failAdd) throw new Error('native write failure'); storedRows.push(...values); },
  };
  vi.spyOn(service as any, 'getDb').mockResolvedValue({});
  vi.mocked((service as any).getTable).mockResolvedValue(table);
  await expect((service as any).drain(4)).rejects.toThrow('native write failure');
  expect((service as any).manifest['Area/Note.md']).toEqual(before);
  expect((service as any).pending.get('Area/Note.md')).toMatchObject({ kind: 'upsert', attempt: 1 });
  failAdd = false;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 2000);
  await (service as any).drain(4);
  expect((service as any).manifest['Area/Note.md'].hash).toBe(hash(changed));
  expect(storedRows).toHaveLength(1);
  expect(storedRows[0].hash).toBe(hash(changed));
  expect((service as any).pending.size).toBe(0);
});

test('public MCP retains bounded lexical results when the vector backend fails', async () => {
  vi.spyOn(SemanticSearchService.prototype as any, 'getTableNames').mockRejectedValue(new Error(`private-driver-detail ${vault}`));
  const server = createServer(vault, { version: 'semantic-integrity' });
  const client = new Client({ name: 'semantic-integrity', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.search', arguments: { query: 'semanticfixture', semantic: true, maxChars: 512 } } });
    expect(result.isError).not.toBe(true);
    const text = (result.content as any)[0].text;
    expect(JSON.parse(text)[0].p).toBe('Area/Note.md');
    expect(text.length).toBeLessThanOrEqual(512);
    expect(text).not.toContain('private-driver-detail');
  } finally {
    await client.close();
    await server.close();
  }
});
