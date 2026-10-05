import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnterpriseVaultMarker } from './enterprise-vault-marker.js';
import { createServer } from '../tests/server-fixture.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test('an enterprise-bound Vault refuses createServer instead of opening without realm ACLs', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-marker-')); roots.push(vault);
  expect(readEnterpriseVaultMarker(vault)).toBeUndefined();
  await mkdir(join(vault, '.mcpvault'));
  await writeFile(join(vault, '.mcpvault', 'enterprise-instance.json'), `${JSON.stringify({ version: 1, mode: 'company', realmId: 'acme' })}\n`);
  expect(readEnterpriseVaultMarker(vault)).toEqual({ version: 1, mode: 'company', realmId: 'acme' });
  expect(() => createServer(vault)).toThrow(/enterprise/i);
});
test('an unverifiable marker also refuses startup', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-marker-')); roots.push(vault);
  await mkdir(join(vault, '.mcpvault'));
  await writeFile(join(vault, '.mcpvault', 'enterprise-instance.json'), '{"version":1,"mode":"company","realmId":"acme","secret":"x"}');
  expect(() => createServer(vault)).toThrow(/enterprise/i);
});
