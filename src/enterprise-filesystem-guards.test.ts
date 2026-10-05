import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
};
const access = new ScopeAccessPolicy({ commandCenterId: 'acme' });

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
