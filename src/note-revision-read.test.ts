import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { VaultIoCoordinator } from './vault-io.js';

const vaults: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});

test('revision-only reads preserve decoded UTF-8 identity without parsing or retaining stale content', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-revision-read-'));
  vaults.push(vault);
  const handler = new FrontmatterHandler(), io = new VaultIoCoordinator();
  const fs = new FileSystemService(vault, undefined, handler, undefined, undefined, undefined, io);
  expect(typeof fs.readNoteRevision).toBe('function');
  const parse = vi.spyOn(handler, 'parse');
  const rawRead = vi.spyOn(io, 'readUtf8');
  const revisionRead = vi.spyOn(io, 'readUtf8Revision');
  const cases = [
    Buffer.from(''),
    Buffer.from('\uFEFF---\r\ntitle: 한국어 🧭\r\n---\r\n본문\r\n'),
    Buffer.from('---\nmalformed: [\n---\n# Note'),
    Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0xc3, 0x28, 0xe2, 0x82]),
  ];
  for (const bytes of cases) {
    await writeFile(join(vault, 'Note.md'), bytes);
    const decoded = await readFile(join(vault, 'Note.md'), 'utf8');
    const expected = createHash('sha256').update(decoded).digest('hex');
    const parsed = await fs.readNote('Note.md');
    parse.mockClear(); rawRead.mockClear(); revisionRead.mockClear();
    expect(await fs.readNoteRevision('Note.md')).toBe(expected);
    expect(expected).toBe(parsed.revision);
    expect(parse).not.toHaveBeenCalled();
    expect(rawRead).not.toHaveBeenCalled();
    expect(revisionRead).toHaveBeenCalledTimes(1);
  }
  await writeFile(join(vault, 'Note.md'), 'old');
  const stamp = await stat(join(vault, 'Note.md'));
  const old = await fs.readNoteRevision('Note.md');
  await writeFile(join(vault, 'Note.md'), 'new');
  await utimes(join(vault, 'Note.md'), stamp.atime, stamp.mtime);
  expect(await fs.readNoteRevision('Note.md')).not.toBe(old);
});

test('revision-only reads retain note path filtering and file error behavior', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-revision-read-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault);
  expect(typeof fs.readNoteRevision).toBe('function');
  await mkdir(join(vault, 'Folder'));
  await mkdir(join(vault, '.private'));
  await writeFile(join(vault, '.private', 'Secret.md'), 'hidden');
  for (const path of ['Folder', 'Missing.md', '.private/Secret.md', '../outside.md']) {
    const readError = await fs.readNote(path).catch(error => error as Error);
    expect(readError).toBeInstanceOf(Error);
    await expect(fs.readNoteRevision(path)).rejects.toThrow((readError as Error).message);
  }
});
