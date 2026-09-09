import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const RESERVED_SKILL_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LOCK_MARKER_BYTES = 64;

export interface SkillLockInspection {
  vaultPath: string;
  skillId: string;
  lockPath: string;
  marker: string;
  fingerprint: string;
}

export interface RecoverSkillLockOptions {
  vaultPath: string;
  skillId: string;
  expectedFingerprint: string;
  confirmOwnerStopped: true;
}

export type SkillLockRecovery = SkillLockInspection & { removed: true };

type LockTarget = {
  vaultPath: string;
  skillId: string;
  lockDirectory: string;
  lockPath: string;
};

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function validSkillId(skillId: unknown): asserts skillId is string {
  if (typeof skillId !== 'string' || !SKILL_ID.test(skillId) || RESERVED_SKILL_ID.test(skillId)) {
    throw guidanceError(new Error('Invalid skill transaction skill ID.'), 'guid-bad9384933b91750');
  }
}

async function canonicalDirectory(path: string, root?: string): Promise<string> {
  const expected = resolve(path);
  const entry = await lstat(expected);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw guidanceError(new Error('Skill lock directory must be a canonical directory, not a symbolic link or junction.'), 'guid-2bec3a4ccce119df');
  }
  const canonical = await realpath(expected);
  if (!samePath(canonical, expected) || (root !== undefined && !isInside(root, canonical))) {
    throw guidanceError(new Error('Skill lock directory containment could not be verified.'), 'guid-2ae55546cccec8a9');
  }
  return canonical;
}

async function resolveLockTarget(vaultPath: unknown, skillId: unknown): Promise<LockTarget> {
  if (typeof vaultPath !== 'string' || !vaultPath || vaultPath.includes('\0') || !isAbsolute(vaultPath)) {
    throw guidanceError(new Error('An absolute skill lock vault path is required.'), 'guid-d2a34aff822a3843');
  }
  validSkillId(skillId);
  const requestedVault = resolve(vaultPath);
  const canonicalVault = await canonicalDirectory(requestedVault);
  if (!samePath(canonicalVault, requestedVault)) {
    throw guidanceError(new Error('Skill lock vault must be a canonical directory, not a symbolic link or junction.'), 'guid-c1677caa44647106');
  }
  const lockRoot = await canonicalDirectory(join(canonicalVault, '.mcpvault'), canonicalVault);
  const lockDirectory = await canonicalDirectory(join(lockRoot, 'skill-locks'), canonicalVault);
  const lockPath = join(lockDirectory, `${skillId}.lock`);
  if (!isInside(lockDirectory, lockPath)) throw guidanceError(new Error('Skill lock target containment could not be verified.'), 'guid-87e60e8c125b40be');
  return { vaultPath: canonicalVault, skillId, lockDirectory, lockPath };
}

async function readBoundedMarker(path: string, root: string, label = 'Skill lock'): Promise<string> {
  const expected = resolve(path);
  const entry = await lstat(expected);
  if (!entry.isFile() || entry.isSymbolicLink()) throw guidanceError(new Error(`${label} must be a regular file, not a symbolic link.`), 'guid-3f091baa818feb3e');
  const canonical = await realpath(expected);
  if (!samePath(canonical, expected) || !isInside(root, canonical)) throw guidanceError(new Error(`${label} containment could not be verified.`), 'guid-b0593b305da0dc87');
  if (entry.size > MAX_LOCK_MARKER_BYTES) throw guidanceError(new Error(`${label} marker exceeds the 64-byte bounded read limit.`), 'guid-ccac0bd8dac651d0');

  const handle = await open(expected, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_LOCK_MARKER_BYTES) {
      throw guidanceError(new Error(`${label} marker exceeds the 64-byte bounded read limit.`), 'guid-ccac0bd8dac651d0');
    }
    const buffer = Buffer.alloc(MAX_LOCK_MARKER_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_LOCK_MARKER_BYTES) throw guidanceError(new Error(`${label} marker exceeds the 64-byte bounded read limit.`), 'guid-ccac0bd8dac651d0');
    const bytes = buffer.subarray(0, total);
    const marker = bytes.toString('utf8');
    if (!Buffer.from(marker, 'utf8').equals(bytes)) throw guidanceError(new Error(`${label} marker must be valid UTF-8.`), 'guid-16f9c5eda3a04daf');
    return marker;
  } finally {
    await handle.close();
  }
}

function inspectionFingerprint(target: LockTarget, marker: string): string {
  const normalize = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    vaultPath: normalize(target.vaultPath),
    skillId: target.skillId,
    lockPath: normalize(target.lockPath),
    marker,
  })).digest('hex');
}

async function inspectTarget(target: LockTarget): Promise<SkillLockInspection> {
  const marker = await readBoundedMarker(target.lockPath, target.lockDirectory);
  return {
    vaultPath: target.vaultPath,
    skillId: target.skillId,
    lockPath: target.lockPath,
    marker,
    fingerprint: inspectionFingerprint(target, marker),
  };
}

/** Host-only forensic inspection. This module is not part of the MCP surface. */
export async function inspectSkillLock(vaultPath: string, skillId: string): Promise<SkillLockInspection> {
  return inspectTarget(await resolveLockTarget(vaultPath, skillId));
}

/**
 * Remove one exact leftover lock only after the host has independently stopped
 * its owner. No PID, age, lease, or timeout is treated as permission to steal.
 */
export async function recoverSkillLock(options: RecoverSkillLockOptions): Promise<SkillLockRecovery> {
  if (!options || options.confirmOwnerStopped !== true) {
    throw guidanceError(new Error('Skill lock recovery requires explicit confirmation that the owner is stopped.'), 'guid-33024607e7f7e0d3');
  }
  if (typeof options.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedFingerprint)) {
    throw guidanceError(new Error('Skill lock recovery requires an exact inspection fingerprint.'), 'guid-1340c4d87b9b27b5');
  }

  const target = await resolveLockTarget(options.vaultPath, options.skillId);
  const gatePath = `${target.lockPath}.recovery`;
  const gateMarker = randomUUID();
  let gate: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      gate = await open(gatePath, 'wx', 0o600);
      await gate.writeFile(gateMarker, 'utf8');
      await gate.sync();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw guidanceError(new Error('Another host skill lock recovery is already in progress.'), 'guid-1e2ebd45b08d6b9e');
      }
      throw error;
    }

    const inspected = await inspectTarget(target);
    if (inspected.fingerprint !== options.expectedFingerprint) {
      throw guidanceError(new Error('Skill lock recovery inspection fingerprint changed.'), 'guid-15d1962fb244d4fd');
    }
    const finalInspection = await inspectTarget(target);
    if (finalInspection.fingerprint !== inspected.fingerprint) {
      throw guidanceError(new Error('Skill lock changed during recovery.'), 'guid-ed57d60534ade222');
    }
    await unlink(target.lockPath);
    return { ...finalInspection, removed: true };
  } finally {
    if (gate) {
      await gate.close();
      const currentGateMarker = await readBoundedMarker(gatePath, target.lockDirectory, 'Skill recovery gate');
      if (currentGateMarker !== gateMarker) throw guidanceError(new Error('Skill recovery gate ownership changed.'), 'guid-c90bf04787c862e3');
      await unlink(gatePath);
    }
  }
}
