import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import { canonicalHostPath, isUNCPath, readHostFile } from './host-storage.js';

export const ROLEPLAY_HOST_IDENTITY_FILE = 'roleplay-host-identity.json';
const missing = (e: unknown): boolean => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Durable, random identity provisioned only in the verified LOCAL host directory.
 * Preserve it across restarts. Do not copy it to another host with a checkpoint.
 * Hostname binding additionally fails closed on a moved file or renamed host;
 * uniqueness comes from the local UUID, not hostname or PID. Empty/torn files
 * are forensic failures and are never regenerated automatically. */
export async function roleplayHostIdentity(hostPath: string, create = false): Promise<string | undefined> {
  await canonicalHostPath(hostPath, true);
  const path = join(hostPath, ROLEPLAY_HOST_IDENTITY_FILE);
  const machine = digest({ hostname: hostname().toLowerCase(), platform: platform() });
  if (create) {
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (e) { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e; }
    if (handle) {
      try { await handle.writeFile(JSON.stringify({ version: 1, id: randomUUID(), machine })); await handle.sync(); }
      finally { await handle.close(); }
    }
  }
  let raw: string;
  try {
    await canonicalHostPath(path, true, true);
    if ((await lstat(path)).nlink !== 1) throw guidanceError(new Error('Roleplay host identity must be an unshared local file; host review required'), 'guid-955b01ad6d6a5a61');
    raw = await readHostFile(hostPath, path, { maxBytes: 1024 });
  } catch (e) { if (!create && missing(e)) return undefined; throw e; }
  let identity;
  try { identity = JSON.parse(raw); } catch { throw guidanceError(new Error('Roleplay host identity is invalid; forensic host review required'), 'guid-c277db54ecf9ed54'); }
  if (identity?.version !== 1 || typeof identity.id !== 'string' || !/^[a-f0-9-]{36}$/.test(identity.id) || identity.machine !== machine) {
    throw guidanceError(new Error('Roleplay host identity mismatch or invalid identity; forensic host review required'), 'guid-077201252db63bd2');
  }
  return digest(identity);
}

export function assertRoleplayRecoveryHost(vault: string, writerHost: unknown, localHost: string | undefined): void {
  if (writerHost === undefined && !isUNCPath(vault)) return; // Legacy LOCAL PID locks only.
  if (typeof writerHost !== 'string' || !/^[a-f0-9]{64}$/.test(writerHost) || !localHost || writerHost !== localHost) {
    throw guidanceError(new Error('Roleplay writer host identity is missing or mismatched; explicit originating host review required'), 'guid-53a5871330e81ee0');
  }
}
