import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';

const probe = vi.hoisted(() => ({ target: '', calls: 0 }));
vi.mock('node:fs', async original => {
  const real = await original<typeof import('node:fs')>();
  return { ...real, realpathSync: Object.assign((...args: Parameters<typeof real.realpathSync>) => {
    if (String(args[0]) === probe.target) probe.calls++;
    return real.realpathSync(...args);
  }, { native: real.realpathSync.native }) };
});
async function fixture(run: (root: string, vault: string, fs: FileSystemService, io: VaultIoCoordinator) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-read-path-', root = await mkdtemp(join(base, prefix)), vault = join(root, 'vault');
  await mkdir(vault);
  const io = new VaultIoCoordinator(), fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, io);
  try { await run(root, vault, fs, io); }
  finally {
    vi.restoreAllMocks(); probe.target = ''; probe.calls = 0;
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}
test.each([
  ['read', undefined], ['read', 1000], ['revision', undefined], ['revision', 1000],
] as const)('%s with cap=%s resolves an existing path once and reads current content', async (kind, cap) => {
  await fixture(async (_root, vault, fs) => {
    const path = join(vault, 'Note.md');
    for (const content of ['# 첫 글\n한글🙂', '# 수정\nnew knowledge']) {
      await writeFile(path, content); probe.target = path; probe.calls = 0;
      const expected = createHash('sha256').update(content).digest('hex');
      if (kind === 'read') {
        const note = await fs.readNote('Note.md', cap);
        expect(note.originalContent).toBe(content); expect(note.revision).toBe(expected);
      } else expect(await fs.readNoteRevision('Note.md', cap)).toBe(expected);
      expect(probe.calls).toBe(1);
    }
  });
});
test('directory rejection reuses validation and never starts a body read', async () => {
  await fixture(async (_root, vault, fs, io) => {
    probe.target = join(vault, 'Folder'); await mkdir(probe.target);
    const read = vi.spyOn(io, 'readUtf8');
    await expect(fs.readNote('Folder')).rejects.toThrow('Cannot read directory as file');
    expect(probe.calls).toBe(1); expect(read).not.toHaveBeenCalled();
    expect(await fs.isDirectory('Folder')).toBe(true);
    expect(await fs.isDirectory('Missing')).toBe(false);
  });
});
test('restricted and traversal paths are denied without body reads', async () => {
  await fixture(async (_root, vault, fs, io) => {
    await mkdir(join(vault, '.obsidian')); await writeFile(join(vault, '.obsidian', 'config'), 'private');
    const read = vi.spyOn(io, 'readUtf8');
    await expect(fs.readNote('.obsidian/config')).rejects.toThrow('Access denied');
    await expect(fs.readNote('../outside.md')).rejects.toThrow('Path traversal');
    expect(await fs.isDirectory('.obsidian')).toBe(false); expect(read).not.toHaveBeenCalled();
  });
});
test('missing and permission read errors retain their actionable messages', async () => {
  await fixture(async (_root, vault, fs, io) => {
    await expect(fs.readNote('Missing.md')).rejects.toThrow('File not found');
    await writeFile(join(vault, 'Note.md'), 'content');
    vi.spyOn(io, 'readUtf8').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(fs.readNote('Note.md')).rejects.toThrow('Permission denied: Note.md');
  });
});
test('in-vault junction reads work but retargeting outside is rejected on the next call', async () => {
  await fixture(async (root, vault, fs, io) => {
    const inside = join(vault, 'inner'), outside = join(root, 'outside'), link = join(vault, 'linked');
    await mkdir(inside); await mkdir(outside);
    await writeFile(join(inside, 'Note.md'), '# Public'); await writeFile(join(outside, 'Note.md'), '# Private');
    await symlink(inside, link, 'junction');
    expect((await fs.readNote('linked/Note.md')).originalContent).toBe('# Public');
    await unlink(link); await symlink(outside, link, 'junction');
    const read = vi.spyOn(io, 'readUtf8');
    await expect(fs.readNote('linked/Note.md')).rejects.toThrow('Symlink target is outside vault');
    await expect(fs.readNoteRevision('linked/Note.md')).rejects.toThrow('Symlink target is outside vault');
    await expect(fs.isDirectory('linked')).rejects.toThrow('Symlink target is outside vault');
    expect(read).not.toHaveBeenCalled();
  });
});
