import { test, expect, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { hashUtf8Source } from './streaming-revision.js';
import { readUtf8MetadataSource } from './streaming-metadata.js';
import { SourceReadLimitError } from './bounded-source-read.js';

const probe = vi.hoisted(() => ({ path: '', grow: false, failRead: false, closed: false,
  bytes: 0, buffers: new Set<Buffer>(), lengths: [] as number[] }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    if (String(args[0]) === probe.path) {
      const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.stat = (async () => {
        const info = await stat();
        if (probe.grow) await real.appendFile(probe.path, 'x'.repeat(100));
        return info;
      }) as typeof handle.stat;
      handle.read = (async (...readArgs: any[]) => {
        probe.buffers.add(readArgs[0]); probe.lengths.push(readArgs[2]);
        if (probe.failRead) throw Object.assign(new Error('injected read failure'), { code: 'EIO' });
        const result = await (read as any)(...readArgs); probe.bytes += result.bytesRead; return result;
      }) as typeof handle.read;
      handle.close = async () => { await close(); probe.closed = true; };
    }
    return handle;
  } };
});

const oldHash = (bytes: Buffer) => createHash('sha256').update(bytes.toString('utf8'), 'utf8').digest('hex');
test.each(['grow', 'oversize', 'read-error'])('metadata failure closes without publishing a partial projection: %s', async mode => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); await writeFile(probe.path, mode === 'oversize' ? 'x'.repeat(65) : 'a');
    probe.grow = mode === 'grow'; probe.failRead = mode === 'read-error';
    await expect(readUtf8MetadataSource(probe.path, 64)).rejects.toThrow(mode === 'read-error' ? 'injected read failure' : 'read budget');
    expect(probe.closed).toBe(true); expect(probe.bytes).toBe(mode === 'grow' ? 65 : 0);
  });
});
test('a synchronous decoded consumer failure still closes the source handle', async () => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); await writeFile(probe.path, 'content');
    await expect(hashUtf8Source(probe.path, 64, () => { throw new Error('consumer failed'); })).rejects.toThrow('consumer failed');
    expect(probe.closed).toBe(true);
  });
});
async function fixture(run: (root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-stream-revision-', root = await mkdtemp(join(base, prefix));
  try { await run(root); }
  finally {
    vi.restoreAllMocks();
    probe.path = ''; probe.grow = false; probe.failRead = false; probe.closed = false;
    probe.bytes = 0; probe.buffers.clear(); probe.lengths = [];
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each([undefined, 200000])('revision uses no whole-body reader with cap=%s', async cap => {
  await fixture(async root => {
    const bytes = Buffer.from('한글🙂\r\n'.repeat(10000));
    await writeFile(join(root, 'Note.md'), bytes);
    const io = new VaultIoCoordinator();
    const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    const full = vi.spyOn(io, 'readUtf8'), bounded = vi.spyOn(io, 'readUtf8Bounded');
    expect(await fs.readNoteRevision('Note.md', cap)).toBe(oldHash(bytes));
    expect(full).not.toHaveBeenCalled(); expect(bounded).not.toHaveBeenCalled();
  });
});

test('streaming matches full UTF-8 decode for boundary and malformed byte fixtures', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md');
    const payloads = [Buffer.alloc(0), Buffer.from('\uFEFF# 한글\r\n🙂\0'),
      Buffer.from([0xff, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0xe2, 0x82]),
      ...['é', '한', '🙂'].flatMap(character => Array.from({ length: Buffer.byteLength(character) - 1 }, (_, i) =>
        Buffer.concat([Buffer.alloc(65536 - i - 1, 0x61), Buffer.from(character)]))),
      ...[1, 2, 3, 4].flatMap(offset => [
        Buffer.concat([Buffer.alloc(65536 - offset, 0x61), Buffer.from('한🙂é'), Buffer.from([0xf0, 0x9f])]),
        Buffer.concat([Buffer.alloc(65536 - offset, 0x61), Buffer.from([0xf0, 0x9f, 0x41, 0xff, 0xe2, 0x82, 0xac])]),
      ])];
    for (const bytes of payloads) {
      await writeFile(path, bytes);
      expect(await hashUtf8Source(path)).toBe(oldHash(bytes));
      expect(await hashUtf8Source(path, Math.max(1, bytes.length))).toBe(oldHash(bytes));
    }
  });
});

