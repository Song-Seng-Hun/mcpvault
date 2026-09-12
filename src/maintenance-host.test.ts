import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm, chmod, readdir, rename, lstat, link, symlink } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { loadMaintenanceHostConfig, MAX_MAINTENANCE_STATE_BYTES, validateMaintenanceConfig } from './maintenance-host.js';
import * as storage from './public-federation-storage.js';

const valid = () => ({ version: 1, enabled: true, accountId: 'operator', paths: ['Knowledge/A.md', 'Views/A.canvas'], operations: ['cache_refresh'] });
test('configuration needs explicit paths and only fixed non-model operations', () => {
  expect(validateMaintenanceConfig(valid()).operations).toEqual(['cache_refresh']);
  for (const bad of [
    { ...valid(), operations: ['merge'] }, { ...valid(), operations: ['run_model'] },
    { ...valid(), paths: ['Knowledge/*'] }, { ...valid(), paths: ['../A.md'] },
    { ...valid(), paths: ['C:/A.md'] }, { ...valid(), paths: ['Knowledge/./A.md'] },
    { ...valid(), paths: ['Knowledge/A.md', 'knowledge/a.md'] },
    { ...valid(), accountId: '' }, { ...valid(), parallelism: 8 },
  ]) expect(() => validateMaintenanceConfig(bad)).toThrow();
});

let root: string, vault: string, privateRoot: string, file: string, stateFile: string, lockFile: string;
let leases: Array<{ close(): Promise<void> }>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maintenance-host-')));
  vault = join(root, 'Vault'); privateRoot = join(root, 'Host'); file = join(privateRoot, 'maintenance.json');
  await mkdir(vault); await mkdir(privateRoot, { mode: 0o700 }); leases = [];
  const identity = createHash('sha256').update((await realpath(vault)).toLowerCase()).digest('hex');
  stateFile = join(privateRoot, `maintenance-${identity}.json`);
  lockFile = join(privateRoot, `maintenance-${identity}.writer.lock`);
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [privateRoot, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  await writeFile(file, JSON.stringify({ ...valid(), vaultPath: vault }), { mode: 0o600 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const lease of leases) await lease.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
});

const originalState = { version: 1, receipts: [{ id: 'kept', status: 'interrupted' }] };
const nextState = { version: 1, receipts: [{ id: 'next', status: 'prepared' }] };

async function stateFixture() {
  const host = await loadMaintenanceHostConfig(file, vault);
  const lease = await host.acquire(); leases.push(lease);
  expect(await host.readState()).toBeUndefined();
  await host.writeState(originalState);
  return { host, lease, bytes: await readFile(stateFile, 'utf8') };
}

// Interpose only to schedule a real filesystem mutation at the atomic helper's
// commit boundary. The actual temporary IO, host fence and rename still run.
function beforeStateCommit(change: () => Promise<void>) {
  const write = storage.writeFederationFileAtomic;
  vi.spyOn(storage, 'writeFederationFileAtomic').mockImplementation((directory, target, content, options) =>
    write(directory, target, content, { ...options, beforeCommit: async () => {
      if (target === stateFile) await change();
      await options.beforeCommit?.();
    } }));
}

async function replaceFile(target: string, bytes: string) {
  const replacement = `${target}.replacement`;
  await writeFile(replacement, bytes, { mode: 0o600 });
  // Keep the previous inode allocated to make same-byte replacement observable.
  await rename(target, `${target}.previous`);
  await rename(replacement, target);
}

async function expectNoTemporaryFiles() {
  expect((await readdir(privateRoot)).filter(name => name.endsWith('.tmp'))).toEqual([]);
}

test('host loader rechecks configuration and keeps state outside the Vault', async () => {
  const host = await loadMaintenanceHostConfig(file, vault);
  expect((await host.refresh()).enabled).toBe(true);
  expect(await host.readState()).toBeUndefined();
  await writeFile(file, JSON.stringify({ ...valid(), enabled: false, vaultPath: vault }), { mode: 0o600 });
  expect((await host.refresh()).enabled).toBe(false);
  expect(await readFile(file, 'utf8')).not.toContain('password');
});

