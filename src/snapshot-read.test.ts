import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { readSnapshotBytes } from './snapshot-read.js';

const growingFile = vi.hoisted(() => ({ path: '', closed: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    if (String(args[0]) === growingFile.path) {
      const originalStat = handle.stat.bind(handle);
      const originalClose = handle.close.bind(handle);
      handle.stat = (async () => {
        const info = await originalStat();
        await real.appendFile(growingFile.path, Buffer.alloc(65));
        return info;
      }) as typeof handle.stat;
      handle.close = async () => { await originalClose(); growingFile.closed = true; };
    }
    return handle;
  } };
});

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-read-'));
  path = join(directory, 'snapshot');
});
afterEach(async () => {
  growingFile.path = ''; growingFile.closed = false;
  await rm(directory, { recursive: true, force: true });
});

test.each([0, 63, 64])('plain snapshots accept %i bytes within the limit', async size => {
  const content = Buffer.alloc(size, 120);
  await writeFile(path, content);
  expect(await readSnapshotBytes(path, { maxBytes: 64 })).toEqual(content);
});
test('stored snapshots over the limit reject without returning partial bytes', async () => {
  await writeFile(path, Buffer.alloc(65));
  await expect(readSnapshotBytes(path, { maxBytes: 64 })).rejects.toThrow('Snapshot unavailable');
});
test('gzip decoding accepts the exact decoded boundary', async () => {
  const content = Buffer.alloc(64, 120);
  await writeFile(path, gzipSync(content));
  expect(await readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: 64 })).toEqual(content);
});
test('gzip decoding rejects expansion beyond the decoded boundary', async () => {
  await writeFile(path, gzipSync(Buffer.alloc(65, 120)));
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: 64 })).rejects.toThrow('Snapshot unavailable');
});
test('concatenated gzip members share one decoded ceiling', async () => {
  await writeFile(path, Buffer.concat([gzipSync(Buffer.alloc(40, 120)), gzipSync(Buffer.alloc(40, 121))]));
  await expect(readSnapshotBytes(path, { maxBytes: 128, maxDecodedBytes: 64 })).rejects.toThrow('Snapshot unavailable');
});
test.each(['corrupt', 'truncated'])('%s gzip rejects instead of returning partial JSON', async kind => {
  const compressed = gzipSync(Buffer.from('{"value":1}'));
  await writeFile(path, kind === 'corrupt' ? Buffer.from('not gzip') : compressed.subarray(0, compressed.length - 4));
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: 64 })).rejects.toThrow('Snapshot unavailable');
});
test.each([0, -1, 1.5, NaN, Infinity])('invalid byte ceiling %s rejects before IO', async maxBytes => {
  await expect(readSnapshotBytes(path, { maxBytes })).rejects.toThrow('Invalid snapshot byte limit');
});
test('missing files return a path-free cache rejection', async () => {
  await expect(readSnapshotBytes(path, { maxBytes: 64 })).rejects.toThrow(/^Snapshot unavailable$/);
});
test('directories are never consumed as snapshots', async () => {
  await expect(readSnapshotBytes(directory, { maxBytes: 64 })).rejects.toThrow(/^Snapshot unavailable$/);
});

test('a file growing after stat still respects the input ceiling and closes its handle', async () => {
  await writeFile(path, Buffer.alloc(1));
  growingFile.path = path;
  await expect(readSnapshotBytes(path, { maxBytes: 64 })).rejects.toThrow(/^Snapshot unavailable$/);
  expect(growingFile.closed).toBe(true);
});

test('multi-chunk reads preserve exact bytes', async () => {
  const content = Buffer.alloc(150_000);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;
  await writeFile(path, content);
  expect(await readSnapshotBytes(path, { maxBytes: content.length })).toEqual(content);
});

test('decoded ceilings must be finite positive integers too', async () => {
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: Infinity })).rejects.toThrow('Invalid snapshot byte limit');
});
