import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoleplayStore } from './roleplay-store.js';
import { inspectRoleplayRecovery, recoverRoleplayWriter } from './roleplay-recovery.js';
import { loadRoleplayHostConfig } from './roleplay-host.js';
import { ROLEPLAY_HOST_IDENTITY_FILE, canonicalRoleplayPath } from './roleplay-storage-host.js';

// Only this synthetic UNC prefix is redirected to a local fixture. No NAS I/O.
const virtual = vi.hoisted(() => ({ unc: '\\\\roleplay-test.invalid\\share', local: '', noLinks: false, unstableIds: false, gateFailure: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const map = (value: any) => typeof value === 'string' && value.startsWith(virtual.unc)
    ? virtual.local + value.slice(virtual.unc.length) : value;
  const result: Record<string, any> = { ...fs };
  for (const name of ['lstat', 'mkdir', 'open', 'readdir', 'unlink', 'readFile', 'writeFile'] as const)
    result[name] = (path: any, ...args: any[]) => (fs[name] as any)(map(path), ...args);
  result.lstat = async (path: any, ...args: any[]) => {
    if (typeof path === 'string' && path.startsWith('\\\\never-access.invalid')) throw new Error('unexpected network access');
    const stat = await (fs.lstat as any)(map(path), ...args);
    if (virtual.unstableIds && String(path).endsWith('writer.lock')) { stat.ino = 123; stat.dev = 456; }
    return stat;
  };
  result.open = async (path: any, ...args: any[]) => {
    const handle = await (fs.open as any)(map(path), ...args);
    if (virtual.gateFailure && String(path).endsWith('recovery.lock') && args[0] === 'wx')
      handle.writeFile = async () => { throw new Error('injected durable gate write failure'); };
    return handle;
  };
  result.rename = (a: any, b: any) => fs.rename(map(a), map(b));
  result.link = (a: any, b: any) => {
    if (virtual.noLinks) throw Object.assign(new Error('hardlinks unsupported'), { code: 'EOPNOTSUPP' });
    return fs.link(map(a), map(b));
  };
  result.realpath = async (path: any) => {
    if (typeof path === 'string' && path.startsWith('\\\\never-access.invalid')) throw new Error('unexpected network access');
    const canonical = await fs.realpath(map(path));
    return typeof path === 'string' && path.startsWith(virtual.unc)
      ? virtual.unc + canonical.slice(virtual.local.length) : canonical;
  };
  return result;
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); virtual.noLinks = false; virtual.local = ''; virtual.unstableIds = false; virtual.gateFailure = false;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(unc = false) {
  const root = await mkdtemp(join(tmpdir(), 'roleplay-storage-host-')); roots.push(root);
  const vault = join(root, 'vault'), hostPath = join(root, 'host');
  await mkdir(vault); await mkdir(hostPath); virtual.local = await realpath(vault);
  return { root, vaultPath: unc ? virtual.unc : vault, hostPath, policy: { administrators: ['host'] } };
}

it('stores a stable durable host identity in writer markers across restarts', async () => {
  const f = await fixture();
  const first = await RoleplayStore.open(f);
  const marker = join(f.vaultPath, '.mcpvault-roleplay/writer.lock');
  const before = JSON.parse(await readFile(marker, 'utf8'));
  await first.close();
  expect(before.hostId).toMatch(/^[a-f0-9]{64}$/);
  const second = await RoleplayStore.open(f);
  try { expect(JSON.parse(await readFile(marker, 'utf8')).hostId).toBe(before.hostId); }
  finally { await second.close(); }
});

it.skipIf(process.platform !== 'win32')('admits synthetic UNC Markdown with a local checkpoint and recovers without hardlinks', async () => {
  const f = await fixture(true); const store = await RoleplayStore.open(f);
  const path = join(f.vaultPath, '.mcpvault-roleplay/writer.lock');
  const marker = JSON.parse(await readFile(path, 'utf8')); await store.close();
  await writeFile(path, JSON.stringify({ ...marker, pid: 2147483647 }));
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
  virtual.noLinks = true;
  const inspection = await inspectRoleplayRecovery(f);
  expect((await recoverRoleplayWriter(f, { expectedFingerprint: inspection.fingerprint, reason: 'test stopped host' })).recovered).toBe(true);
  expect(kill).toHaveBeenCalledOnce();
  const reopened = await RoleplayStore.open(f); await reopened.close();
});

it.skipIf(process.platform !== 'win32').each([undefined, 'a'.repeat(64)])('never probes a UNC PID with unidentified or foreign host ownership %s', async hostId => {
  const f = await fixture(true); const store = await RoleplayStore.open(f); await store.close();
  const path = join(f.vaultPath, '.mcpvault-roleplay/writer.lock');
  const original = JSON.stringify({ pid: 2147483647, nonce: 'foreign', vault: f.vaultPath, hostId });
  await writeFile(path, original);
  const kill = vi.spyOn(process, 'kill');
  const inspection = await inspectRoleplayRecovery(f);
  await expect(recoverRoleplayWriter(f, { expectedFingerprint: inspection.fingerprint, reason: 'foreign host' })).rejects.toThrow(/host.*identity|host.*review/i);
  expect(kill).not.toHaveBeenCalled(); expect(await readFile(path, 'utf8')).toBe(original);
});

it('checks writer marker ownership independently of SMB file IDs and preserves a foreign marker', async () => {
  const f = await fixture(); virtual.unstableIds = true;
  const store = await RoleplayStore.open(f);
  expect((await store.snapshot()).sequence).toBe(0);
  const path = join(f.vaultPath, '.mcpvault-roleplay/writer.lock');
  const marker = JSON.parse(await readFile(path, 'utf8')); marker.nonce = 'replacement';
  const replacement = JSON.stringify(marker); await writeFile(path, replacement);
  await expect(store.snapshot()).rejects.toThrow(/fencing/i);
  await expect(store.close()).rejects.toThrow(/fencing/i);
  expect(await readFile(path, 'utf8')).toBe(replacement);
});

it('preserves a gate whose durable write failed and refuses a later attempt', async () => {
  const f = await fixture(); const store = await RoleplayStore.open(f); await store.close();
  const inspection = await inspectRoleplayRecovery(f);
  virtual.gateFailure = true;
  const approval = { expectedFingerprint: inspection.fingerprint, reason: 'fault injection' };
  await expect(recoverRoleplayWriter(f, approval)).rejects.toThrow(/injected/);
  virtual.gateFailure = false;
  expect(await readFile(join(f.vaultPath, '.mcpvault-roleplay/recovery.lock'), 'utf8')).toBe('');
  await expect(recoverRoleplayWriter(f, approval)).rejects.toThrow(/gate|forensic/i);
});

it('never regenerates a torn local identity and refuses a copied machine binding', async () => {
  const f = await fixture(); const store = await RoleplayStore.open(f); await store.close();
  const path = join(f.hostPath, ROLEPLAY_HOST_IDENTITY_FILE), identity = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, '');
  await expect(RoleplayStore.open(f)).rejects.toThrow(/identity|forensic/i);
  expect(await readFile(path, 'utf8')).toBe('');
  await writeFile(path, JSON.stringify({ ...identity, machine: '0'.repeat(64) }));
  await expect(inspectRoleplayRecovery(f)).rejects.toThrow(/identity|forensic/i);
});

it('validates config and Vault junction ancestors and refuses lexical device aliases', async () => {
  const f = await fixture(); const alias = join(f.root, 'vault-alias');
  await symlink(f.vaultPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(RoleplayStore.open({ ...f, vaultPath: alias })).rejects.toThrow(/junction|symbolic/i);
  const hostAlias = join(f.root, 'host-alias');
  await symlink(f.hostPath, hostAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(f.hostPath, 'config.json'), JSON.stringify({ version: 1, vaultPath: f.vaultPath, hostPath: f.hostPath, administrators: [] }));
  await expect(loadRoleplayHostConfig(join(hostAlias, 'config.json'), f.vaultPath)).rejects.toThrow(/junction|symbolic/i);
  await expect(canonicalRoleplayPath('\\\\?\\C:\\never-access', true)).rejects.toThrow(/canonical|absolute/i);
  await expect(canonicalRoleplayPath(`${f.hostPath}${process.platform === 'win32' ? '\\' : '/'}..`, true)).rejects.toThrow(/canonical/i);
});

it('refuses junction roots for both store and recovery before canonicalization hides them', async () => {
  const f = await fixture(); const alias = join(f.root, 'alias');
  await symlink(f.hostPath, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(RoleplayStore.open({ ...f, hostPath: alias })).rejects.toThrow(/junction|symbolic|canonical/i);
  await expect(inspectRoleplayRecovery({ ...f, hostPath: alias })).rejects.toThrow(/junction|symbolic|canonical/i);
});

it('rejects nonlocal checkpoints before any network access and applies source exclusion to recovery', async () => {
  const f = await fixture();
  await expect(RoleplayStore.open({ ...f, hostPath: '\\\\never-access.invalid\\host' })).rejects.toThrow(/local/i);
  await expect(inspectRoleplayRecovery({ ...f, hostPath: process.cwd() })).rejects.toThrow(/source/i);
});

it('leaves an empty crashed recovery gate for forensic cleanup', async () => {
  const f = await fixture(); const store = await RoleplayStore.open(f); await store.close();
  const path = join(f.vaultPath, '.mcpvault-roleplay/recovery.lock'); await writeFile(path, '');
  const inspection = await inspectRoleplayRecovery(f);
  await expect(recoverRoleplayWriter(f, { expectedFingerprint: inspection.fingerprint, reason: 'empty gate' })).rejects.toThrow(/gate|forensic/i);
  expect(await readFile(path, 'utf8')).toBe('');
});

it('loads explicit dormant administrators without creating a world or relaxing config containment', async () => {
  const f = await fixture(); const config = join(f.hostPath, 'roleplay.json');
  await writeFile(config, JSON.stringify({ version: 1, vaultPath: f.vaultPath, hostPath: f.hostPath, administrators: [] }));
  const options = await loadRoleplayHostConfig(config, f.vaultPath);
  const store = await RoleplayStore.open(options);
  try { expect((await store.snapshot()).sequence).toBe(0); } finally { await store.close(); }
  const reopened = await RoleplayStore.open(options); await reopened.close();
});
