import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnterpriseVaultMarker, readEnterpriseVaultMarker } from './enterprise-vault-marker.js';
import { createServer } from './createServer.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test('enterprise marker refuses legacy createServer and a different mode after restart', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-marker-')); roots.push(vault);
  expect(readEnterpriseVaultMarker(vault)).toBeUndefined();
  await ensureEnterpriseVaultMarker(vault, { mode: 'company', realmId: 'acme' });
  expect(readEnterpriseVaultMarker(vault)).toEqual({ version: 1, mode: 'company', realmId: 'acme' });
  expect(() => createServer(vault)).toThrow(/enterprise|registry/i);
  await expect(ensureEnterpriseVaultMarker(vault, { mode: 'public', realmId: 'acme' })).rejects.toThrow(/different|mismatch/i);
  await expect(ensureEnterpriseVaultMarker(vault, { mode: 'company', realmId: 'acme' })).resolves.toBeUndefined();
});
test('missing Vault can be initialized without storing credentials in its marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-marker-')); roots.push(root);
  const vault = join(root, 'new-vault'); await mkdir(vault);
  await ensureEnterpriseVaultMarker(vault, { mode: 'public', realmId: 'public-acme' });
  expect(Object.keys(readEnterpriseVaultMarker(vault)!)).toEqual(['version', 'mode', 'realmId']);
});
