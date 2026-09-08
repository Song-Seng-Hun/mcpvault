import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { authorIdentity, resolveActorMention } from './enterprise-identity.js';

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const principal: ScopePrincipal = { accountId: 'a', agentId: 'network', modelId: 'codex', userId: 'u', commandCenterId: 'acme', role: 'agent', enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'r', sharedMemoryEnabled: true } };
const access = new ScopeAccessPolicy({ commandCenterId: 'acme', enterprise: { mode: 'company', realmId: 'acme' } });

test('internal service IO cannot bypass company/global and employee memory boundaries', async () => {
  root = await mkdtemp(join(tmpdir(), 'enterprise-storage-'));
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: '_scopes/users/another/SharedMemory/private.md', content: 'secret' });
  await expect(withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () => fs.readNote('_scopes/users/another/SharedMemory/private.md'))).rejects.toThrow(/enterprise/i);
  await expect(withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () => fs.writeNote({ path: 'Global.md', content: 'company secret' }))).rejects.toThrow(/public|Global/i);
  await withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () => fs.writeNote({ path: '_scopes/users/u/SharedMemory/preferences.md', content: 'approved shared memory' }));
});

test('revocation is checked again at physical write, including asynchronous work', async () => {
  root = await mkdtemp(join(tmpdir(), 'enterprise-storage-'));
  const fs = new FileSystemService(root); let revoked = false;
  await expect(withEnterpriseStorageContext({ access, principal, assertFresh() { if (revoked) throw new Error('revoked'); } }, async () => {
    await Promise.resolve(); revoked = true;
    return fs.writeNote({ path: '_scopes/agents/network/n.md', content: 'should not write' });
  })).rejects.toThrow(/revoked/);
});

test('three Codex roles have exact persistent mentions despite identical biographies', () => {
  const agents = ['network', 'memory', 'research'].map(agentId => ({ ...principal, agentId }));
  expect(new Set(agents.map(p => authorIdentity(p).authorLabel)).size).toBe(3);
  expect(resolveActorMention('@actor:acme:network', agents)).toBe('actor:acme:network');
  expect(() => resolveActorMention('@codex', agents)).toThrow(/ambiguous/);
});

test('physical public projections reject generic and derived writes', async () => {
  root = await mkdtemp(join(tmpdir(), 'enterprise-storage-'));
  const fs = new FileSystemService(root);
  const publicAccess = new ScopeAccessPolicy({ commandCenterId: 'acme', enterprise: { mode: 'public', realmId: 'acme' } });
  const actor = { ...principal, enterprise: { ...principal.enterprise!, mode: 'public' as const } };
  await expect(withEnterpriseStorageContext({ access: publicAccess, principal: actor, assertFresh() {} }, () => fs.writeNote({ path: 'PublicCommunity/Imported/forged.md', content: 'fake actor' }))).rejects.toThrow(/managed/i);
});
