import { afterEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { loadOwnerActivityHostConfig } from './owner-activity-host.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'owner-host-')); roots.push(root);
  const vault = join(root, 'vault'), host = join(root, 'private'); await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const path = join(host, 'owner-consent.json');
  const config = { vaultPath: vault, version: 1, owners: { account: 'owner' }, grants: [{
    id: 'grant', ownerId: 'owner', accountIds: ['account'], activities: ['collaboration'], actions: ['discover', 'read'],
    dataPrefixes: ['Community/Posts'], executionTargets: ['runtime'], expiresAt: '2999-01-01T00:00:00.000Z',
  }] };
  const save = (value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await save(config);
  return { vault, host, path, config, save };
}
const request = () => ({ accountId: 'account', executionTarget: 'runtime', activity: 'collaboration' as const,
  action: 'read' as const, paths: ['Community/Posts/a.md'], now: Date.now() });

test('host consent is Vault-bound and refresh applies revocation without acquiring execution identity', async () => {
  const f = await fixture(), host = await loadOwnerActivityHostConfig(f.path, f.vault);
  expect(host.policy().decision(request()).allowed).toBe(true);
  expect(host).not.toHaveProperty('execution');
  await f.save({ ...f.config, grants: f.config.grants.map(grant => ({ ...grant, revoked: true })) });
  await host.refresh(); expect(host.policy().decision(request()).allowed).toBe(false);
  await expect(loadOwnerActivityHostConfig(f.path, f.host)).rejects.toThrow();
}, 30000);

test('missing or malformed owner policy fails closed for already warm consumers', async () => {
  const f = await fixture(), host = await loadOwnerActivityHostConfig(f.path, f.vault);
  await f.save({ ...f.config, grants: 'malformed' });
  await expect(host.refresh()).rejects.toThrow();
  expect(host.policy().decision(request()).allowed).toBe(false);
  await f.save(f.config); await host.refresh(); expect(host.policy().decision(request()).allowed).toBe(true);
  await rm(f.path); await expect(host.refresh()).rejects.toThrow();
  expect(host.policy().decision(request()).allowed).toBe(false);
}, 30000);

test('consent loader rejects execution callbacks or locality claims in data-only files', async () => {
  const f = await fixture();
  await f.save({ ...f.config, execution: { accountId: 'account', executionTarget: 'runtime', local: true } });
  await expect(loadOwnerActivityHostConfig(f.path, f.vault)).rejects.toThrow();
});
