import { guidanceError } from './guidance-runtime.js';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
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

export async function ensureEnterpriseVaultMarker(vaultPath: string, profile: Omit<EnterpriseVaultMarker, 'version'>): Promise<void> {
  if (!['public', 'company'].includes(profile.mode) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile.realmId)) throw guidanceError(new Error('Invalid enterprise marker profile'), 'guid-a21007e4a4f02f61');
  const existing = readEnterpriseVaultMarker(vaultPath);
  if (existing) {
    if (existing.mode !== profile.mode || existing.realmId !== profile.realmId) throw guidanceError(new Error('Vault is already bound to a different enterprise instance'), 'guid-12e2ead8cdd1ac54');
    return;
  }
  const directory = join(resolve(vaultPath), '.mcpvault');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw guidanceError(new Error('Enterprise marker directory cannot be a symbolic link or junction'), 'guid-2eee09652f7b1223');
  let file;
  try { file = await open(join(directory, markerFile), 'wx', 0o600); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      const current = readEnterpriseVaultMarker(vaultPath);
      if (current?.mode === profile.mode && current.realmId === profile.realmId) return;
    }
    throw error;
  }
  try { await file.writeFile(`${JSON.stringify({ version: 1, mode: profile.mode, realmId: profile.realmId })}\n`, 'utf8'); await file.sync(); }
  finally { await file.close(); }
}
