import { dirname, isAbsolute, relative, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { readFederationFile } from './public-federation-storage.js';
import { roleplayAccount } from './roleplay-model.js';
/** Read-only host configuration loader. Never callable with a client-provided path. */
export async function loadRoleplayHostConfig(configPath, expectedVault) {
    if (!isAbsolute(configPath) || !isAbsolute(expectedVault))
        throw new Error('Absolute host configuration and Vault paths required');
    const canonicalConfig = await realpath(configPath);
    const raw = JSON.parse(await readFederationFile(dirname(canonicalConfig), canonicalConfig, { maxBytes: 8192 }));
    if (!raw || raw.version !== 1 || Object.keys(raw).some(key => !['version', 'vaultPath', 'hostPath', 'administrators'].includes(key)))
        throw new Error('Invalid roleplay host configuration');
    if (typeof raw.vaultPath !== 'string' || typeof raw.hostPath !== 'string' || !isAbsolute(raw.vaultPath) || !isAbsolute(raw.hostPath))
        throw new Error('Absolute roleplay storage paths required');
    const vaultPath = await realpath(raw.vaultPath), hostPath = await realpath(raw.hostPath);
    if (vaultPath !== await realpath(expectedVault))
        throw new Error('Roleplay host configuration belongs to another Vault');
    const configRelative = relative(hostPath, canonicalConfig);
    if (configRelative === '..' || configRelative.startsWith(`..${sep}`) || isAbsolute(configRelative))
        throw new Error('Roleplay configuration must be in its trusted host directory');
    if (!Array.isArray(raw.administrators) || !raw.administrators.length || raw.administrators.length > 20)
        throw new Error('Explicit administrator accounts required');
    return { vaultPath, hostPath, policy: { administrators: raw.administrators.map(roleplayAccount) } };
}
