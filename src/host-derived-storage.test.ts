import { afterEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { HostDerivedStorage } from './host-derived-storage.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'host-derived-')); roots.push(root);
  const vault = join(root, 'vault'), host = join(root, 'private');
  await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  await writeFile(join(vault, 'original.txt'), 'Original bytes\r\n');
  return { root, vault, host, store: new HostDerivedStorage(vault, host) };
}

test('snapshots stay in a verified private host namespace and never alter the Vault', async () => {
  const { vault, host, store } = await fixture();
  await store.write('metadata.bin', Buffer.from('advisory'), 100);
  expect((await store.read('metadata.bin', { maxBytes: 100 })).toString()).toBe('advisory');
  expect(await readdir(vault)).toEqual(['original.txt']);
  expect(await readFile(join(vault, 'original.txt'), 'utf8')).toBe('Original bytes\r\n');
  expect(await readdir(host)).toHaveLength(1);
});

test('missing storage, Vault paths, nonlocal paths and unsafe names fail closed', async () => {
  const { vault, store } = await fixture();
  await expect(new HostDerivedStorage(vault).write('a.bin', Buffer.from('x'), 100)).rejects.toThrow(/not configured/i);
  await expect(new HostDerivedStorage(vault, vault).write('a.bin', Buffer.from('x'), 100)).rejects.toThrow(/outside|overlap|Vault/i);
  await expect(new HostDerivedStorage(vault, '\\\\server\\share').read('a.bin', { maxBytes: 100 })).rejects.toThrow();
  for (const name of ['../a.bin', 'sub/a.bin', 'x\\a.bin', 'x:stream', 'a\0.bin']) {
    await expect(store.write(name, Buffer.from('x'), 100)).rejects.toThrow();
  }
});

test('bounded writes preserve the last valid snapshot and Vault namespaces cannot collide', async () => {
  const { root, host, store } = await fixture();
  await store.write('state.bin', Buffer.from('old'), 3);
  await expect(store.write('state.bin', Buffer.from('too large'), 3)).rejects.toThrow(/size|budget|limit/i);
  expect((await store.read('state.bin', { maxBytes: 3 })).toString()).toBe('old');
  await expect(store.read('state.bin', { maxBytes: 2 })).rejects.toThrow();
  const secondVault = join(root, 'second'); await mkdir(secondVault);
  const second = new HostDerivedStorage(secondVault, host);
  await expect(second.read('state.bin', { maxBytes: 10 })).rejects.toThrow();
  await second.write('state.bin', Buffer.from('new'), 3);
  expect((await store.read('state.bin', { maxBytes: 3 })).toString()).toBe('old');
}, 30000);
