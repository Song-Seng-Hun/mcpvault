import { expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { readUtf8HeaderSource } from './streaming-metadata.js';
import { VaultIoCoordinator } from './vault-io.js';

const probe = vi.hoisted(() => ({ path: '', bytes: 0, closed: false, fail: false, buffers: new Set<Buffer>() }));
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    if (String(args[0]) === probe.path) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = (async (...args: any[]) => {
        probe.buffers.add(args[0]);
        if (probe.fail) throw Object.assign(new Error('fixture IO error'), { code: 'EIO' });
        const result = await (read as any)(...args); probe.bytes += result.bytesRead; return result;
      }) as typeof handle.read;
      handle.close = async () => { await close(); probe.closed = true; };
    }
    return handle;
  } };
});

async function fixture(run: (root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-reference-header-', root = await mkdtemp(join(base, prefix));
  try { await run(root); }
  finally {
    vi.restoreAllMocks();
    probe.path = ''; probe.bytes = 0; probe.closed = false; probe.fail = false; probe.buffers.clear();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('fallback alias discovery parses only a small leading header, not the body', async () => {
  await fixture(async root => {
    const header = '---\naliases: [Friendly]\n---\n';
    await writeFile(join(root, 'Note.md'), header + 'x'.repeat(2 * 1024 * 1024));
    const parser = new FrontmatterHandler(), parse = vi.spyOn(parser, 'parse');
    const fs = new FileSystemService(root, undefined, parser);
    expect(await fs.findPathForWikiLink('Friendly')).toEqual(['Note.md']);
    expect(parse).toHaveBeenCalledTimes(1);
    // Fail on a number first so a regression never dumps a multi-MiB body diff.
    expect(parse.mock.calls[0]![0].length).toBe(header.trimEnd().length);
    expect(parse.mock.calls[0]![0]).toBe(header.trimEnd());
  });
});

test.each([true, false])('real early header read avoids remaining 2 MiB body and closes (header=%s)', async header => {
  await fixture(async root => {
    probe.path = join(root, 'Large.md');
    const prefix = header ? '---\ntitle: Safe\n---\n' : '# Plain\n';
    await writeFile(probe.path, prefix + 'x'.repeat(2 * 1024 * 1024));
    const result = await readUtf8HeaderSource(probe.path);
    expect(result).toBe(header ? prefix.trimEnd() : '');
    expect(probe.bytes).toBe(65536); expect(probe.closed).toBe(true);
    expect(probe.buffers.size).toBe(1); expect([...probe.buffers][0]!.length).toBe(65536);
  });
});

test('header delimiter split across read buffers retains exact Properties and stops early', async () => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); const parser = new FrontmatterHandler();
    for (const offset of [1, 2, 3]) {
      const raw = '---\n#' + 'x'.repeat(65536 - offset - 5) + '\n---suffix\n' + 'body'.repeat(100000);
      await writeFile(probe.path, raw); probe.bytes = 0; probe.closed = false;
      const result = await readUtf8HeaderSource(probe.path);
      expect(result.length).toBe(raw.indexOf('\n---', 3) + 4);
      expect(parser.parse(result).frontmatter).toEqual(parser.parse(raw).frontmatter);
      expect(probe.bytes).toBe(131072); expect(probe.closed).toBe(true);
    }
  });
});

test('unclosed header reads to EOF and flushes malformed UTF-8 without truncation', async () => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md');
    const bytes = Buffer.concat([Buffer.from('\uFEFF---\ntitle: ' + 'a'.repeat(70000) + '한🙂'), Buffer.from([0xf0, 0x9f])]);
    await writeFile(probe.path, bytes);
    const result = await readUtf8HeaderSource(probe.path), decoded = bytes.toString('utf8');
    expect(result.length).toBe(decoded.length); expect(result === decoded).toBe(true);
    expect(probe.bytes).toBe(bytes.length); expect(probe.closed).toBe(true);
  });
});

test('header read error closes and fallback lookup omits the unreadable candidate', async () => {
  await fixture(async root => {
    probe.path = join(root, 'Note.md'); await writeFile(probe.path, '---\naliases: [Friendly]\n---\nBody'); probe.fail = true;
    await expect(readUtf8HeaderSource(probe.path)).rejects.toThrow('fixture IO error'); expect(probe.closed).toBe(true);
    expect(await new FileSystemService(root).findPathForWikiLink('Friendly')).toEqual([]);
  });
});

test('a candidate revoked by a later batch neither leaks nor erases another visible alias', async () => {
  await fixture(async root => {
    const paths = ['Secret.md', 'Visible.md', ...Array.from({ length: 30 }, (_, i) => `Filler${i}.md`), 'Trigger.md'];
    for (const path of paths) await writeFile(join(root, path), `---\naliases: [${path === 'Secret.md' || path === 'Visible.md' ? 'Shared' : path}]\n---\nBody`);
    let secretAllowed = true;
    const io = new VaultIoCoordinator({ headerReader: async path => {
      const header = await readUtf8HeaderSource(path); if (path.endsWith('Trigger.md')) secretAllowed = false; return header;
    } });
    const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    // Control only inventory ordering to place revocation in the second batch;
    // all document reads and parsing remain real.
    vi.spyOn(fs as any, 'collectVaultFiles').mockResolvedValue(paths);
    expect(await fs.findPathForWikiLink('Shared', path => path !== 'Secret.md' || secretAllowed)).toEqual(['Visible.md']);
  });
});

test('fallback keeps aliases ambiguous and Markdown/source-relative paths exact', async () => {
  await fixture(async root => {
    await mkdir(join(root, 'folder')); await writeFile(join(root, 'Root.md'), '---\naliases: [Shared]\n---');
    await writeFile(join(root, 'folder/Nested.md'), '---\naliases: [Shared]\n---');
    const io = new VaultIoCoordinator(), read = vi.spyOn(io, 'readUtf8Header');
    const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    expect(await fs.findPathForWikiLink('Shared')).toEqual(['Root.md', 'folder/Nested.md']);
    expect(await fs.findPathForWikiLink('./Nested', () => true, 'folder/Reader.md')).toEqual(['folder/Nested.md']);
    expect(await fs.findPathForMarkdownLink('Nested.md', 'folder/Reader.md')).toEqual(['folder/Nested.md']);
    read.mockClear(); expect(await fs.findPathForWikiLink('Shared', () => false)).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
});

test('fallback reference never returns a candidate revoked during discovery', async () => {
  await fixture(async root => {
    await writeFile(join(root, 'Secret.md'), '---\naliases: [Friendly]\n---\nBody');
    let allowed = true;
    const parser = new FrontmatterHandler(), parse = parser.parse.bind(parser);
    vi.spyOn(parser, 'parse').mockImplementation(raw => { const result = parse(raw); allowed = false; return result; });
    const fs = new FileSystemService(root, undefined, parser);
    expect(await fs.findPathForWikiLink('Friendly', () => allowed)).toEqual([]);
  });
});
