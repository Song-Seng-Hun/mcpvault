import { canonicalHostPath, validateHostStorage } from './host-storage.js';
import { guidanceError } from './guidance-runtime.js';
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { checkWindowsPrivateAcl } from './windows-private-acl.js';
/** Validate metadata only, before opening the account database. Never fixes ACLs
 * or creates a missing store: explicit operator provisioning is required. */
export async function assertPrivateAccountStore(vaultPath, path) {
    try {
        const directory = dirname(path);
        await validateHostStorage({ vaultPath, hostPath: directory });
        await canonicalHostPath(path, true, true);
        if ((await lstat(path)).nlink !== 1)
            throw guidanceError(new Error('linked file'), 'guid-9d32d5dde50a813a');
        if (process.platform === 'win32')
            await checkWindowsPrivateAcl([directory, path], true);
        else
            await assertHostPrivateStorage([directory, path]);
    }
    catch {
        throw guidanceError(new Error('Private account store is missing, unsafe or unavailable; host provisioning is required'), 'guid-9cd0b39c6022a8b0');
    }
}
