import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { checkWindowsPrivateAcl } from './windows-private-acl.js';

/** Validate metadata only, before opening the account database. Never fixes ACLs
 * or creates a missing store: explicit operator provisioning is required. */
export async function assertPrivateAccountStore(vaultPath: string, path: string): Promise<void> {
  try {
    const directory = dirname(path);
    await validateRoleplayStorage({ vaultPath, hostPath: directory });
    await canonicalRoleplayPath(path, true, true);
    if ((await lstat(path)).nlink !== 1) throw new Error('linked file');
    if (process.platform === 'win32') await checkWindowsPrivateAcl([directory, path], true);
    else await assertHostPrivateStorage([directory, path]);
  } catch {
    throw new Error('Private account store is missing, unsafe or unavailable; host provisioning is required');
  }
}
