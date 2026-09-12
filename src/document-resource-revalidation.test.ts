import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, open, writeFile, rm, stat, utimes, unlink, rename } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';
import { FrontmatterHandler } from './frontmatter.js';
import { resourceBundleHash, renderResourceBundleManifest, type ResourceBundleManifest } from './resource-bundle.js';

let root: string, reader: DocumentResourceReader, handles: FileHandle;
let denied: Set<string>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-revalidation-'));
  denied = new Set();
  reader = new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy(), path => !denied.has(path));
  const probe = await open(join(root, 'probe.txt'), 'w');
  handles = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function source(path = 'note.md', content: string | Buffer = '# Original\n') {
  await writeFile(join(root, path), content);
  return reader.read(path);
}

// Observe real disk IO; hooks make otherwise nondeterministic await races reproducible.
function observeReads(afterRead: (buffer: Buffer, bytesRead: number, handle: FileHandle) => void | Promise<void>) {
  const original = handles.read;
  return vi.spyOn(handles, 'read').mockImplementation(async function (this: FileHandle, ...args: Parameters<FileHandle['read']>) {
    const result = await Reflect.apply(original, this, args);
    await afterRead(result.buffer, result.bytesRead, this);
    return result;
  });
}

async function bundle() {
  const bytes = Buffer.from('print("original")\n');
  const manifest: ResourceBundleManifest = {
    version: 1, id: 'stream-test', origin: 'local fixture', sourceVersion: '1', license: 'MIT', licenseFile: 'LICENSE', execution: 'never',
    entries: [{ path: 'sample.py', status: 'available', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType: 'text/x-python' }],
  };
  const base = `Community/_sources/resources/${manifest.id}/${resourceBundleHash(manifest)}`;
  await mkdir(join(root, base, 'files'), { recursive: true });
  const manifestPath = `${base}/manifest.md`, path = `${base}/files/sample.py`;
  await writeFile(join(root, manifestPath), renderResourceBundleManifest(manifest));
  await writeFile(join(root, path), bytes);
  return { snapshot: await reader.read(path), manifest, manifestPath };
}

test('revalidates exact bytes without snapshot read, decoding, or moderation parsing', async () => {
  const snapshot = await source();
  const read = vi.spyOn(reader, 'read');
  const decode = vi.spyOn(TextDecoder.prototype, 'decode');
  const parse = vi.spyOn(FrontmatterHandler.prototype, 'parse');
  await reader.assertCurrent(snapshot);
  expect(read).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
});

test('a body-free revision pin revalidates originals without retaining or decoding their bytes', async () => {
  const snapshot = await source();
  const pin = reader.pin(snapshot);
  expect(pin).toEqual({ path: snapshot.path, revision: snapshot.revision, byteLength: snapshot.bytes.length });
  expect(Object.isFrozen(pin)).toBe(true);
  snapshot.bytes.fill(0); snapshot.path = 'poison.md';
  const decode = vi.spyOn(TextDecoder.prototype, 'decode');
  await reader.assertPin(pin);
  expect(decode).not.toHaveBeenCalled();
  await writeFile(join(root, pin.path), 'changed');
  await expect(reader.assertPin(pin)).rejects.toThrow(/revision|changed/i);
});

test('body-free bundle pins retain manifest identity and reject forged pins', async () => {
  const { snapshot, manifestPath } = await bundle();
  const pin = reader.pin(snapshot);
  await expect(reader.assertPin({ ...pin })).rejects.toThrow(/pin|unavailable/i);
  await reader.assertPin(pin);
  await writeFile(join(root, manifestPath), 'changed');
  await expect(reader.assertPin(pin)).rejects.toThrow(/revision|changed/i);
});

test('hashes every byte using one buffer no larger than 64KiB without concatenation', async () => {
  const snapshot = await source('large.pdf', Buffer.alloc(4 * 1024 * 1024 + 17, 0x61));
  const concat = vi.spyOn(Buffer, 'concat');
  const buffers = new Set<ArrayBufferLike>();
  let total = 0, largest = 0;
  observeReads((buffer, bytesRead) => {
    buffers.add(buffer.buffer);
    largest = Math.max(largest, buffer.byteLength);
    total += bytesRead;
  });
  await reader.assertCurrent(snapshot);
  expect(total).toBe(snapshot.bytes.length);
  expect(largest).toBeLessThanOrEqual(64 * 1024);
  expect(buffers.size).toBe(1);
  expect(concat).not.toHaveBeenCalled();
});

