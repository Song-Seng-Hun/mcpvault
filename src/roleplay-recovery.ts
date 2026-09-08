import { randomUUID } from 'node:crypto';
import { lstat, link, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ensureFederationDirectory, readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
import { roleplayHash } from './roleplay-model.js';
import { ROLEPLAY_ROOT, canonicalTurnNames, type RoleplayStoreOptions } from './roleplay-store.js';

interface RecoveryGate { version: 1; pid: number; nonce: string; vault: string; startedAt: string }
interface WriterLock { pid: number; nonce: string; vault: string }
interface Checkpoint { version: 1; vault: string; sequence: number; hash: string; pending?: { sequence: number; hash: string } }
const missing = (e: unknown) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const inside = (root: string, path: string) => { const value = relative(root, path); return !value || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); };

async function optional(root: string, path: string, maxBytes: number): Promise<string | undefined> {
  try { return await readFederationFile(root, path, { maxBytes }); }
  catch (e) { if (missing(e)) return undefined; throw e; }
}

function parseCheckpoint(raw: string | undefined, vault: string): Checkpoint {
  if (!raw) throw new Error('Roleplay checkpoint missing; manual forensic recovery required');
  const checkpoint = JSON.parse(raw) as Checkpoint;
  if (checkpoint.version !== 1 || checkpoint.vault !== vault || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 || checkpoint.sequence > 10000 || !hash(checkpoint.hash)) throw new Error('Roleplay checkpoint invalid; manual forensic recovery required');
  if (checkpoint.pending && (checkpoint.pending.sequence !== checkpoint.sequence + 1 || !hash(checkpoint.pending.hash))) throw new Error('Roleplay pending checkpoint invalid; manual forensic recovery required');
  return checkpoint;
}

function canonicalNames(entries: readonly string[]): string[] {
  if (entries.length > 10000 || entries.some(name => !/^\d{10}\.md$/.test(name))) throw new Error('Roleplay turns contain non-canonical entries; manual forensic recovery required');
  const names = [...entries].sort();
  for (let index = 0; index < names.length; index++) if (names[index] !== `${String(index + 1).padStart(10, '0')}.md`) throw new Error('Roleplay turn sequence gap or fork');
  return names;
}

const deadProcess = async (pid: number): Promise<boolean> => {
  try { process.kill(pid, 0); return false; }
  catch (e) { if (e && typeof e === 'object' && 'code' in e && e.code === 'ESRCH') return true; throw new Error('Cannot establish recovery process death'); }
};

async function assertRecoveryGate(path: string, gate: RecoveryGate): Promise<void> {
  const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error('Recovery gate symlink refused');
  const current = JSON.parse(await readFederationFile(dirname(path), path, { maxBytes: 1024 })) as RecoveryGate;
  if (current.nonce !== gate.nonce || current.pid !== gate.pid || current.vault !== gate.vault) throw new Error('Recovery gate fencing failed');
}

async function releaseRecoveryGate(path: string, gate: RecoveryGate): Promise<void> {
  await assertRecoveryGate(path, gate); await unlink(path);
}

