import { expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, stat, utimes, unlink, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { readUtf8MetadataSource } from './streaming-metadata.js';

const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
async function fixture(run: (root: string, indexes: VaultMetadataIndex[]) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-index-projection-', root = await mkdtemp(join(base, prefix));
  const indexes: VaultMetadataIndex[] = [];
  try { await run(root, indexes); }
  finally {
    for (const index of indexes) await index.close();
    vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each(['initialize', 'dirty'] as const)('%s index projection does not read or parse full bodies', async phase => {
  await fixture(async (root, indexes) => {
    const path = join(root, 'Note.md'), header = '---\ntitle: Safe\n---\n';
    let raw = header + 'a'.repeat(2 * 1024 * 1024);
    await writeFile(path, raw); const stamp = await stat(path);
    const parser = new FrontmatterHandler(), io = new VaultIoCoordinator();
    const index = new VaultMetadataIndex(root, new PathFilter(), parser, undefined, io); indexes.push(index);
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
    const full = vi.spyOn(io, 'readUtf8'), parse = vi.spyOn(parser, 'parse');
    if (phase === 'dirty') {
      await index.list(); full.mockClear(); parse.mockClear();
      raw = header + 'b'.repeat(2 * 1024 * 1024); await writeFile(path, raw); await utimes(path, stamp.atime, stamp.mtime);
      index.invalidate('Note.md', 'upsert');
    }
    const rows = await index.list();
    expect(rows).toEqual([expect.objectContaining({ path: 'Note.md', frontmatter: { title: 'Safe' }, revision: digest(raw), size: Buffer.byteLength(raw) })]);
    expect(full).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]![0]).toBe(header.trimEnd());
  });
});

test('index never reinstates a source deleted during its projected read', async () => {
  await fixture(async (root, indexes) => {
    const path = join(root, 'Note.md'); await writeFile(path, '---\nstatus: active\n---\nOriginal');
    let remove = false;
    const io = new VaultIoCoordinator({ metadataReader: async path => {
      const source = await readUtf8MetadataSource(path);
      if (remove) { remove = false; await unlink(path); index.invalidate('Note.md', 'delete'); }
      return source;
    } });
    const index = new VaultMetadataIndex(root, new PathFilter(), new FrontmatterHandler(), undefined, io); indexes.push(index);
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
    expect(await index.count({ status: 'active' })).toBe(1);
    remove = true; index.invalidate('Note.md', 'upsert');
    expect(await index.list()).toEqual([]);
    expect(await index.count({ status: 'active' })).toBe(0);
    expect(await index.getMany(['Note.md'])).toEqual([]);
  });
});

test('projected entries round-trip through the unchanged binary snapshot and retain dirty body revisions', async () => {
  await fixture(async (root, indexes) => {
    const path = join(root, 'Note.md'), raw = '---\ntitle: 한글\nstatus: active\n---\nOld'; await writeFile(path, raw);
    const stamp = await stat(path), parser = new FrontmatterHandler();
    const first = new VaultMetadataIndex(root, new PathFilter(), parser); indexes.push(first);
    vi.spyOn(first as any, 'startWatcher').mockImplementation(() => undefined);
    const original = await first.list(); await (first as any).flushSnapshot(); await first.close();
    expect((await readFile(join(root, '.mcpvault/metadata-index.snapshot.bin'))).subarray(0, 8).toString()).toBe('MCPVMETA');
    const io = new VaultIoCoordinator(), projection = vi.spyOn(io, 'readUtf8Metadata');
    const reopened = new VaultMetadataIndex(root, new PathFilter(), parser, undefined, io); indexes.push(reopened);
    vi.spyOn(reopened as any, 'startWatcher').mockImplementation(() => undefined);
    expect(await reopened.list()).toEqual(original); expect(projection).not.toHaveBeenCalled();
    const edited = raw.replace('Old', 'New'); await writeFile(path, edited); await utimes(path, stamp.atime, stamp.mtime);
    reopened.invalidate('Note.md', 'upsert');
    const current = await reopened.list(); expect(current[0]!.revision).toBe(digest(edited));
    expect(current[0]!.frontmatter).toEqual(original[0]!.frontmatter); expect(projection).toHaveBeenCalledTimes(1);
  });
});

test('batched index construction gives the parser only small headers', async () => {
  await fixture(async (root, indexes) => {
    const header = '---\ntitle: Shared\n---\n', raw = header + 'b'.repeat(128 * 1024);
    for (let i = 0; i < 35; i++) await writeFile(join(root, `${i}.md`), raw);
    const parser = new FrontmatterHandler(), parse = vi.spyOn(parser, 'parse'), io = new VaultIoCoordinator();
    const body = vi.spyOn(io, 'readUtf8'), index = new VaultMetadataIndex(root, new PathFilter(), parser, undefined, io); indexes.push(index);
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
    const rows = await index.list(); expect(rows).toHaveLength(35);
    expect(rows.every(row => row.revision === digest(raw))).toBe(true);
    expect(body).not.toHaveBeenCalled(); expect(parse).toHaveBeenCalledTimes(35);
    expect(parse.mock.calls.every(([text]) => text === header.trimEnd())).toBe(true);
  });
});

test('index revision and Properties match full decoded safe, malformed and unsupported documents', async () => {
  await fixture(async (root, indexes) => {
    const bytes = [Buffer.from('\uFEFF---\r\ntitle: 한글🙂\r\n---\r\nBody'), Buffer.from('---\nbad: [\n---\nBody'),
      Buffer.from('---json\n{"title":"Safe"}\n---\nBody'), Buffer.from('---javascript\nnot executable data\n---\nBody'),
      Buffer.from('---\ntitle: unclosed'), Buffer.from([0xff, 0xe2, 0x82]), Buffer.alloc(0)];
    for (const [i, data] of bytes.entries()) await writeFile(join(root, `${i}.md`), data);
    const parser = new FrontmatterHandler(), index = new VaultMetadataIndex(root, new PathFilter(), parser); indexes.push(index);
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
    const rows = await index.list(); expect(rows).toHaveLength(bytes.length);
    for (const [i, data] of bytes.entries()) {
      const raw = data.toString('utf8'), row = rows.find(row => row.path === `${i}.md`)!;
      expect(row.revision).toBe(digest(raw)); expect(row.frontmatter).toStrictEqual(parser.parse(raw).frontmatter);
    }
  });
});
