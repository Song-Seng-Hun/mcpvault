import { test, expect, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, unlink, utimes } from 'node:fs/promises';
import { join, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { HeaderCollector, readUtf8MetadataSource } from './streaming-metadata.js';
import { FrontmatterHandler } from './frontmatter.js';
import { SourceReadLimitError } from './bounded-source-read.js';

async function fixture(run: (root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-stream-metadata-', root = await mkdtemp(join(base, prefix));
  try { await run(root); }
  finally {
    vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');

test.each([undefined, 3 * 1024 * 1024])('fresh metadata uses no whole-body reader with cap=%s', async maxBytes => {
  await fixture(async root => {
    const raw = '---\ntitle: Safe\n---\n' + 'x'.repeat(2 * 1024 * 1024);
    await writeFile(join(root, 'Note.md'), raw);
    const io = new VaultIoCoordinator();
    const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    const full = vi.spyOn(io, 'readUtf8'), bounded = vi.spyOn(io, 'readUtf8Bounded');
    expect(await fs.readNoteMetadata(['Note.md'], () => true, { fresh: true, strict: true, ...(maxBytes === undefined ? {} : { maxBytes }) }))
      .toEqual([{ path: 'Note.md', frontmatter: { title: 'Safe' }, revision: hash(raw) }]);
    expect(full).not.toHaveBeenCalled(); expect(bounded).not.toHaveBeenCalled();
  });
});

test('collector preserves parser metadata at every split without keeping closed-header bodies', () => {
  const parser = new FrontmatterHandler();
  const cases = ['', '---', '\uFEFF---', '# Plain', '----\ntitle: no', '\uFEFF\uFEFF---\ntitle: no\n---',
    '```\n---\ntitle: example\n---\n```', '---\ntitle: unclosed', '---\nnull\n---\nBody'];
  for (const bom of ['', '\uFEFF']) for (const eol of ['\n', '\r\n'])
    for (const label of ['', 'yaml', 'yml', 'json', 'JAVASCRIPT', 'xml'])
      for (const data of ['title: 한글', '{"title":"한글"}', 'bad: [', ''])
        for (const suffix of ['', 'suffix', '-']) cases.push(`${bom}---${label}${eol}${data}${eol}---${suffix}\nBody🙂`);
  for (const raw of cases) {
    for (let split = 0; split <= raw.length; split++) {
      const c = new HeaderCollector(); c.write(raw.slice(0, split)); c.write(raw.slice(split));
      expect(parser.parse(c.finish()).frontmatter, `${JSON.stringify(raw)} split=${split}`)
        .toStrictEqual(parser.parse(raw).frontmatter);
    }
    const chars = new HeaderCollector(); for (const ch of raw) chars.write(ch);
    expect(parser.parse(chars.finish()).frontmatter).toStrictEqual(parser.parse(raw).frontmatter);
  }
  const c = new HeaderCollector(); c.write('---\ntitle: safe\n--'); c.write('-suffix\n' + 'x'.repeat(200000)); c.write('ignored');
  expect(c.finish()).toBe('---\ntitle: safe\n---');
  const plain = new HeaderCollector(); plain.write('plain'); plain.write('x'.repeat(200000)); expect(plain.finish()).toBe('');
});

test('real stream matches full decode across read-block delimiters and malformed UTF-8', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md'), parser = new FrontmatterHandler();
    const bytes = [Buffer.alloc(0), Buffer.from('\uFEFF---\r\ntitle: 한글🙂\r\n---\r\nBody'),
      Buffer.from([0xff, 0xf0, 0x9f]), Buffer.from('---\nbad: [\n---\nBody'),
      ...[1, 2, 3, 4].map(offset => Buffer.from('---\n#' + 'x'.repeat(65536 - offset - 5) + '\n---suffix\n한글🙂')),
      Buffer.concat([Buffer.from('---\ntitle: "'), Buffer.alloc(65536 - 13, 0x61), Buffer.from('🙂"\n---\n'), Buffer.from([0xe2, 0x82])]),
      Buffer.from('---\ntitle: ' + 'a'.repeat(100000))];
    for (const rawBytes of bytes) {
      await writeFile(path, rawBytes);
      const raw = rawBytes.toString('utf8'), result = await readUtf8MetadataSource(path, Math.max(1, rawBytes.length));
      expect(result.revision).toBe(hash(raw));
      expect(parser.parse(result.header).frontmatter).toStrictEqual(parser.parse(raw).frontmatter);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});

test('fresh metadata does not share mutable Properties or retain old same-size revisions', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md'), fixed = new Date('2020-01-01T00:00:00Z');
    const raw = '---\ntags: [safe]\n---\nOld'; await writeFile(path, raw); await utimes(path, fixed, fixed);
    const fs = new FileSystemService(root);
    const [a, b] = await Promise.all([fs.readNoteMetadata(['Note.md']), fs.readNoteMetadata(['Note.md'])]);
    (a[0]!.frontmatter.tags as string[]).push('caller-only'); expect(b[0]!.frontmatter.tags).toEqual(['safe']);
    const edited = raw.replace('Old', 'New'); await writeFile(path, edited); await utimes(path, fixed, fixed);
    expect((await fs.readNoteMetadata(['Note.md']))[0]!.revision).toBe(hash(edited));
    await unlink(path); expect(await fs.readNoteMetadata(['Note.md'], () => true, { strict: true })).toEqual([]);
  });
});

test('scope is checked before IO and after projection without leaking revoked metadata', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md'); await writeFile(path, '---\ntitle: private\n---\nBody');
    let allowed = true, calls = 0;
    const io = new VaultIoCoordinator({ metadataReader: async (path, cap) => {
      calls++; const result = await readUtf8MetadataSource(path, cap); allowed = false; return result;
    } });
    const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    expect(await fs.readNoteMetadata(['Note.md'], () => false, { fresh: true })).toEqual([]); expect(calls).toBe(0);
    expect(await fs.readNoteMetadata(['Note.md'], () => allowed, { fresh: true, strict: true })).toEqual([]); expect(calls).toBe(1);
    await expect(fs.readNoteMetadata(['../outside.md'], () => true, { fresh: true, strict: true })).rejects.toThrow();
    expect(await fs.readNoteMetadata(['.obsidian/secret.md'], () => true, { fresh: true, strict: true })).toEqual([]);
  });
});

test('metadata honors byte caps and strict versus best-effort storage failures', async () => {
  await fixture(async root => {
    const path = join(root, 'Note.md'); await writeFile(path, '한글');
    const fs = new FileSystemService(root);
    expect((await fs.readNoteMetadata(['Note.md'], () => true, { maxBytes: 6, strict: true }))[0]!.revision).toBe(hash('한글'));
    await expect(fs.readNoteMetadata(['Note.md'], () => true, { maxBytes: 5, strict: true })).rejects.toBeInstanceOf(SourceReadLimitError);
    expect(await fs.readNoteMetadata(['Note.md'], () => true, { maxBytes: 5 })).toEqual([]);
    const io = new VaultIoCoordinator({ metadataReader: async () => { throw Object.assign(new Error('fixture'), { code: 'EACCES' }); } });
    const denied = new FileSystemService(root, undefined, undefined, undefined, undefined, undefined, io);
    await expect(denied.readNoteMetadata(['Note.md'], () => true, { strict: true })).rejects.toMatchObject({ code: 'EACCES' });
    expect(await denied.readNoteMetadata(['Note.md'])).toEqual([]);
  });
});
