import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeAuthService } from './scope-auth.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';
import { connectMcpClient } from '../tests/server-fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, symlink } from 'node:fs/promises';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'account-store-vault-'));
  cleanup.push(() => rm(vault, { recursive: true, force: true }));
  const privateStore = await derivedStorageFixture(vault);
  cleanup.push(privateStore.close);
  const path = join(privateStore.host, 'accounts.json');
  await writeFile(path, JSON.stringify({ version: 1, accounts: [] }), { mode: 0o600 });
  return { vault, path, host: privateStore.host };
}
const registration = { accountId: 'research-test', modelId: 'codex', agentId: 'research-test', userId: 'fixture-owner', password: 'disposable-fixture-password-only' };
function service(vault: string, path: string) {
  return new ScopeAuthService(vault, { accountStorePath: path });
}

test('server accounts persist outside Vault and a restarted service can log in', async () => {
  const f = await fixture();
  const registered = await service(f.vault, f.path).register(registration);
  const raw = await readFile(f.path, 'utf8');
  expect(JSON.parse(raw).accounts).toHaveLength(1);
  expect(raw).not.toContain(registration.password);
  expect(raw).not.toContain(registered.accessToken);
  expect(await readdir(f.vault)).toEqual([]);
  expect((await service(f.vault, f.path).login(registration)).principal.agentId).toBe('research-test');
});

test('an explicit store cannot disappear and become a new empty account database', async () => {
  const f = await fixture();
  const auth = service(f.vault, f.path);
  await auth.register(registration);
  await rm(f.path);
  await expect(auth.login(registration)).rejects.toThrow(/account store/i);
  expect(await readdir(f.vault)).toEqual([]);
});

test('selected store respects a lock beside the selected database', async () => {
  const f = await fixture();
  await writeFile(`${f.path}.lock`, JSON.stringify({ pid: process.pid, nonce: 'held-fixture' }));
  await expect(service(f.vault, f.path).register(registration)).rejects.toThrow(/already in use/);
  expect(JSON.parse(await readFile(f.path, 'utf8')).accounts).toHaveLength(0);
});

test('cached account reads do not bypass revoked storage permissions', async () => {
  const f = await fixture(), auth = service(f.vault, f.path);
  await auth.register(registration);
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [f.path, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  else await chmod(f.path, 0o644);
  await expect(auth.login(registration)).rejects.toThrow(/account store/i);
});

test('store rejects relative paths, source paths and symbolic link ancestors', async () => {
  const f = await fixture();
  expect(() => service(f.vault, 'relative.json')).toThrow(/account store/i);
  expect(() => new ScopeAuthService(f.vault, { accountStorePath: f.path, authPath: f.path })).toThrow(/overrides/i);
  await expect(service(f.vault, join(process.cwd(), 'package.json')).login(registration)).rejects.toThrow(/account store/i);
  const alias = join(f.vault, 'link');
  await symlink(f.host, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(service(f.vault, join(alias, 'accounts.json')).login(registration)).rejects.toThrow(/account store/i);
});

test('existing MCP endpoints use the host store without exposing its path or granting anonymous writes', async () => {
  const f = await fixture();
  const { server, client } = await connectMcpClient(f.vault, { accountStorePath: f.path });
  try {
    const denied = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: { path: 'denied.md', content: 'no grant' } } });
    expect(denied.isError).toBe(true);
    const registered = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: registration } });
    expect(registered.isError).not.toBe(true);
    expect(JSON.stringify(registered)).not.toContain(f.path);
    expect(JSON.parse(await readFile(f.path, 'utf8')).accounts[0].accountId).toBe(registration.accountId);
    await expect(readFile(join(f.vault, '.mcpvault', 'scope-auth.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await client.close(); await server.close(); }
});

test('Vault-contained and linked account files cannot opt into private storage', async () => {
  const f = await fixture();
  const directory = join(f.vault, 'private'); await mkdir(directory);
  const inside = join(directory, 'accounts.json');
  await writeFile(inside, JSON.stringify({ version: 1, accounts: [] }));
  await expect(service(f.vault, inside).register(registration)).rejects.toThrow(/account store/i);
  const alias = join(f.host, 'alias.json'); await link(f.path, alias);
  await expect(service(f.vault, alias).register(registration)).rejects.toThrow(/account store/i);
});
