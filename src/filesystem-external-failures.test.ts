import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { FileSystemService } from './filesystem.js';

// Failures the host filesystem can produce but a test vault cannot: a rename
// across devices (EXDEV), a copy that runs out of space part way, and a
// source another program holds open (EBUSY).
const host = vi.hoisted(() => ({
  crossDevice: undefined as undefined | ((from: string, to: string) => boolean),
  copyFails: false,
  tempTaken: false,
  cleanupFails: false,
  busy: undefined as string | undefined,
  writeFull: undefined as string | undefined,
  renameExists: false,
  afterCopy: undefined as undefined | (() => void),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (host.crossDevice?.(String(from), String(to))) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      if (host.renameExists && String(from).endsWith('.mcpvault-move')) throw Object.assign(new Error('file already exists'), { code: 'EEXIST' });
      return actual.rename(from, to);
    },
    copyFile: async (from: string, to: string, mode?: number) => {
      if (host.tempTaken) {
        // Another writer owns this name already; the exclusive copy must refuse it.
        await actual.writeFile(to, 'not ours');
        return actual.copyFile(from, to, mode);
      }
      if (!host.copyFails) { await actual.copyFile(from, to, mode); host.afterCopy?.(); return; }
      await actual.writeFile(to, 'par');
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    },
    rm: async (path: string, options?: Parameters<typeof actual.rm>[1]) => {
      if (host.cleanupFails && String(path).endsWith('.mcpvault-move')) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return actual.rm(path, options);
    },
    writeFile: async (path: string, data: string | Uint8Array, options?: Parameters<typeof actual.writeFile>[2]) => {
      if (!host.writeFull || !String(path).endsWith(host.writeFull)) return actual.writeFile(path, data, options);
      await actual.writeFile(path, 'par');
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    },
    unlink: async (path: string) => {
      if (host.busy && String(path).endsWith(host.busy)) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      return actual.unlink(path);
    },
  };
});

// The system recycle bin is a separate program; here it simply takes the file.
const systemTrash = vi.hoisted(() => vi.fn());
vi.mock('trash', () => ({ default: systemTrash }));

const vaults: string[] = [];
afterEach(async () => {
  Object.assign(host, { crossDevice: undefined, copyFails: false, tempTaken: false, cleanupFails: false, busy: undefined, writeFull: undefined, renameExists: false, afterCopy: undefined });
  systemTrash.mockReset();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});
async function vaultWithTarget() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-external-')); vaults.push(vault);
  await writeFile(join(vault, 'Source.png'), 'source');
  await writeFile(join(vault, 'Target.png'), 'old target');
  host.crossDevice = (from, to) => from.endsWith('Source.png') && to.endsWith('Target.png');
  return { vault, fs: new FileSystemService(vault) };
}
const overwrite = { oldPath: 'Source.png', newPath: 'Target.png', confirmOldPath: 'Source.png', confirmNewPath: 'Target.png', overwrite: true };
const files = async (vault: string) => (await readdir(vault)).sort();

test('a cross-device move replaces the target through a temporary copy and removes the source', async () => {
  const { vault, fs } = await vaultWithTarget();
  expect(await fs.moveFile(overwrite)).toMatchObject({ success: true });
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('source');
  expect(await files(vault)).toEqual(['Target.png']);
});

test('a cross-device move denied for its source keeps the target and leaves no temporary file', async () => {
  const { vault, fs } = await vaultWithTarget();
  const context = { access: new ScopeAccessPolicy(), assertFresh() {},
    beforeWrite: async (path: string) => { if (path === 'Source.png') throw new Error('barrier denied the source'); } };
  expect(await withEnterpriseStorageContext(context, () => fs.moveFile(overwrite))).toMatchObject({ success: false });
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
  expect(await readFile(join(vault, 'Source.png'), 'utf8')).toBe('source');
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
});

test('a cross-device copy that fails part way keeps the target and leaves no temporary file', async () => {
  const { vault, fs } = await vaultWithTarget();
  host.copyFails = true;
  expect(await fs.moveFile(overwrite)).toMatchObject({ success: false, message: expect.stringMatching(/no space/) });
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
});

test('a failed temporary-file cleanup keeps the copy failure as the reported error', async () => {
  const { vault, fs } = await vaultWithTarget();
  Object.assign(host, { copyFails: true, cleanupFails: true });
  const result = await fs.moveFile(overwrite);
  expect(result).toMatchObject({ success: false, message: expect.stringMatching(/no space left/) });
  expect(result.message).not.toMatch(/not permitted/);
  expect(result).not.toHaveProperty('partial');
  // The temporary copy the cleanup could not remove is named, Vault-relative.
  const [left] = (await files(vault)).filter(name => name.endsWith('.mcpvault-move'));
  expect(result.message).toContain(`A hidden temporary file (possibly an incomplete copy of the source) remains in the Vault root: ${left}. It is not a backup`);
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
});