test('host storage inside the Vault and wrong Vault bindings are rejected', async () => {
  await writeFile(join(vault, 'maintenance.json'), JSON.stringify({ ...valid(), vaultPath: vault }), { mode: 0o600 });
  await expect(loadMaintenanceHostConfig(join(vault, 'maintenance.json'), vault)).rejects.toThrow();
  await writeFile(file, JSON.stringify({ ...valid(), vaultPath: privateRoot }), { mode: 0o600 });
  await expect(loadMaintenanceHostConfig(file, vault)).rejects.toThrow();
});

test('one writer lease refuses concurrent ownership and never steals an active lock', async () => {
  const host = await loadMaintenanceHostConfig(file, vault);
  const first = await host.acquire(); leases.push(first); await first.assertHeld();
  const second = await loadMaintenanceHostConfig(file, vault);
  await expect(second.acquire()).rejects.toThrow();
  await first.assertHeld();
});

test('permission changes fail closed before reading or writing host state', async () => {
  const { host, bytes } = await stateFixture();
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [privateRoot, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  else await chmod(privateRoot, 0o755);
  await expect(host.refresh()).rejects.toThrow();
  await expect(host.readState()).rejects.toThrow();
  await expect(host.writeState(nextState)).rejects.toThrow();
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
});

test('private state survives reload and owned lease cleanup permits a new writer', async () => {
  const { host, lease } = await stateFixture();
  await host.writeState(nextState);
  await lease.close();
  await lease.close();
  await expect(lstat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  const restarted = await loadMaintenanceHostConfig(file, vault);
  expect(await restarted.readState()).toEqual(nextState);
  const nextLease = await restarted.acquire(); leases.push(nextLease);
  await nextLease.assertHeld();
  expect(await readdir(vault)).toEqual([]);
  await expectNoTemporaryFiles();
});

test('state writes require both a successful read and a live writer', async () => {
  const host = await loadMaintenanceHostConfig(file, vault);
  await host.readState();
  await expect(host.writeState(nextState)).rejects.toThrow(/writer/i);
  const unread = await loadMaintenanceHostConfig(file, vault);
  const lease = await unread.acquire(); leases.push(lease);
  await expect(unread.writeState(nextState)).rejects.toThrow(/read/i);
  await unread.readState();
  await lease.close();
  await expect(unread.writeState(nextState)).rejects.toThrow(/writer/i);
  await expect(lstat(stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['', '{"receipts":['])('corrupt private state %j is preserved across read and write rejection', async corrupt => {
  await writeFile(stateFile, corrupt, { mode: 0o600 });
  const host = await loadMaintenanceHostConfig(file, vault);
  const lease = await host.acquire(); leases.push(lease);
  await expect(host.readState()).rejects.toThrow();
  await expect(host.writeState(nextState)).rejects.toThrow(/read/i);
  expect(await readFile(stateFile, 'utf8')).toBe(corrupt);
  await expectNoTemporaryFiles();
});

test('corruption after a successful read cannot be overwritten using the earlier revision', async () => {
  const { host } = await stateFixture();
  const corrupt = '{"receipts":["torn';
  await writeFile(stateFile, corrupt);
  await expect(host.readState()).rejects.toThrow();
  await expect(host.writeState(nextState)).rejects.toThrow();
  expect(await readFile(stateFile, 'utf8')).toBe(corrupt);
  await expectNoTemporaryFiles();
});

test('oversized state is preserved and cannot establish a writable revision', async () => {
  const oversized = 'x'.repeat(MAX_MAINTENANCE_STATE_BYTES + 1);
  await writeFile(stateFile, oversized, { mode: 0o600 });
  const host = await loadMaintenanceHostConfig(file, vault);
  const lease = await host.acquire(); leases.push(lease);
  await expect(host.readState()).rejects.toThrow(/size limit/i);
  await expect(host.writeState(nextState)).rejects.toThrow(/read/i);
  expect(await readFile(stateFile, 'utf8')).toBe(oversized);
});

test('oversized serialized output preserves existing receipts', async () => {
  const { host, bytes } = await stateFixture();
  await expect(host.writeState({ text: 'é'.repeat(MAX_MAINTENANCE_STATE_BYTES / 2) })).rejects.toThrow(/full/i);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  await expectNoTemporaryFiles();
});

test.each(['changed', 'deleted', 'appeared'] as const)('state CAS refuses a %s destination at commit', async kind => {
  const { host } = await stateFixture();
  if (kind === 'appeared') {
    await rm(stateFile);
    expect(await host.readState()).toBeUndefined();
  }
  const foreign = JSON.stringify({ receipts: [{ id: 'foreign' }] });
  let reachedCommit = false;
  beforeStateCommit(async () => {
    reachedCommit = true;
    if (kind === 'deleted') await rm(stateFile);
    else await writeFile(stateFile, foreign, { mode: 0o600 });
  });
  await expect(host.writeState(nextState)).rejects.toThrow(/history changed/i);
  expect(reachedCommit).toBe(true);
  if (kind === 'deleted') await expect(lstat(stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(stateFile, 'utf8')).toBe(foreign);
  await expectNoTemporaryFiles();
});

test('state CAS rejects same-byte file replacement after its successful read', async () => {
  const { host, bytes } = await stateFixture();
  const previous = await lstat(stateFile);
  await replaceFile(stateFile, bytes);
  expect((await lstat(stateFile)).ino).not.toBe(previous.ino);
  await expect(host.writeState(nextState)).rejects.toThrow(/changed|replaced|binding|identity/i);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  expect(await readFile(`${stateFile}.previous`, 'utf8')).toBe(bytes);
  await expectNoTemporaryFiles();
});

test('state read rejects same-byte replacement while reading instead of approving its revision', async () => {
  const { host, bytes } = await stateFixture();
  const read = storage.readFederationFile;
  let replaced = false;
  vi.spyOn(storage, 'readFederationFile').mockImplementation(async (directory, target, options) => {
    const content = await read(directory, target, options);
    if (target === stateFile && !replaced) {
      await replaceFile(stateFile, content);
      replaced = true;
    }
    return content;
  });
  await expect(host.readState()).rejects.toThrow(/changed|replaced|binding|identity/i);
  expect(replaced).toBe(true);
  await expect(host.writeState(nextState)).rejects.toThrow();
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
});

test('state hard links are rejected for reads and commits without altering either name', async () => {
  const { host, bytes } = await stateFixture();
  const alias = join(privateRoot, 'foreign-state.json');
  await link(stateFile, alias);
  expect((await lstat(stateFile)).nlink).toBe(2);
  await expect(host.readState()).rejects.toThrow(/hard links/i);
  await expect(host.writeState(nextState)).rejects.toThrow(/hard links/i);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  expect(await readFile(alias, 'utf8')).toBe(bytes);
  await expectNoTemporaryFiles();
});

test('host loader rejects a linked parent (Windows junction) without touching private state or lease', async () => {
  const { lease, bytes } = await stateFixture();
  const marker = await readFile(lockFile, 'utf8');
  const entries = (await readdir(privateRoot)).sort();
  const alias = join(root, 'Host-alias');
  // Windows junctions exercise lexical ancestor rejection without requiring
  // file-symlink privileges. This case has no conditional skip or fallback.
  await symlink(privateRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await lstat(alias)).isSymbolicLink()).toBe(true);
  expect(await realpath(alias)).toBe(privateRoot);
  await expect(loadMaintenanceHostConfig(join(alias, 'maintenance.json'), vault)).rejects.toThrow(/symbolic.link|junction/i);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  expect(await readFile(lockFile, 'utf8')).toBe(marker);
  expect((await readdir(privateRoot)).sort()).toEqual(entries);
  await lease.assertHeld();
});

// Separate from the parent-junction case: a skipped file symlink remains an
// explicit coverage gap on Windows hosts lacking file-symlink privileges.
test('state symlinks are rejected for reads and commits without altering their target', async context => {
  const { host, bytes } = await stateFixture();
  const target = join(privateRoot, 'foreign-state.json');
  await rename(stateFile, target);
  try { await symlink(target, stateFile, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      context.skip('Windows file-symlink privilege is unavailable');
      return;
    }
    throw error;
  }
  await expect(host.readState()).rejects.toThrow(/symbolic.link|junction/i);
  await expect(host.writeState(nextState)).rejects.toThrow(/symbolic.link|junction/i);
  expect((await lstat(stateFile)).isSymbolicLink()).toBe(true);
  expect(await readFile(target, 'utf8')).toBe(bytes);
  await expectNoTemporaryFiles();
});

test('approval revoked after temporary IO prevents state commit and preserves receipts', async () => {
  const { host, lease, bytes } = await stateFixture();
  let reachedCommit = false;
  beforeStateCommit(async () => {
    reachedCommit = true;
    expect((await readdir(privateRoot)).filter(name => name.endsWith('.tmp'))).toHaveLength(1);
    await writeFile(file, JSON.stringify({ ...valid(), enabled: false, vaultPath: vault }));
  });
  await expect(host.writeState(nextState)).rejects.toThrow(/revoked/i);
  expect(reachedCommit).toBe(true);
  await expect(lease.assertHeld()).rejects.toThrow(/revoked/i);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  await expectNoTemporaryFiles();
});

test.each(['', '{"version":', JSON.stringify({ version: 1, pid: 2147483647, nonce: 'foreign' })])(
  'acquire preserves an existing corrupt or stale-looking lock %j', async marker => {
    await writeFile(lockFile, marker, { mode: 0o600 });
    const host = await loadMaintenanceHostConfig(file, vault);
    await expect(host.acquire()).rejects.toThrow(/never automatic stealing/i);
    expect(await readFile(lockFile, 'utf8')).toBe(marker);
  },
);

test('lost nonce ownership rejects writes and never removes the foreign lock on close', async () => {
  const { host, lease, bytes } = await stateFixture();
  const foreign = JSON.stringify({ ...JSON.parse(await readFile(lockFile, 'utf8')), nonce: 'foreign-owner' });
  await writeFile(lockFile, foreign);
  await expect(lease.assertHeld()).rejects.toThrow(/ownership changed/i);
  await expect(host.writeState(nextState)).rejects.toThrow(/ownership changed/i);
  await expect(lease.close()).rejects.toThrow(/ownership changed/i);
  expect(await readFile(lockFile, 'utf8')).toBe(foreign);
  expect(await readFile(stateFile, 'utf8')).toBe(bytes);
  await expect(host.acquire()).rejects.toThrow(/never automatic stealing/i);
  await expectNoTemporaryFiles();
});

test('same-byte lock replacement before close is preserved as foreign ownership', async () => {
  const { lease } = await stateFixture();
  const marker = await readFile(lockFile, 'utf8');
  await replaceFile(lockFile, marker);
  await expect(lease.close()).rejects.toThrow(/ownership changed/i);
  expect(await readFile(lockFile, 'utf8')).toBe(marker);
});

test('close preserves a same-byte foreign lock replaced after the first ownership check', async () => {
  const { lease } = await stateFixture();
  const marker = await readFile(lockFile, 'utf8');
  const remove = storage.removeFederationFile;
  let replaced = false;
  vi.spyOn(storage, 'removeFederationFile').mockImplementation(async (directory, target, beforeRemove) => {
    if (target === lockFile && !replaced) {
      await replaceFile(lockFile, marker);
      replaced = true;
    }
    return remove(directory, target, beforeRemove);
  });
  await expect(lease.close()).rejects.toThrow(/changed|replaced|binding|identity|ownership/i);
  expect(replaced).toBe(true);
  expect(await readFile(lockFile, 'utf8')).toBe(marker);
  expect(await readFile(`${lockFile}.previous`, 'utf8')).toBe(marker);
});
