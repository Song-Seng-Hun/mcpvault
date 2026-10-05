import { guidanceError } from './guidance-runtime.js';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface EnterpriseVaultMarker { version: 1; mode: 'public' | 'company'; realmId: string }
const markerFile = 'enterprise-instance.json';
export function readEnterpriseVaultMarker(vaultPath: string): EnterpriseVaultMarker | undefined {
  const directory = join(resolve(vaultPath), '.mcpvault');
  const path = join(directory, markerFile);
  try {
    if (lstatSync(directory).isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw guidanceError(new Error('linked marker'), 'guid-9ef0afbea86e9fac');
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 4096) throw guidanceError(new Error('invalid marker size'), 'guid-d5dc146d9c8f837e');
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!record || record.version !== 1 || !['public', 'company'].includes(String(record.mode)) || typeof record.realmId !== 'string'
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(record.realmId) || Object.keys(record).some(key => !['version', 'mode', 'realmId'].includes(key))) throw guidanceError(new Error('invalid marker'), 'guid-28148e544f143460');
    return { version: 1, mode: record.mode as EnterpriseVaultMarker['mode'], realmId: record.realmId };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw guidanceError(new Error('Enterprise Vault marker cannot be verified; refusing legacy startup'), 'guid-3124d47ef58e26fb');
  }
}
