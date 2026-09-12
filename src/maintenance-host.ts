import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PathFilter } from './pathfilter.js';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile, removeFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';

export const MAINTENANCE_OPERATIONS = ['cache_refresh', 'managed_canvas_regenerate', 'moved_link_repair'] as const;
export type MaintenanceOperation = typeof MAINTENANCE_OPERATIONS[number];
export interface MaintenanceConfig {
  version: 1;
  enabled: boolean;
  accountId: string;
  paths: string[];
  operations: MaintenanceOperation[];
}
export interface MaintenanceWriter { assertHeld(): Promise<void>; close(): Promise<void> }
export interface MaintenanceHost {
  refresh(): Promise<MaintenanceConfig>;
  readState(): Promise<unknown | undefined>;
  writeState(value: unknown): Promise<void>;
  acquire(): Promise<MaintenanceWriter>;
}
export const MAX_MAINTENANCE_STATE_BYTES = 4 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
interface PrivateSnapshot { raw: string | undefined; revision: string; identity: BigIntStats | undefined }
const sameIdentity = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;
// Include write/permission metadata, not just the inode: an in-place rewrite
// during an awaited read must not approve the bytes read before that rewrite.
const sameSnapshot = (left: BigIntStats | undefined, right: BigIntStats | undefined): boolean =>
  left === undefined || right === undefined ? left === right
    : sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs
      && left.ctimeNs === right.ctimeNs && left.birthtimeNs === right.birthtimeNs
      && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink;

/** Exact logical paths only. No inherited folder, wildcard or model authority. */
export function validateMaintenanceConfig(value: unknown): MaintenanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid maintenance configuration');
  const raw = value as Record<string, unknown>;
  const keys = ['version', 'enabled', 'accountId', 'paths', 'operations'];
  if (Object.keys(raw).some(key => !keys.includes(key)) || raw.version !== 1 || typeof raw.enabled !== 'boolean'
    || typeof raw.accountId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(raw.accountId)) throw new Error('Maintenance requires an explicit current account and supported configuration fields');
  const filter = new PathFilter();
  if (!Array.isArray(raw.paths) || raw.paths.length < 1 || raw.paths.length > 128) throw new Error('Maintenance requires 1..128 exact paths');
  const paths = raw.paths.map(path => {
    if (typeof path !== 'string' || !path || path.length > 400 || /[\\:*?"<>|\x00-\x1f]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || !filter.isAllowed(path)) throw new Error('Maintenance path must be exact, canonical and permitted');
    return path;
  });
  if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length) throw new Error('Maintenance paths must be unique');
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 3
    || raw.operations.some(op => !(MAINTENANCE_OPERATIONS as readonly unknown[]).includes(op))
    || new Set(raw.operations).size !== raw.operations.length) throw new Error('Maintenance operations must be an explicit fixed allow list');
  return { version: 1, enabled: raw.enabled, accountId: raw.accountId, paths, operations: [...raw.operations] as MaintenanceOperation[] };
}

