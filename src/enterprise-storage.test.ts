import { expect, test } from 'vitest';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { assertEnterpriseStorageAccess, canReadEnterpriseStoragePath, prepareDocumentWrite, withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { authorIdentity, resolveActorMention } from './enterprise-identity.js';
import { FileSystemService } from './filesystem.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const principal: ScopePrincipal = { accountId: 'a', agentId: 'network', modelId: 'codex', userId: 'u', commandCenterId: 'acme', role: 'agent' };

test('three Codex roles have exact persistent mentions despite identical biographies', () => {
  const agents = ['network', 'memory', 'research'].map(agentId => ({ ...principal, agentId }));
  expect(new Set(agents.map(p => authorIdentity(p).authorLabel)).size).toBe(3);
  expect(resolveActorMention('@actor:acme:network', agents)).toBe('actor:acme:network');
  expect(() => resolveActorMention('@codex', agents)).toThrow(/ambiguous/);
});

test('nested storage contexts intersect owner predicates and preserve both freshness and write hooks', async () => {
  const events: string[] = [];
  const ownerAccess = new ScopeAccessPolicy();
  await withEnterpriseStorageContext({ access: ownerAccess, assertFresh() { events.push('outer-fresh'); },
    canAccessPath: path => path === 'Shared/allowed.md' || path === 'Shared/outer-only.md',
    canTraversePath: path => path === 'Shared',
    beforeWrite: async path => { events.push(`outer-write:${path}`); },
  }, () => withEnterpriseStorageContext({ access: ownerAccess, assertFresh() { events.push('inner-fresh'); },
    canAccessPath: path => path === 'Shared/allowed.md' || path === 'Shared/inner-only.md',
    canTraversePath: path => path === 'Shared',
    beforeWrite: async path => { events.push(`inner-write:${path}`); },
  }, async () => {
    expect(canReadEnterpriseStoragePath('Shared/allowed.md')).toBe(true);
    expect(canReadEnterpriseStoragePath('Shared/outer-only.md')).toBe(false);
    expect(canReadEnterpriseStoragePath('Shared/inner-only.md')).toBe(false);
    expect(() => assertEnterpriseStorageAccess('Shared/outer-only.md')).toThrow(/owner activity/i);
    expect(() => assertEnterpriseStorageAccess('Shared/inner-only.md')).toThrow(/owner activity/i);
    await prepareDocumentWrite('Shared/allowed.md');
  }));

  expect(events).toContain('outer-fresh');
  expect(events).toContain('inner-fresh');
  expect(events).toContain('outer-write:Shared/allowed.md');
  expect(events).toContain('inner-write:Shared/allowed.md');
});

test('access revoked during the write barrier leaves no folders from a note write or move', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    const before = await readdir(vault, { recursive: true });
    // Admitted when resolved; revoked by the barrier, as an owner refresh would.
    let revoked = false;
    const context = { access: new ScopeAccessPolicy(), assertFresh() {}, beforeWrite: async () => { revoked = true; },
      canAccessPath: (path: string) => !(revoked && path.startsWith('Deep/')) };
    const attempt = (write: () => Promise<unknown>) => { revoked = false; return withEnterpriseStorageContext(context, write); };
    await expect(attempt(() => fs.writeNote({ path: 'Deep/Folder/Note.md', content: '# Note\n' }))).rejects.toThrow(/owner activity/i);
    const revision = (await fs.readNote('Source.md')).revision;
    expect(await attempt(() => fs.moveNote({ oldPath: 'Source.md', newPath: 'Deep/Moved/Source.md', expectedRevision: revision }))).toMatchObject({ success: false });
    expect(await readdir(vault, { recursive: true })).toEqual(before);
  } finally { await rm(vault, { recursive: true, force: true }); }
});