test('short initial reads cannot retain a full backing allocation per tiny chunk', async () => {
  const bytes = Buffer.alloc(128 * 1024, 0x61);
  await writeFile(join(root, 'short.pdf'), bytes);
  const allocations = new Map<ArrayBufferLike, number>();
  const read = handles.read;
  vi.spyOn(handles, 'read').mockImplementation(async function (this: FileHandle, ...args: Parameters<FileHandle['read']>) {
    const [buffer, offset, length, position] = args as unknown as [Buffer, number, number, number | null];
    allocations.set(buffer.buffer, buffer.buffer.byteLength);
    return Reflect.apply(read, this, [buffer, offset, Math.min(length, 1024), position]);
  });
  const snapshot = await reader.read('short.pdf');
  expect(snapshot.bytes.equals(bytes)).toBe(true);
  expect([...allocations.values()].reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(bytes.length + 128 * 1024);
});

test('rejects same-byte-length content rewrites with restored mtime by original hash', async () => {
  const snapshot = await source('note.md', 'old');
  const fixedTime = new Date('2026-01-01T00:00:00Z');
  await utimes(join(root, snapshot.path), fixedTime, fixedTime);
  const before = await stat(join(root, snapshot.path));
  await writeFile(join(root, snapshot.path), 'new');
  await utimes(join(root, snapshot.path), before.atime, before.mtime);
  const after = await stat(join(root, snapshot.path));
  expect(after.size).toBe(before.size);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/revision|stale/i);
});

test.each(['hidden', 'quarantined', 'removed'])('rejects newly %s moderation without parsing source again', async status => {
  const snapshot = await source();
  await writeFile(join(root, snapshot.path), `---\nmoderation_status: ${status}\n---\n# Original\n`);
  const parse = vi.spyOn(FrontmatterHandler.prototype, 'parse');
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow();
  expect(parse).not.toHaveBeenCalled();
});

test('rejects deletion before revalidation', async () => {
  const snapshot = await source();
  await unlink(join(root, snapshot.path));
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow();
});

test('rejects source authorization revoked before IO', async () => {
  const snapshot = await source();
  denied.add(snapshot.path);
  const reads = observeReads(() => {});
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/unavailable|denied/i);
  expect(reads).not.toHaveBeenCalled();
});

test('stops at the first read await boundary when source authorization is revoked', async () => {
  const snapshot = await source('large.txt', 'a'.repeat(192 * 1024));
  const reads = observeReads(() => { denied.add(snapshot.path); });
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/unavailable|denied/i);
  expect(reads).toHaveBeenCalledTimes(1);
});

test('rejects source generation changes during streaming', async () => {
  const snapshot = await source('large.txt', 'a'.repeat(192 * 1024));
  let changed = false;
  observeReads(async () => {
    if (changed) return;
    changed = true;
    await rename(join(root, snapshot.path), join(root, 'previous.txt'));
    await writeFile(join(root, snapshot.path), snapshot.bytes);
  });
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/changed|revision|stale/i);
});

test('revalidates bundle manifest and member without rereading or decoding snapshots', async () => {
  const { snapshot } = await bundle();
  const read = vi.spyOn(reader, 'read');
  const decode = vi.spyOn(TextDecoder.prototype, 'decode');
  const parse = vi.spyOn(FrontmatterHandler.prototype, 'parse');
  await reader.assertCurrent(snapshot);
  expect(read).not.toHaveBeenCalled();
  expect(decode).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
});

test.each(['revision', 'length', 'member path', 'non-bundle path'])('rejects a genuine bundle snapshot with mutated %s before streaming', async field => {
  const { snapshot } = await bundle();
  if (field === 'revision') {
    // Mutate the genuine returned buffer in place and rewrite an equal-length
    // member. The unchanged manifest still authorizes only the original hash.
    snapshot.bytes.fill(0x61);
    snapshot.revision = createHash('sha256').update(snapshot.bytes).digest('hex');
  } else if (field === 'length') {
    snapshot.bytes = Buffer.concat([snapshot.bytes, Buffer.from('extra')]);
    snapshot.revision = createHash('sha256').update(snapshot.bytes).digest('hex');
  } else {
    snapshot.path = field === 'member path' ? snapshot.path.replace('sample.py', 'unlisted.py') : 'outside.py';
  }
  await writeFile(join(root, snapshot.path), snapshot.bytes);
  const reads = observeReads(() => {});
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/snapshot|revision|member/i);
  expect(reads).not.toHaveBeenCalled();
});

test('uses the pinned original hash even when a genuine snapshot buffer is mutated in memory', async () => {
  const { snapshot } = await bundle();
  snapshot.bytes.fill(0x61);
  // The on-disk original is unchanged; mutable cached bytes are not authority.
  await expect(reader.assertCurrent(snapshot)).resolves.toBeUndefined();
});

test('rejects changed bundle manifest integrity while the original member is unchanged', async () => {
  const { snapshot, manifest, manifestPath } = await bundle();
  manifest.entries[0]!.sha256 = '0'.repeat(64);
  await writeFile(join(root, manifestPath), renderResourceBundleManifest(manifest));
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow();
});

test('rejects a bundle manifest that becomes moderation hidden', async () => {
  const { snapshot, manifest, manifestPath } = await bundle();
  await writeFile(join(root, manifestPath), `---\nmoderation_status: hidden\n---\n${renderResourceBundleManifest(manifest)}`);
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow();
});

test('rejects revoked bundle manifest authorization', async () => {
  const { snapshot, manifestPath } = await bundle();
  denied.add(manifestPath);
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/unavailable|denied/i);
});

test('rejects source authorization revoked while closing the final read handle', async () => {
  const snapshot = await source();
  let hooked = false;
  observeReads((_buffer, _bytesRead, handle) => {
    if (hooked) return;
    hooked = true;
    const original = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      await original();
      denied.add(snapshot.path);
    });
  });
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/unavailable|denied/i);
});
