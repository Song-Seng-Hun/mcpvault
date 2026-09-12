import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import type { ScopePrincipal } from './scope-auth.js';

let root: string;
let fileSystem: FileSystemService;

const principal: ScopePrincipal = {
  accountId: 'account-one', agentId: 'agent-one', userId: 'employee-one', modelId: 'codex', commandCenterId: 'acme', role: 'agent',
  enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'runtime-one', sharedMemoryEnabled: true },
};
const access = new ScopeAccessPolicy({ commandCenterId: 'acme', enterprise: { mode: 'company', realmId: 'acme' } });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'enterprise-filesystem-guards-'));
  fileSystem = new FileSystemService(root);
  await fileSystem.writeNote({ path: 'Global.md', content: '# Global\n' });
  await fileSystem.writeNote({ path: 'Folder/Visible.md', content: '# Visible\n' });
  await fileSystem.writeNote({ path: '_scopes/users/employee-one/SharedMemory/Own.md', content: '# Own\n' });
  await fileSystem.writeNote({ path: '_scopes/users/employee-two/SharedMemory/Other.md', content: '# Other\n' });
  await fileSystem.writeNote({ path: 'Community/Legacy.md', content: '# Legacy\n' });
  await fileSystem.writeNote({ path: 'PublicCommunity/Local.md', content: '# Local\n' });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('every direct read, stat, list, and query path rechecks enterprise freshness', async () => {
  const operations: Array<() => Promise<unknown>> = [
    () => fileSystem.noteExists('Global.md'),
    () => fileSystem.exists('Global.md'),
    () => fileSystem.isDirectory('Folder'),
    () => fileSystem.listDirectory(''),
    () => fileSystem.getNoteOutline('Global.md'),
    () => fileSystem.readNoteLineWindow({ path: 'Global.md', startLine: 1, endLine: 1 }),
    () => fileSystem.queryNotes({ limit: 10, includeContent: true }),
    () => fileSystem.getVaultStats(),
  ];

  for (const operation of operations) {
    await expect(withEnterpriseStorageContext({ access, principal, assertFresh() { throw new Error('revoked before physical IO'); } }, operation))
      .rejects.toThrow(/revoked before physical IO/);
  }
});

test('filesystem scans omit paths outside the enterprise principal boundary even without a caller filter', async () => {
  const result = await withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () =>
    fileSystem.queryNotes({ limit: 20, includeContent: true }));
  expect(result.notes.map(note => note.path)).toContain('_scopes/users/employee-one/SharedMemory/Own.md');
  expect(result.notes.map(note => note.path)).not.toContain('_scopes/users/employee-two/SharedMemory/Other.md');

  const stats = await withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () =>
    fileSystem.getVaultStats(20));
  expect(stats.recentlyModified.map(note => note.path)).toContain('_scopes/users/employee-one/SharedMemory/Own.md');
  expect(stats.recentlyModified.map(note => note.path)).not.toContain('_scopes/users/employee-two/SharedMemory/Other.md');
});

test('canonical read authorization rejects an allowed junction alias into another employee scope', async () => {
  await symlink(
    join(root, '_scopes', 'users', 'employee-two', 'SharedMemory'),
    join(root, 'OtherEmployeeAlias'),
    'junction',
  );
  const operations: Array<() => Promise<unknown>> = [
    () => fileSystem.readNote('OtherEmployeeAlias/Other.md'),
    () => fileSystem.noteExists('OtherEmployeeAlias/Other.md'),
    () => fileSystem.exists('OtherEmployeeAlias/Other.md'),
    () => fileSystem.listDirectory('OtherEmployeeAlias'),
  ];
  for (const operation of operations) {
    await expect(withEnterpriseStorageContext({ access, principal, assertFresh() {} }, operation))
      .rejects.toThrow(/access denied|unavailable/i);
  }
  const rootListing = await withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () =>
    fileSystem.listDirectory(''));
  expect(rootListing.directories).not.toContain('OtherEmployeeAlias');

  const hiddenDirectory = join(root, '.private-system');
  await mkdir(hiddenDirectory, { recursive: true });
  await writeFile(join(hiddenDirectory, 'Secret.md'), '# restricted\n');
  await symlink(hiddenDirectory, join(root, 'RestrictedAlias'), 'junction');
  await expect(withEnterpriseStorageContext({ access, principal, assertFresh() {} }, () =>
    fileSystem.readNote('RestrictedAlias/Secret.md'))).rejects.toThrow(/canonical target is restricted/i);
});

test('directory listings filter children that belong to an inaccessible enterprise scope', async () => {
  const publicPrincipal: ScopePrincipal = {
    ...principal,
    enterprise: { ...principal.enterprise!, mode: 'public' },
  };
  const publicAccess = new ScopeAccessPolicy({ commandCenterId: 'acme', enterprise: { mode: 'public', realmId: 'acme' } });
  const listing = await withEnterpriseStorageContext({ access: publicAccess, principal: publicPrincipal, assertFresh() {} }, () =>
    fileSystem.listDirectory(''));
  expect(listing.directories).toContain('PublicCommunity');
  expect(listing.directories).not.toContain('Community');
});

test('physical owner predicates receive canonical slash-separated Vault paths on Windows', async () => {
  const checked: string[] = [];
  const note = await withEnterpriseStorageContext({ access, principal, assertFresh() {},
    canAccessPath(path) { checked.push(path); return path === 'Folder/Visible.md'; },
    canTraversePath: () => true,
  }, () => fileSystem.readNote('Folder/Visible.md'));

  expect(note.originalContent).toContain('# Visible');
  expect(checked).toContain('Folder/Visible.md');
  expect(checked.every(path => !path.includes('\\'))).toBe(true);

  const writeChecks: string[] = [];
  await withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh() {},
    canAccessPath(path) { writeChecks.push(path); return !path.includes('\\'); },
    canTraversePath: () => true,
    beforeWrite: async path => { writeChecks.push(path); },
  }, () => fileSystem.writeNote({ path: 'Folder/New.md', content: '# New\n' }));
  expect(writeChecks).toContain('Folder/New.md');
  expect(writeChecks.every(path => !path.includes('\\'))).toBe(true);
});
