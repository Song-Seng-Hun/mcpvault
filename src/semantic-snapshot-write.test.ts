import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { SemanticSearchService } from './semantic-search.js';
import { PathFilter } from './pathfilter.js';

let vault: string, service: any;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-stream-snapshot-'));
  service = new SemanticSearchService(vault, new PathFilter());
  await service.manifestReady; await service.pendingReady;
});
afterEach(async () => {
  vi.restoreAllMocks(); await service.close();
  const target = await realpath(vault), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-stream-snapshot-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});
const decode = async (vault: string, file: string) => JSON.parse(gunzipSync(await readFile(join(vault, '.mcpvault/semantic-index', file))).toString('utf8'));

test('manifest serialization never materializes the complete JSON payload', async () => {
  const manifest = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`한글${i}.md`, { hash: 'a'.repeat(64), scope: 'global' }]));
  service.manifest = manifest;
  const stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...args: any[]) => {
    if (value === manifest) throw new Error('Whole manifest serialization');
    return stringify(value, ...args);
  });
  await service.saveManifest();
  expect(await decode(vault, 'manifest.snapshot.gz')).toEqual(manifest);
});

test('pending work serialization streams records rather than an entire queue array', async () => {
  for (let i = 0; i < 100; i++) service.pending.set(`Note${i}.md`, { kind: 'upsert', attempt: 2, retryAt: 1234 });
  service.pendingSnapshotPending = true;
  const stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...args: any[]) => {
    if (Array.isArray(value) && value.length === 100) throw new Error('Whole queue serialization');
    return stringify(value, ...args);
  });
  await service.flushPendingSnapshot();
  const rows = await decode(vault, 'pending.snapshot.gz');
  expect(rows).toHaveLength(100);
  expect(rows[99]).toEqual({ path: 'Note99.md', kind: 'upsert', attempt: 2, retryAt: 1234 });
});

test('streaming manifest uses captured entries when the live inventory changes between yields', async () => {
  const first = { hash: 'a'.repeat(64), scope: 'global' }, second = { hash: 'b'.repeat(64), scope: 'global' };
  service.manifest = { 'First.md': first, 'Second.md': second };
  const stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...args: any[]) => {
    if (value === first) {
      service.manifest['Second.md'] = { ...second, hash: 'c'.repeat(64) };
      delete service.manifest['First.md'];
      service.manifest['Added.md'] = second;
    }
    return stringify(value, ...args);
  });
  await service.saveManifest();
  expect(await decode(vault, 'manifest.snapshot.gz')).toEqual({ 'First.md': first, 'Second.md': second });
  expect(service.manifest['Second.md'].hash).toBe('c'.repeat(64));
});

test('streaming pending records keep captured retry state and allow a later write', async () => {
  service.pending.set('First.md', { kind: 'upsert', attempt: 1 });
  service.pending.set('Second.md', { kind: 'delete', attempt: 2 });
  service.pendingSnapshotPending = true;
  const stringify = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation((value: any, ...args: any[]) => {
    if (value?.path === 'First.md') {
      service.pending.set('Second.md', { kind: 'upsert', attempt: 3 });
      service.pendingSnapshotPending = true;
    }
    return stringify(value, ...args);
  });
  await service.flushPendingSnapshot();
  expect((await decode(vault, 'pending.snapshot.gz'))[1]).toEqual({ path: 'Second.md', kind: 'delete', attempt: 2 });
  vi.restoreAllMocks();
  await service.flushPendingSnapshot();
  expect((await decode(vault, 'pending.snapshot.gz'))[1]).toEqual({ path: 'Second.md', kind: 'upsert', attempt: 3 });
});

test('optional manifest publication failure does not invalidate successful indexing state', async () => {
  service.manifest = { 'Note.md': { hash: 'a'.repeat(64), scope: 'global' } };
  await mkdir(service.manifestPath, { recursive: true });
  await writeFile(join(service.manifestPath, 'keep.md'), 'not our temporary file');
  await expect(service.saveManifest()).resolves.toBeUndefined();
  expect(service.manifest['Note.md'].hash).toBe('a'.repeat(64));
  expect(service.pending.size).toBe(0);
  expect(await readFile(join(service.manifestPath, 'keep.md'), 'utf8')).toBe('not our temporary file');
});