/** Atomic hard-link ownership leaves no empty exclusive-create recovery gate. */
async function acquireRecoveryGate(vault: string, path: string): Promise<RecoveryGate> {
  const gate: RecoveryGate = { version: 1, pid: process.pid, nonce: randomUUID(), vault, startedAt: new Date().toISOString() };
  const temporary = join(dirname(path), `.roleplay-recovery-${gate.nonce}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(gate), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, path); return gate;
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST') throw new Error('Recovery gate already exists; automatic stale-gate deletion is unsafe. Require explicit offline forensic recovery');
    throw e;
  } finally { try { await unlink(temporary); } catch (e) { if (!missing(e)) throw e; } }
}

export async function inspectRoleplayRecovery(options: Pick<RoleplayStoreOptions, 'vaultPath' | 'hostPath'>) {
  const vault = await realpath(options.vaultPath), host = await realpath(options.hostPath);
  const root = join(vault, '.mcpvault-roleplay');
  const lockPath = join(root, 'writer.lock');
  const lock = await optional(vault, lockPath, 2048);
  const checkpointPath = join(host, `roleplay-${roleplayHash(vault.toLowerCase())}.checkpoint.json`);
  const checkpoint = await optional(host, checkpointPath, 2048);
  const names = canonicalNames(await canonicalTurnNames(join(vault, ROLEPLAY_ROOT)));
  const parsed = checkpoint ? parseCheckpoint(checkpoint, vault) : undefined;
  if (parsed && (names.length < parsed.sequence || names.length > parsed.sequence + (parsed.pending ? 1 : 0))) throw new Error('Roleplay checkpoint/turn mismatch; manual forensic recovery required');
  return {
    fingerprint: roleplayHash({ vault, lock, checkpoint, names }), lock: lock ? JSON.parse(lock) : null, lockText: lock ?? null,
    checkpoint: parsed ?? null, turnFiles: names.length,
    action: 'Stop the exact host, inspect this fingerprint, then recover only a confirmed dead writer. Never delete or reset turns/checkpoints.'
  };
}

export async function recoverRoleplayWriter(options: Pick<RoleplayStoreOptions, 'vaultPath' | 'hostPath'>, approval: { expectedFingerprint: string; reason: string }) {
  if (typeof approval.expectedFingerprint !== 'string' || !hash(approval.expectedFingerprint)) throw new Error('Exact recovery inspection fingerprint required');
  if (typeof approval.reason !== 'string' || !approval.reason.trim() || approval.reason.length > 1000) throw new Error('Bounded recovery reason required');
  const vault = await realpath(options.vaultPath), host = await realpath(options.hostPath);
  if (inside(vault, host)) throw new Error('Roleplay recovery audit must be outside the Vault');
  const root = join(vault, '.mcpvault-roleplay'), gatePath = join(root, 'recovery.lock'), writerPath = join(root, 'writer.lock');
  await ensureFederationDirectory(vault, root);
  const gate = await acquireRecoveryGate(vault, gatePath);
  try {
    const inspection = await inspectRoleplayRecovery({ vaultPath: vault, hostPath: host });
    if (inspection.fingerprint !== approval.expectedFingerprint) throw new Error('Recovery inspection fingerprint changed');
    const writer = inspection.lock as WriterLock | null;
    if (!writer || !Number.isSafeInteger(writer.pid) || writer.pid <= 0 || typeof writer.nonce !== 'string' || !writer.nonce || writer.vault !== vault) throw new Error('Writer PID/identity is invalid; manual forensic recovery required');
    if (!await deadProcess(writer.pid)) throw new Error('Writer PID is live/running; it will not be stopped or unlocked');
    if ((await inspectRoleplayRecovery({ vaultPath: vault, hostPath: host })).fingerprint !== inspection.fingerprint) throw new Error('Writer changed during recovery');
    const auditName = `roleplay-recovery-${randomUUID()}.json`;
    await writeFederationFileAtomic(host, join(host, auditName), JSON.stringify({ version: 1, at: new Date().toISOString(), reason: approval.reason, writerLock: writer, writerLockText: inspection.lockText, inspection }), { maxBytes: 8192 });
    // Recheck after the durable off-Vault backup/audit, immediately before the only deletion.
    if ((await inspectRoleplayRecovery({ vaultPath: vault, hostPath: host })).fingerprint !== inspection.fingerprint) throw new Error('Writer changed during recovery');
    await assertRecoveryGate(gatePath, gate);
    if ((await lstat(writerPath)).isSymbolicLink()) throw new Error('Writer lock symlink refused');
    await unlink(writerPath);
    return { recovered: true, audit: auditName, nextAction: 'Open roleplay only after replay validates the existing checkpoint and canonical turns' };
  } finally { await releaseRecoveryGate(gatePath, gate); }
}
