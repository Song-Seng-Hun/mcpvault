import { canonicalHostPath, validateHostStorage, readHostFile } from './host-storage.js';
import { guidanceError } from './guidance-runtime.js';
import { dirname } from 'node:path';
import { OwnerActivityPolicy } from './owner-activity.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';

/** Reloadable host consent data only. This file cannot attest a model runtime,
 * create execution identities or relax independent document permissions. */
export async function loadOwnerActivityHostConfig(path: string, expectedVault: string): Promise<{
  policy: () => OwnerActivityPolicy; refresh: () => Promise<void>;
}> {
  const canonical = await canonicalHostPath(path, true, true);
  const { vaultPath, hostPath } = await validateHostStorage({ vaultPath: expectedVault, hostPath: dirname(canonical) });
  const denied = new OwnerActivityPolicy({ version: 1, owners: {}, grants: [] });
  let current = denied;
  let queue = Promise.resolve();
  const refresh = () => {
    const read = async () => {
      try {
        await canonicalHostPath(canonical, true, true);
        await assertHostPrivateStorage([hostPath, canonical]);
        const raw = JSON.parse(await readHostFile(hostPath, canonical, { maxBytes: 256 * 1024 }));
        await assertHostPrivateStorage([hostPath, canonical]);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.vaultPath !== 'string'
          || await canonicalHostPath(raw.vaultPath, false) !== vaultPath) throw guidanceError(new Error('Owner consent belongs to another Vault'), 'guid-77083bace6dff5c5');
        const { vaultPath: _vault, ...definition } = raw;
        current = new OwnerActivityPolicy(definition);
      } catch (error) { current = denied; throw error; }
    };
    const pending = queue.then(read, read);
    queue = pending.catch(() => undefined);
    return pending;
  };
  await refresh();
  return Object.freeze({ policy: () => current, refresh });
}