test('a temporary name another writer already holds is refused and left in place', async () => {
  const { vault, fs } = await vaultWithTarget();
  host.tempTaken = true;
  expect(await fs.moveFile(overwrite)).toMatchObject({ success: false });
  const left = (await files(vault)).filter(name => name.endsWith('.mcpvault-move'));
  expect(left).toHaveLength(1);
  expect(await readFile(join(vault, left[0]!), 'utf8')).toBe('not ours');
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
});

test('a source admitted by the rename barrier but revoked at the cross-device barrier keeps the target', async () => {
  const { vault, fs } = await vaultWithTarget();
  // First source call: renameProtectedFile, before EXDEV. Second: the cross-device fallback.
  let sourceCalls = 0;
  const context = { access: new ScopeAccessPolicy(), assertFresh() {},
    beforeWrite: async (path: string) => { if (path === 'Source.png' && ++sourceCalls === 2) throw new Error('source revoked at the second barrier'); } };
  expect(await withEnterpriseStorageContext(context, () => fs.moveFile(overwrite)))
    .toMatchObject({ success: false, message: expect.stringMatching(/source revoked at the second barrier/) });
  expect(sourceCalls).toBe(2);
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
});

test('a source revoked while its copy is made is caught by the post-copy recheck', async () => {
  const { vault, fs } = await vaultWithTarget();
  let revoked = false;
  host.afterCopy = () => { revoked = true; };
  const context = { access: new ScopeAccessPolicy(), assertFresh() {},
    canAccessPath: (path: string) => !(revoked && path === 'Source.png') };
  expect(await withEnterpriseStorageContext(context, () => fs.moveFile(overwrite)))
    .toMatchObject({ success: false, message: expect.stringMatching(/owner activity/) });
  expect(revoked).toBe(true);
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
});

test('an EEXIST from renaming our own temporary copy still removes that copy', async () => {
  const { vault, fs } = await vaultWithTarget();
  host.renameExists = true;
  expect(await fs.moveFile(overwrite)).toMatchObject({ success: false, message: expect.stringMatching(/already exists/) });
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
});

test('a cross-device move whose source cannot be removed reports a partial move and still announces the target', async () => {
  const { vault, fs } = await vaultWithTarget();
  host.busy = 'Source.png';
  const announced: string[] = [];
  const stop = fs.observeNoteChanges(path => announced.push(path));
  try {
    expect(await fs.moveFile(overwrite)).toMatchObject({ success: false, partial: true,
      message: expect.stringMatching(/^Partially moved file: Target\.png now holds the content of Source\.png.*resource busy/) });
  } finally { stop(); }
  expect(announced).toEqual(['Target.png']);
  expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('source');
  expect(await files(vault)).toEqual(['Source.png', 'Target.png']);
});

test('a note move whose destination write and restore both fail part way reports a partial write, not the moved note', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-external-')); vaults.push(vault);
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
  await fs.writeNote({ path: 'Moved.md', content: '# Previous\n' });
  const revision = (await fs.readNote('Source.md')).revision;
  host.writeFull = 'Moved.md';
  const result = await fs.moveNote({ oldPath: 'Source.md', newPath: 'Moved.md', overwrite: true, expectedRevision: revision });
  expect(result.message).toMatch(/Rollback incomplete: the previous content of Moved\.md was not restored and is lost; it holds a partial write/);
  expect(await readFile(join(vault, 'Source.md'), 'utf8')).toContain('# Source');
});

test('a system-trash delete runs the write barrier before the system trash and never falls back after a denial', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-external-')); vaults.push(vault);
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'Denied.md', content: '# Denied\n' });
  await fs.writeNote({ path: 'Admitted.md', content: '# Admitted\n' });
  systemTrash.mockImplementation(async (path: string) => unlink(path));
  const context = { access: new ScopeAccessPolicy(), assertFresh() {},
    beforeWrite: async (path: string) => { if (path === 'Denied.md') throw new Error('barrier denied the note'); } };
  const remove = (path: string) => withEnterpriseStorageContext(context, () => fs.deleteNote({ path, confirmPath: path, trashMode: 'system' }));
  expect(await remove('Denied.md')).toMatchObject({ success: false, message: expect.stringMatching(/barrier denied/) });
  expect(systemTrash).not.toHaveBeenCalled();
  expect(await files(vault)).toEqual(['Admitted.md', 'Denied.md']);
  expect(await remove('Admitted.md')).toMatchObject({ success: true });
  expect(systemTrash).toHaveBeenCalledOnce();
  expect(await files(vault)).toEqual(['Denied.md']);
});