test.each([0, -1, 1.5, Infinity, -Infinity, NaN, 0x80000000])('direct digest validates cap before opening a missing file: %s', async cap => {
  await fixture(async root => {
    await expect(hashUtf8Source(join(root, 'missing.md'), cap)).rejects.toThrow('Invalid source byte limit');
  });
});

test('large revision read reuses one <=64 KiB input buffer and closes', async () => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 0x61);
    await writeFile(probe.path, bytes);
    expect(await hashUtf8Source(probe.path)).toBe(oldHash(bytes));
    expect(probe.buffers.size).toBe(1);
    expect([...probe.buffers][0]!.byteLength).toBeLessThanOrEqual(65536);
    expect(Math.max(...probe.lengths)).toBeLessThanOrEqual(65536);
    expect(probe.bytes).toBe(bytes.length); expect(probe.closed).toBe(true);
  });
});

test.each(['grow', 'oversize', 'read-error'])('failed digest closes without partial result: %s', async mode => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); await writeFile(probe.path, mode === 'oversize' ? 'x'.repeat(65) : 'a');
    probe.grow = mode === 'grow'; probe.failRead = mode === 'read-error';
    await expect(hashUtf8Source(probe.path, 64)).rejects.toThrow(mode === 'read-error' ? 'injected read failure' : 'read budget');
    expect(probe.closed).toBe(true);
    expect(probe.bytes).toBe(mode === 'grow' ? 65 : 0);
  });
});

test('limits count raw bytes and a later read sees edits, not a digest cache', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md'), io = new VaultIoCoordinator();
    await writeFile(path, '한글');
    expect(await io.readUtf8Revision(path, 6)).toBe(oldHash(Buffer.from('한글')));
    await expect(io.readUtf8Revision(path, 5)).rejects.toBeInstanceOf(SourceReadLimitError);
    await writeFile(path, '새글');
    expect(await io.readUtf8Revision(path, 6)).toBe(oldHash(Buffer.from('새글')));
  });
});

test('filesystem keeps missing/directory/path/error classifications for revision reads', async () => {
  await fixture(async root => {
    await writeFile(join(root, 'Note.md'), 'safe');
    const fs = new FileSystemService(root);
    await expect(fs.readNoteRevision('missing.md')).rejects.toThrow('File not found');
    await expect(fs.readNoteRevision('.')).rejects.toThrow(/directory|denied/i);
    await expect(fs.readNoteRevision('../outside.md')).rejects.toThrow();
    await expect(fs.readNoteRevision('.obsidian/private')).rejects.toThrow(/denied/i);
    const io = new VaultIoCoordinator({ revisionReader: async () => { throw Object.assign(new Error('fixture'), { code: 'EACCES' }); } });
    const denied = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    await expect(denied.readNoteRevision('Note.md')).rejects.toThrow('Permission denied');
  });
});

test('revision reads preserve inside-link support and outside-link rejection', async context => {
  await fixture(async root => fixture(async outside => {
    await writeFile(join(root, 'Note.md'), 'inside'); await writeFile(join(outside, 'Note.md'), 'outside');
    try {
      await symlink(join(root, 'Note.md'), join(root, 'inside-link.md'));
      await symlink(join(outside, 'Note.md'), join(root, 'outside-link.md'));
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) { context.skip(); return; }
      throw error;
    }
    const fs = new FileSystemService(root);
    expect(await fs.readNoteRevision('inside-link.md')).toBe(oldHash(Buffer.from('inside')));
    await expect(fs.readNoteRevision('outside-link.md')).rejects.toThrow(/outside vault/i);
  }));
});