/** Host-only durable receipts/backups; never use a Vault/repository fallback. */
export async function loadMaintenanceHostConfig(path: string, expectedVault: string): Promise<MaintenanceHost> {
  const canonical = await canonicalRoleplayPath(path, true, true);
  const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: expectedVault, hostPath: dirname(canonical) });
  const identity = hash(vaultPath.toLowerCase());
  const statePath = join(hostPath, `maintenance-${identity}.json`);
  const lockPath = join(hostPath, `maintenance-${identity}.writer.lock`);
  if ([statePath, lockPath].some(target => target.toLowerCase() === canonical.toLowerCase())) throw new Error('Maintenance configuration overlaps managed host storage');
  let active: MaintenanceWriter | undefined;
  let stateRevision: PrivateSnapshot | undefined;
  const privateFile = async (target: string, optional = false) => {
    try {
      await canonicalRoleplayPath(target, true, true);
      if ((await lstat(target)).nlink !== 1) throw new Error('Maintenance host files cannot be shared hard links');
      await assertHostPrivateStorage([hostPath, target]);
    } catch (error) { if (!optional || !missing(error)) throw error; }
  };
  const refresh = async () => {
    if (await canonicalRoleplayPath(hostPath, true) !== hostPath) throw new Error('Maintenance host binding changed');
    await privateFile(canonical);
    const raw = JSON.parse(await readFederationFile(hostPath, canonical, { maxBytes: 128 * 1024 }));
    await privateFile(canonical);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.vaultPath !== 'string'
      || await canonicalRoleplayPath(raw.vaultPath, false) !== vaultPath) throw new Error('Maintenance configuration belongs to another Vault');
    const { vaultPath: _vault, ...definition } = raw;
    return validateMaintenanceConfig(definition);
  };
  const fileIdentity = (target: string, optional = false): BigIntStats | undefined => {
    try {
      const info = lstatSync(target, { bigint: true });
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('Maintenance host symbolic-link or file binding changed');
      if (info.nlink !== 1n) throw new Error('Maintenance host files cannot be shared hard links');
      return info;
    } catch (error) { if (optional && missing(error)) return undefined; throw error; }
  };
  const readPrivateSnapshot = async (target: string, maxBytes: number, optional = false): Promise<PrivateSnapshot> => {
    await privateFile(target, optional);
    const before = fileIdentity(target, optional);
    let raw: string | undefined;
    if (before !== undefined) raw = await readFederationFile(hostPath, target, { maxBytes });
    await privateFile(target, optional);
    const after = fileIdentity(target, optional);
    if (!sameSnapshot(before, after)) throw new Error('Maintenance host file binding or contents changed while reading');
    return { raw, revision: raw === undefined ? 'missing' : hash(raw), identity: after };
  };
  const readRawState = () => readPrivateSnapshot(statePath, MAX_MAINTENANCE_STATE_BYTES, true);
  await refresh();
  return Object.freeze({
    refresh,
    readState: async () => {
      await refresh();
      const snapshot = await readRawState();
      const result: unknown = snapshot.raw === undefined ? undefined : JSON.parse(snapshot.raw);
      stateRevision = snapshot;
      return result;
    },
    writeState: async (value: unknown) => {
      if (!active || stateRevision === undefined) throw new Error('Read maintenance state and hold its writer before saving');
      // Bind this write to its starting lease/revision; a concurrent read must
      // not silently replace the revision against which it is compared.
      const writer = active, expected = stateRevision;
      const content = JSON.stringify(value);
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_MAINTENANCE_STATE_BYTES) throw new Error('Maintenance receipt storage is full; preserve existing history for host review');
      await writeFederationFileAtomic(hostPath, statePath, content, { maxBytes: MAX_MAINTENANCE_STATE_BYTES, beforeCommit: async () => {
        await writer.assertHeld();
        const current = await readRawState();
        if (current.revision !== expected.revision || !sameSnapshot(current.identity, expected.identity)) throw new Error('Maintenance host history changed; preserve it for review');
        // Approval/ownership IO can yield after the state read. Recheck it,
        // then fence the state synchronously before returning to atomic IO.
        await writer.assertHeld();
        if (active !== writer || !sameSnapshot(fileIdentity(statePath, true), current.identity)) throw new Error('Maintenance host history changed; preserve it for review');
      } });
      const saved = await readRawState();
      if (saved.revision !== hash(content)) throw new Error('Maintenance host history changed after saving; preserve it for review');
      stateRevision = saved;
    },
    acquire: async () => {
      if (active || !(await refresh()).enabled) throw new Error('Maintenance writer already held or disabled');
      const nonce = randomUUID();
      let handle: FileHandle;
      try { handle = await open(lockPath, 'wx', 0o600); }
      catch { throw new Error('Maintenance writer unavailable; existing markers require host review, never automatic stealing'); }
      const marker = { version: 1, vault: identity, pid: process.pid, nonce };
      let held: BigIntStats;
      try { await handle.writeFile(JSON.stringify(marker)); await handle.sync(); held = await handle.stat({ bigint: true }); }
      catch (error) { await handle.close(); throw error; }
      let closed = false, closing: Promise<void> | undefined;
      const ownership = async () => {
        const snapshot = await readPrivateSnapshot(lockPath, 2048);
        const current = snapshot.identity, raw = JSON.parse(snapshot.raw!);
        if (!current || !sameIdentity(held, current)
          || raw.version !== 1 || raw.vault !== identity || raw.pid !== process.pid || raw.nonce !== nonce) throw new Error('Maintenance writer ownership changed');
      };
      const writer: MaintenanceWriter = {
        assertHeld: async () => {
          if (closed || closing || !(await refresh()).enabled) throw new Error('Maintenance writer closed or approval revoked');
          await ownership();
        },
        close: () => closing ??= (async () => {
          try {
            await ownership(); await handle.close(); closed = true;
            // The captured descriptor identity survives handle.close(). Check
            // it again inside removal, not only before its awaited preparation.
            await removeFederationFile(hostPath, lockPath, ownership);
          } finally {
            if (!closed) { await handle.close(); closed = true; }
            if (active === writer) active = undefined;
          }
        })(),
      };
      active = writer;
      return writer;
    },
  });
}
