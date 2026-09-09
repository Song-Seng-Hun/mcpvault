import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { hostname, platform } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFederationFile } from './public-federation-storage.js';

export const ROLEPLAY_HOST_IDENTITY_FILE = 'roleplay-host-identity.json';
export const roleplayIsUNC = (path: string): boolean => /^(?:\\\\|\/\/)/.test(path);
export const roleplayInside = (root: string, path: string): boolean => {
  const r = relative(root, path); return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};
const missing = (e: unknown): boolean => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Inspect lexical ancestors BEFORE realpath can hide a junction. Host-provisioned
 * roots must exist; device namespaces and dot segments are not storage aliases. */
export async function canonicalRoleplayPath(path: string, local: boolean, file = false): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || /^(?:\\\\|\/\/)[?.][\\/]/.test(path)
    || path.split(/[\\/]+/).some(part => part === '.' || part === '..')) throw guidanceError(new Error('Roleplay needs canonical absolute storage paths without device aliases or dot segments'), 'guid-b778d07e4fe47825');
  if (local && roleplayIsUNC(path)) throw guidanceError(new Error('Roleplay host storage must be local and outside Vault/source'), 'guid-12501d308b72a4de');
  const root = parse(path).root;
  let current = root;
  const parts = path.slice(root.length).split(/[\\/]+/).filter(Boolean);
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = join(current, parts[i]!);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw guidanceError(new Error('Roleplay storage refuses symbolic-link or junction path components'), 'guid-c214792552584bc2');
    if (file && i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw guidanceError(new Error('Roleplay storage path has an invalid file type'), 'guid-79de38f9d85b981c');
  }
  const canonical = await realpath(path);
  if (local && roleplayIsUNC(canonical)) throw guidanceError(new Error('Roleplay host storage must be canonical local storage'), 'guid-2045390514d0533e');
  return canonical;
}

// Include every enclosing package, so a frozen .mcpvault/deployments/.../dist
// runtime cannot mistake its own release directory for the only source boundary.
async function sourceRoots(): Promise<string[]> {
  const roots: string[] = [];
  let current = dirname(dirname(fileURLToPath(import.meta.url)));
  roots.push(await realpath(current));
  while (true) {
    try { if ((await lstat(join(current, 'package.json'))).isFile()) roots.push(await realpath(current)); }
    catch (e) { if (!missing(e)) throw e; }
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return roots;
}
let sources: Promise<string[]> | undefined;
export async function validateRoleplayStorage(options: { vaultPath: string; hostPath: string }): Promise<{ vaultPath: string; hostPath: string }> {
  // Reject a network host root before even resolving the Vault.
  const hostPath = await canonicalRoleplayPath(options.hostPath, true);
  const vaultPath = await canonicalRoleplayPath(options.vaultPath, false);
  if (roleplayInside(vaultPath, hostPath) || roleplayInside(hostPath, vaultPath)
    || (await (sources ??= sourceRoots())).some(source => roleplayInside(source, hostPath))) {
    throw guidanceError(new Error('Roleplay checkpoint must be local and outside Vault/source'), 'guid-febc054cac933e9e');
  }
  return { vaultPath, hostPath };
}

/** Durable, random identity provisioned only in the verified LOCAL host directory.
 * Preserve it across restarts. Do not copy it to another host with a checkpoint.
 * Hostname binding additionally fails closed on a moved file or renamed host;
 * uniqueness comes from the local UUID, not hostname or PID. Empty/torn files
 * are forensic failures and are never regenerated automatically. */
export async function roleplayHostIdentity(hostPath: string, create = false): Promise<string | undefined> {
  await canonicalRoleplayPath(hostPath, true);
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
    await canonicalRoleplayPath(path, true, true);
    if ((await lstat(path)).nlink !== 1) throw guidanceError(new Error('Roleplay host identity must be an unshared local file; host review required'), 'guid-955b01ad6d6a5a61');
    raw = await readFederationFile(hostPath, path, { maxBytes: 1024 });
  } catch (e) { if (!create && missing(e)) return undefined; throw e; }
  let identity;
  try { identity = JSON.parse(raw); } catch { throw guidanceError(new Error('Roleplay host identity is invalid; forensic host review required'), 'guid-c277db54ecf9ed54'); }
  if (identity?.version !== 1 || typeof identity.id !== 'string' || !/^[a-f0-9-]{36}$/.test(identity.id) || identity.machine !== machine) {
    throw guidanceError(new Error('Roleplay host identity mismatch or invalid identity; forensic host review required'), 'guid-077201252db63bd2');
  }
  return digest(identity);
}

export function assertRoleplayRecoveryHost(vault: string, writerHost: unknown, localHost: string | undefined): void {
  if (writerHost === undefined && !roleplayIsUNC(vault)) return; // Legacy LOCAL PID locks only.
  if (typeof writerHost !== 'string' || !/^[a-f0-9]{64}$/.test(writerHost) || !localHost || writerHost !== localHost) {
    throw guidanceError(new Error('Roleplay writer host identity is missing or mismatched; explicit originating host review required'), 'guid-53a5871330e81ee0');
  }
}
