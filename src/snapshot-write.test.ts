import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeGzipSnapshot } from './snapshot-write.js';
import { readSnapshotBytes } from './snapshot-read.js';

const io = vi.hoisted(() => ({ renameErrors: [] as string[] }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, rename: async (...args: Parameters<typeof real.rename>) => {
    try { return await real.rename(...args); }
    catch (error) { io.renameErrors.push(String((error as any).code)); throw error; }
  } };
});

let directory: string, path: string;
const limits = { maxBytes: 65536, maxDecodedBytes: 65536 };
beforeEach(async () => {
  io.renameErrors = [];
  directory = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-write-'));
  path = join(directory, 'cache.gz');
});
afterEach(async () => {
  const target = await realpath(directory), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-snapshot-write-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});

test.each(['{}', '[]', '{"한글😀":"line\\nquoted\\\""}'])('gzip round trips %s through the existing bounded reader', async content => {
  await writeGzipSnapshot(path, [content], limits);
  expect((await readSnapshotBytes(path, limits)).toString('utf8')).toBe(content);
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test('mixed string and byte chunks preserve UTF-8 content', async () => {
  const content = Buffer.from('한글😀');
  await writeGzipSnapshot(path, ['["', content.subarray(0, 4), content.subarray(4), '"]'], limits);
  expect(gunzipSync(await readFile(path)).toString('utf8')).toBe('["한글😀"]');
});

test.each(['decoded', 'stored'])('%s byte ceiling accepts the exact boundary and preserves old content on overflow', async kind => {
  const content = '한글😀'.repeat(100);
  const decoded = Buffer.byteLength(content), stored = gzipSync(content).length;
  const exact = { maxBytes: stored, maxDecodedBytes: decoded };
  await writeGzipSnapshot(path, [content], exact);
  const previous = await readFile(path);
  await expect(writeGzipSnapshot(path, [content], { ...exact, [kind === 'decoded' ? 'maxDecodedBytes' : 'maxBytes']: (kind === 'decoded' ? decoded : stored) - 1 })).rejects.toThrow('Snapshot write unavailable');
  expect(await readFile(path)).toEqual(previous);
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test('a throwing source keeps the prior snapshot and removes only its temporary file', async () => {
  await writeFile(path, gzipSync('old'));
  await writeFile(join(directory, 'other-writer.tmp'), 'belongs to another writer');
  function* broken() { yield 'prefix'; throw new Error('private source and path details'); }
  await expect(writeGzipSnapshot(path, broken(), limits)).rejects.toThrow(/^Snapshot write unavailable$/);
  expect(gunzipSync(await readFile(path)).toString()).toBe('old');
  expect((await readdir(directory)).sort()).toEqual(['cache.gz', 'other-writer.tmp']);
});

test('rename failure leaves a pre-existing target and no owned temporary file', async () => {
  await mkdir(path); await writeFile(join(path, 'keep.md'), 'source');
  await expect(writeGzipSnapshot(path, ['new'], limits)).rejects.toThrow(/^Snapshot write unavailable$/);
  expect(await readFile(join(path, 'keep.md'), 'utf8')).toBe('source');
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test('concurrent writers publish complete generations without sharing temporary files', async () => {
  const versions = Array.from({ length: 4 }, (_, i) => `${i}:` + 'text'.repeat(5000));
  const writes = await Promise.allSettled(versions.map(content => writeGzipSnapshot(path, [content], limits)));
  expect(writes.every(result => result.status === 'fulfilled'), io.renameErrors.join(',')).toBe(true);
  expect(versions).toContain(gunzipSync(await readFile(path)).toString('utf8'));
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test('oversize streaming stops pulling an enormous source rather than materializing it', async () => {
  let consumed = 0;
  function* source() { for (let i = 0; i < 100000; i++) { consumed++; yield 'x'.repeat(4096); } }
  await expect(writeGzipSnapshot(path, source(), { maxBytes: 1000, maxDecodedBytes: 8192 })).rejects.toThrow('Snapshot write unavailable');
  expect(consumed).toBeLessThan(100);
  expect(await readdir(directory)).toEqual([]);
});

test.each([0, -1, NaN, Infinity, 1.5, 0x80000000])('invalid byte limit %s does not create a file', async invalid => {
  await expect(writeGzipSnapshot(path, ['x'], { ...limits, maxBytes: invalid })).rejects.toThrow('Invalid snapshot byte limit');
  await expect(writeGzipSnapshot(path, ['x'], { ...limits, maxDecodedBytes: invalid })).rejects.toThrow('Invalid snapshot byte limit');
  expect(await readdir(directory)).toEqual([]);
});
