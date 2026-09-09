import { guidanceError } from './guidance-runtime.js';
import { dirname, isAbsolute } from 'node:path';
import { canonicalRoleplayPath, roleplayInside, validateRoleplayStorage } from './roleplay-storage-host.js';
import { readFederationFile } from './public-federation-storage.js';
import { roleplayAccount } from './roleplay-model.js';
/** Read-only host configuration loader. Never callable with a client-provided path. */
export async function loadRoleplayHostConfig(configPath, expectedVault) {
    if (!isAbsolute(configPath) || !isAbsolute(expectedVault))
        throw guidanceError(new Error('Absolute host configuration and Vault paths required'), 'guid-c09d8b0169449141');
    const canonicalConfig = await canonicalRoleplayPath(configPath, true, true);
    const raw = JSON.parse(await readFederationFile(dirname(canonicalConfig), canonicalConfig, { maxBytes: 8192 }));
    if (!raw || raw.version !== 1 || Object.keys(raw).some(key => !['version', 'vaultPath', 'hostPath', 'administrators'].includes(key)))
        throw guidanceError(new Error('Invalid roleplay host configuration'), 'guid-8f95d014c7e17eab');
    if (typeof raw.vaultPath !== 'string' || typeof raw.hostPath !== 'string' || !isAbsolute(raw.vaultPath) || !isAbsolute(raw.hostPath))
        throw guidanceError(new Error('Absolute roleplay storage paths required'), 'guid-6b06b933cb710d65');
    const { vaultPath, hostPath } = await validateRoleplayStorage(raw);
    if (vaultPath !== await canonicalRoleplayPath(expectedVault, false))
        throw guidanceError(new Error('Roleplay host configuration belongs to another Vault'), 'guid-2982cc42db3aa57c');
    if (!roleplayInside(hostPath, canonicalConfig))
        throw guidanceError(new Error('Roleplay configuration must be in its trusted host directory'), 'guid-015c092b3363c26e');
    if (!Array.isArray(raw.administrators) || raw.administrators.length > 20)
        throw guidanceError(new Error('Explicit administrator accounts array required'), 'guid-b688e0efefa79e81');
    return { vaultPath, hostPath, policy: { administrators: raw.administrators.map(roleplayAccount) } };
}
