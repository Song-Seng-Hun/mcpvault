import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { readSnapshotBytes } from './snapshot-read.js';
import { randomBytes, createHash } from 'node:crypto';

const growingFile = vi.hoisted(() => ({ path: '', closed: false }));
const fileIO = vi.hoisted(() => ({
  path: '', opens: 0, reads: 0, bytes: 0, maxRequest: 0, closes: 0, pending: 0, pendingAtClose: -1, failAt: 0, pauseAt: 0,
  onPaused: undefined as ((release: () => void) => void) | undefined,
  onDecoderError: undefined as (() => void) | undefined,
}));
vi.mock('node:zlib', async importOriginal => {
  const real = await importOriginal<typeof import('node:zlib')>();
  return { ...real, createGunzip: (...args: Parameters<typeof real.createGunzip>) => {
    const decoder = real.createGunzip(...args);
    decoder.once('error', () => fileIO.onDecoderError?.());
    return decoder;
  } };
});
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    fileIO.opens++;
    const handle = await real.open(...args);
    if (String(args[0]) === fileIO.path) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
        fileIO.reads++;
        fileIO.maxRequest = Math.max(fileIO.maxRequest, Number(readArgs[2]));
        if (fileIO.reads === fileIO.failAt) throw Object.assign(new Error('private path in native IO error'), { code: 'EIO' });
        fileIO.pending++;
        try {
          if (fileIO.reads === fileIO.pauseAt) await new Promise<void>(resolve => fileIO.onPaused?.(resolve));
          const result = await read(...readArgs);
          fileIO.bytes += result.bytesRead;
          return result;
        } finally { fileIO.pending--; }
      }) as typeof handle.read;
      handle.close = async () => {
        fileIO.pendingAtClose = fileIO.pending;
        await close(); fileIO.closes++;
      };
    }
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
  Object.assign(fileIO, { path: '', opens: 0, reads: 0, bytes: 0, maxRequest: 0, closes: 0, pending: 0, pendingAtClose: -1, failAt: 0, pauseAt: 0, onPaused: undefined, onDecoderError: undefined });
  directory = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-read-'));
  path = join(directory, 'snapshot');
});
afterEach(async () => {
  vi.restoreAllMocks();
  growingFile.path = ''; growingFile.closed = false;
  const target = await realpath(directory), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-snapshot-read-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});

test('gzip reads do not assemble a whole compressed input buffer', async () => {
  const content = randomBytes(150000), compressed = gzipSync(content);
  await writeFile(path, compressed);
  const concat = Buffer.concat.bind(Buffer);
  let compressedAssemblies = 0;
  vi.spyOn(Buffer, 'concat').mockImplementation((chunks, length) => {
    if (length === compressed.length && chunks.length > 1) compressedAssemblies++;
    return concat(chunks, length);
  });
  const result = await readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: content.length });
  expect(createHash('sha256').update(result).digest('hex')).toBe(createHash('sha256').update(content).digest('hex'));
  expect(compressedAssemblies).toBe(0);
});

test('decoded overflow stops file reads early and closes the handle without pending IO', async () => {
  const compressed = Buffer.concat([gzipSync(Buffer.alloc(1024 * 1024)), gzipSync(randomBytes(1024 * 1024))]);
  await writeFile(path, compressed);
  fileIO.path = path;
  await expect(readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: 64 })).rejects.toThrow(/^Snapshot unavailable$/);
  expect(fileIO.bytes).toBeGreaterThan(0);
  expect(fileIO.bytes).toBeLessThan(compressed.length / 2);
  expect(fileIO.maxRequest).toBeLessThanOrEqual(65536);
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
});

