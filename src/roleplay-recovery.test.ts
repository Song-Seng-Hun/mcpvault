import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

it('recovers a genuinely killed writer after its durable intent but before canonical rename', async () => {
  const f = await fixture(); await f.store.close();
  const code = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.rename;
    fs.rename = async (from, to) => {
      if (String(to).endsWith('0000000001.md')) {
        process.stdout.write('INTENT_READY\\n');
        setInterval(() => {}, 1000);
        await new Promise(() => {});
      }
      return original(from, to);
    };
    syncBuiltinESMExports();
    const { RoleplayStore } = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/roleplay-store.ts')).href)});
    const { roleplayRevision } = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/roleplay-model.ts')).href)});
    const store = await RoleplayStore.open(JSON.parse(process.argv[1]));
    await store.transact({ op: 'initialize', actor: 'host', requestId: 'killed-child',
      expectedRevision: roleplayRevision(await store.snapshot()), data: { title: 'Test archive', places: { hall: [] } } });
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, JSON.stringify(f.options)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`child intent timeout: ${stderr}`)), 10000);
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('INTENT_READY')) { clearTimeout(timeout); resolve(); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`child exited before intent: ${stderr}`)); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    child.kill('SIGKILL'); await exited;
    const inspection = await inspectRoleplayRecovery(f.options);
    expect(inspection.lock.pid).toBe(child.pid);
    expect(inspection.lock.hostId).toBe(inspection.hostId);
    expect(inspection.checkpoint?.pending?.sequence).toBe(1);
    expect(inspection.turnFiles).toBe(0);
    await recoverRoleplayWriter(f.options, { expectedFingerprint: inspection.fingerprint, reason: 'test child killed at canonical rename boundary' });
    const restarted = await RoleplayStore.open(f.options);
    try { expect((await restarted.snapshot()).title).toBe('Test archive'); expect((await restarted.snapshot()).sequence).toBe(1); }
    finally { await restarted.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
}, 20000);
