import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoleplayStore } from './roleplay-store.js';
import { roleplayHash, roleplayRevision } from './roleplay-model.js';
import { randomUUID } from 'node:crypto';
import { inspectRoleplayRecovery, recoverRoleplayWriter } from './roleplay-recovery.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'roleplay-recovery-')); roots.push(root);
  const vaultPath = join(root, 'vault'), hostPath = join(root, 'host'); await mkdir(vaultPath); await mkdir(hostPath);
  const options = { vaultPath, hostPath, policy: { administrators: ['host'] } };
  const store = await RoleplayStore.open(options);
  return { vaultPath, hostPath, options, store };
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']); const pid = child.pid!;
  await once(child, 'exit'); return pid;
}

it('requires the exact inspection fingerprint and never removes a live roleplay writer', async () => {
  const f = await fixture();
  try {
    const inspection = await inspectRoleplayRecovery(f.options);
    await expect(recoverRoleplayWriter(f.options, { expectedFingerprint: inspection.fingerprint, reason: 'verify live writer' })).rejects.toThrow(/live|running/i);
    await expect(recoverRoleplayWriter(f.options, { expectedFingerprint: '0'.repeat(64), reason: 'verify fingerprint' })).rejects.toThrow(/changed|fingerprint/i);
  } finally { await f.store.close(); }
});

it('recovers after intent persistence but before the canonical rename, including a helper temporary file', async () => {
  const f = await fixture();
  const turn = await f.store.transact({ op: 'initialize', actor: 'host', requestId: 'initialize', expectedRevision: roleplayRevision(await f.store.snapshot()), data: { title: 'Archive', places: { hall: [] } } });
  const [{ event }] = (await f.store.read()).records;
  await f.store.close();
  const prefix = join(f.hostPath, `roleplay-${roleplayHash(f.vaultPath.toLowerCase())}`);
  const text = await readFile(join(f.vaultPath, turn.path), 'utf8');
  await writeFile(`${prefix}.prepared.md`, text);
  await writeFile(`${prefix}.checkpoint.json`, JSON.stringify({ version: 1, vault: f.vaultPath, sequence: 0, hash: '0'.repeat(64), pending: { sequence: 1, hash: event.hash } }));
  await rm(join(f.vaultPath, turn.path));
  await writeFile(join(f.vaultPath, 'Community/Roleplay/Turns', `.${randomUUID()}.tmp`), text);
  await writeFile(join(f.vaultPath, '.mcpvault-roleplay/writer.lock'), JSON.stringify({ pid: await deadPid(), nonce: randomUUID(), vault: f.vaultPath }));
  const inspection = await inspectRoleplayRecovery(f.options);
  await recoverRoleplayWriter(f.options, { expectedFingerprint: inspection.fingerprint, reason: 'Resume interrupted canonical rename' });
  const reopened = await RoleplayStore.open(f.options);
  try { expect((await reopened.snapshot()).title).toBe('Archive'); } finally { await reopened.close(); }
});

it('backs up and audits a confirmed dead exact writer before removing only its lock', async () => {
  const f = await fixture(); await f.store.close();
  const writerLock = join(f.vaultPath, '.mcpvault-roleplay', 'writer.lock');
  const checkpoint = join(f.hostPath, `roleplay-${roleplayHash(f.vaultPath.toLowerCase())}.checkpoint.json`);
  const checkpointBefore = await readFile(checkpoint, 'utf8');
  const oldLock = JSON.stringify({ pid: await deadPid(), nonce: 'dead-writer', vault: f.vaultPath });
  await writeFile(writerLock, oldLock);
  const inspection = await inspectRoleplayRecovery(f.options);
  const result = await recoverRoleplayWriter(f.options, { expectedFingerprint: inspection.fingerprint, reason: 'confirmed stopped host process' });
  await expect(readFile(writerLock, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(checkpoint, 'utf8')).toBe(checkpointBefore);
  const audit = JSON.parse(await readFile(join(f.hostPath, result.audit), 'utf8'));
  expect(audit).toMatchObject({ reason: 'confirmed stopped host process', writerLock: JSON.parse(oldLock), writerLockText: oldLock, inspection: { fingerprint: inspection.fingerprint } });
});

it('does not auto-unlock an old recovery gate and suspends writer admission', async () => {
  const f = await fixture();
  const gate = join(f.vaultPath, '.mcpvault-roleplay', 'recovery.lock');
  const original = JSON.stringify({ version: 1, pid: await deadPid(), nonce: 'old-recoverer', vault: f.vaultPath, startedAt: '2026-09-08T00:00:00.000Z' });
  await writeFile(gate, original);
  const inspection = await inspectRoleplayRecovery(f.options);
  await expect(recoverRoleplayWriter(f.options, { expectedFingerprint: inspection.fingerprint, reason: 'second operator attempt' })).rejects.toThrow(/gate|forensic/i);
  await expect(f.store.snapshot()).rejects.toThrow(/recovery/i);
  await expect(f.store.close()).resolves.toBeUndefined();
  await expect(RoleplayStore.open(f.options)).rejects.toThrow(/recovery/i);
  expect(await readFile(gate, 'utf8')).toBe(original);
});