test.each(['overflow', 'checksum'])('%s waits for a deliberately deferred read before closing the handle', async kind => {
  const first = gzipSync(Buffer.alloc(1024 * 1024));
  if (kind === 'checksum') first[first.length - 8] ^= 1;
  const compressed = Buffer.concat([first, gzipSync(randomBytes(1024 * 1024))]);
  await writeFile(path, compressed);
  fileIO.path = path; fileIO.pauseAt = 2;
  let releaseRead: (() => void) | undefined, settled = false;
  const paused = new Promise<boolean>(resolve => {
    fileIO.onPaused = release => { releaseRead = release; resolve(true); };
  });
  const decoderError = new Promise<void>(resolve => { fileIO.onDecoderError = resolve; });
  // Attach both result handlers immediately; failure assertions never leave
  // the file operation or its deliberately pending read behind.
  const result = readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: kind === 'overflow' ? 64 : 2 * 1024 * 1024 })
    .then(value => { settled = true; return { value, error: undefined }; }, error => { settled = true; return { value: undefined, error }; });
  try {
    expect(await Promise.race([paused, result.then(() => false)])).toBe(true);
    await decoderError;
    expect(fileIO.pending).toBe(1);
    expect(fileIO.pendingAtClose).toBe(-1);
    expect(fileIO.closes).toBe(0);
    expect(settled).toBe(false);
  } finally { releaseRead?.(); await result; }
  const outcome = await result;
  expect(outcome.value).toBeUndefined();
  expect(outcome.error?.message).toBe('Snapshot unavailable');
  expect(fileIO.pendingAtClose).toBe(0);
  expect(fileIO.closes).toBe(1);
});

test('compressed file growth after stat respects input cap and closes the handle', async () => {
  const compressed = gzipSync('value');
  await writeFile(path, compressed);
  fileIO.path = path; growingFile.path = path;
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: 64 })).rejects.toThrow(/^Snapshot unavailable$/);
  expect(fileIO.bytes).toBeLessThanOrEqual(65);
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
});

test('mid-read IO failure returns no partial decoded data and closes the handle', async () => {
  const compressed = gzipSync(randomBytes(200000));
  await writeFile(path, compressed);
  fileIO.path = path; fileIO.failAt = 2;
  await expect(readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: 200000 })).rejects.toThrow(/^Snapshot unavailable$/);
  expect(fileIO.reads).toBe(2);
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
  expect(await readFile(path)).toEqual(compressed);
});

test('concatenated members decode to exact combined bytes and close the handle', async () => {
  const content = '한글😀', compressed = Buffer.concat([gzipSync('한글'), gzipSync('😀')]);
  await writeFile(path, compressed); fileIO.path = path;
  expect((await readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: Buffer.byteLength(content) })).toString()).toBe(content);
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
});

test('empty gzip payload returns empty bytes and closes its handle', async () => {
  const compressed = gzipSync('');
  await writeFile(path, compressed); fileIO.path = path;
  expect((await readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: 1 })).length).toBe(0);
  expect(fileIO.closes).toBe(1);
});

test.each([null, 0, -1, 1.5, NaN, Infinity, 0x80000000])('invalid decoded ceiling %s rejects before open', async maxDecodedBytes => {
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: maxDecodedBytes as number })).rejects.toThrow('Invalid snapshot byte limit');
  expect(fileIO.opens).toBe(0);
});

test('invalid gzip checksum rejects the entire decoded result and closes the handle', async () => {
  const compressed = gzipSync(randomBytes(150000));
  compressed[compressed.length - 8] ^= 1;
  await writeFile(path, compressed); fileIO.path = path;
  await expect(readSnapshotBytes(path, { maxBytes: compressed.length, maxDecodedBytes: 150000 })).rejects.toThrow(/^Snapshot unavailable$/);
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
});

test.each([undefined, null, 0x80000000])('missing or invalid required stored ceiling %s rejects before open', async maxBytes => {
  await expect(readSnapshotBytes(path, { maxBytes: maxBytes as number, maxDecodedBytes: 64 })).rejects.toThrow('Invalid snapshot byte limit');
  expect(fileIO.opens).toBe(0);
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
  fileIO.path = path;
  await expect(readSnapshotBytes(path, { maxBytes: 64, maxDecodedBytes: 64 })).rejects.toThrow('Snapshot unavailable');
  expect(fileIO.closes).toBe(1);
  expect(fileIO.pendingAtClose).toBe(0);
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
