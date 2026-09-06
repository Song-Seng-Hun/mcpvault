import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeGzipSnapshot } from './snapshot-write.js';
import { readSnapshotBytes } from './snapshot-read.js';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { WriteStream } from 'node:fs';

const io = vi.hoisted(() => ({
  renameErrors: [] as string[], injectedCodes: [] as string[], renameAttempts: 0,
  delays: [] as number[], fastDelays: false, gzipWrites: 0,
  holdFile: false, onHeld: undefined as ((stream: WriteStream) => void) | undefined,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    if (io.holdFile) {
      const create = handle.createWriteStream.bind(handle);
      vi.spyOn(handle, 'createWriteStream').mockImplementation(options => {
        const stream = create(options);
        stream.cork();
        io.onHeld?.(stream);
        return stream;
      });
    }
    return handle;
  }, rename: async (...args: Parameters<typeof real.rename>) => {
    io.renameAttempts++;
    const code = io.injectedCodes.shift();
    if (code) throw Object.assign(new Error('private file path'), { code });
    try { return await real.rename(...args); }
    catch (error) { io.renameErrors.push(String((error as any).code)); throw error; }
  } };
});
vi.mock('node:timers/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:timers/promises')>();
  return { ...real, setTimeout: async (ms: number) => {
    if (!io.fastDelays) return real.setTimeout(ms);
    io.delays.push(ms);
  } };
});
vi.mock('node:zlib', async importOriginal => {
  const real = await importOriginal<typeof import('node:zlib')>();
  return { ...real, createGzip: (...args: Parameters<typeof real.createGzip>) => {
    const codec = real.createGzip(...args), write = codec.write.bind(codec);
    vi.spyOn(codec, 'write').mockImplementation((...input: Parameters<typeof codec.write>) => {
      io.gzipWrites++;
      return write(...input);
    });
    return codec;
  } };
});

let directory: string, path: string;
const limits = { maxBytes: 65536, maxDecodedBytes: 65536 };
beforeEach(async () => {
  io.renameErrors = [];
  io.injectedCodes = []; io.delays = []; io.fastDelays = false;
  io.renameAttempts = 0; io.gzipWrites = 0; io.holdFile = false; io.onHeld = undefined;
  directory = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-write-'));
  path = join(directory, 'cache.gz');
});
afterEach(async () => {
  vi.restoreAllMocks();
  const target = await realpath(directory), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-snapshot-write-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});

test('100,000 tiny records make two gzip writes while preserving file bytes', async () => {
  function* source() { for (let i = 0; i < 100000; i++) yield 'x'; }
  await writeGzipSnapshot(path, source(), { maxBytes: 100000, maxDecodedBytes: 100000 });
  expect(gunzipSync(await readFile(path)).toString()).toBe('x'.repeat(100000));
  expect(io.gzipWrites).toBe(2);
}, 20000);

test.each(['EPERM', 'EBUSY', 'EACCES'])('retries %s at bounded intervals then publishes actual complete file', async code => {
  await writeFile(path, gzipSync('old'));
  io.injectedCodes = [code, code, code]; io.fastDelays = true;
  await writeGzipSnapshot(path, ['new'], limits);
  expect(io.renameAttempts).toBe(4);
  expect(io.delays).toEqual([10, 30, 100]);
  expect(gunzipSync(await readFile(path)).toString()).toBe('new');
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test.each(['EPERM', 'EBUSY', 'EACCES', 'EXDEV', 'ENOENT'])('permanent %s preserves old file and cleans owned temporary', async code => {
  const old = gzipSync('old');
  await writeFile(path, old);
  io.injectedCodes = Array(10).fill(code); io.fastDelays = true;
  await expect(writeGzipSnapshot(path, ['new'], limits)).rejects.toThrow(/^Snapshot write unavailable$/);
  const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(code);
  expect(io.renameAttempts).toBe(transient ? 4 : 1);
  expect(io.delays).toEqual(transient ? [10, 30, 100] : []);
  expect(await readFile(path)).toEqual(old);
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test('stalled real destination bounds incompressible source read-ahead and resumes intact', async () => {
  let consumed = 0, settled = false, seed = 123456789;
  const expected = createHash('sha256');
  function* source() {
    for (let i = 0; i < 1024; i++) {
      const chunk = Buffer.allocUnsafe(4096);
      for (let j = 0; j < chunk.length; j++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        chunk[j] = seed & 255;
      }
      consumed++; expected.update(chunk); yield chunk;
    }
  }
  io.holdFile = true;
  const held = new Promise<WriteStream>(resolve => { io.onHeld = resolve; });
  const write = writeGzipSnapshot(path, source(), { maxBytes: 5 * 1024 * 1024, maxDecodedBytes: 4 * 1024 * 1024 });
  const completion = write.then(() => { settled = true; }, error => { settled = true; throw error; });
  const stream = await held;
  try {
    // Real codec and file streams; only the destination is deliberately corked.
    await pause(100);
    expect(stream.writableCorked).toBe(1);
    expect(settled).toBe(false);
    expect(consumed).toBeGreaterThan(0);
    expect(consumed).toBeLessThan(256);
  } finally { stream.uncork(); await completion; }
  const decoded = gunzipSync(await readFile(path));
  expect(consumed).toBe(1024);
  expect(decoded.length).toBe(4 * 1024 * 1024);
  expect(createHash('sha256').update(decoded).digest('hex')).toBe(expected.digest('hex'));
  expect(await readdir(directory)).toEqual(['cache.gz']);
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

test('compressed ceiling failure closes the source iterator through the real pipeline', async () => {
  const previous = gzipSync('old');
  await writeFile(path, previous);
  let consumed = 0, closed = false;
  function* source() {
    try { for (let i = 0; i < 100000; i++) { consumed++; yield randomBytes(4096); } }
    finally { closed = true; }
  }
  await expect(writeGzipSnapshot(path, source(), { maxBytes: 32, maxDecodedBytes: 500000000 })).rejects.toThrow(/^Snapshot write unavailable$/);
  expect(closed).toBe(true);
  expect(consumed).toBeGreaterThan(0);
  expect(consumed).toBeLessThan(256);
  expect(await readFile(path)).toEqual(previous);
  expect(await readdir(directory)).toEqual(['cache.gz']);
});

test.each([0, -1, NaN, Infinity, 1.5, 0x80000000])('invalid byte limit %s does not create a file', async invalid => {
  let consumed = 0;
  function* source() { consumed++; yield 'x'; }
  await expect(writeGzipSnapshot(path, source(), { ...limits, maxBytes: invalid })).rejects.toThrow('Invalid snapshot byte limit');
  await expect(writeGzipSnapshot(path, source(), { ...limits, maxDecodedBytes: invalid })).rejects.toThrow('Invalid snapshot byte limit');
  expect(consumed).toBe(0);
  expect(await readdir(directory)).toEqual([]);
});
