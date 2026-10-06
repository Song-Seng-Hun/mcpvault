import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { FileSystemService } from './filesystem.js';

// Failures the host filesystem can produce but a test vault cannot: a rename
// across devices (EXDEV) and a copy that runs out of space part way.
const host = vi.hoisted(() => ({
  crossDevice: undefined as undefined | ((from: string, to: string) => boolean),
  copyFails: false,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (host.crossDevice?.(String(from), String(to))) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      return actual.rename(from, to);
    },
    copyFile: async (from: string, to: string, mode?: number) => {
      if (!host.copyFails) return actual.copyFile(from, to, mode);
      await actual.writeFile(to, 'par');
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    },
  };
});

const vaults: string[] = [];
afterEach(async () => {
  host.crossDevice = undefined; host.copyFails = false;
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
