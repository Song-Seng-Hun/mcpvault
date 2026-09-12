import { dirname } from 'node:path';
import { DEFAULT_HOST_FEATURE_CONFIG, parseHostFeatureConfig, type HostFeatureConfig } from './host-features.js';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile } from './public-federation-storage.js';

/** Startup-only immutable selection. Editing a file never changes a running
 * service graph. Feature selection is not a document or execution grant. */
export async function loadHostFeatureConfig(path: string | undefined, vaultPath: string): Promise<HostFeatureConfig> {
  if (path === undefined) return DEFAULT_HOST_FEATURE_CONFIG;
  const canonical = await canonicalRoleplayPath(path, true, true);
  const { hostPath } = await validateRoleplayStorage({ vaultPath, hostPath: dirname(canonical) });
  await assertHostPrivateStorage([hostPath, canonical]);
  const raw = await readFederationFile(hostPath, canonical, { maxBytes: 16 * 1024 });
  await assertHostPrivateStorage([hostPath, canonical]);
  return parseHostFeatureConfig(JSON.parse(raw));
}
