import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { inspectSkillLock, recoverSkillLock } from './skill-evolution-recovery.js';

const roots: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  children.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ root: string; vaultPath: string; lockDirectory: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-skill-recovery-'));
  roots.push(root);
  const vaultPath = join(root, 'vault');
  const lockDirectory = join(vaultPath, '.mcpvault', 'skill-locks');
  await mkdir(lockDirectory, { recursive: true });
  return { root, vaultPath, lockDirectory };
}

async function waitUntilReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.includes('lock-ready')) resolveReady();
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`lock owner exited before ready (${code}): ${stderr}`)));
  });
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('host-only skill lock recovery', () => {
  test('inspects the bounded UUID marker left by a killed lock-owning process', async () => {
    const { vaultPath, lockDirectory } = await fixture();
    const skillId = 'safe-evolution';
    const lockPath = join(lockDirectory, `${skillId}.lock`);
    const marker = randomUUID();
    const source = [
      "import { mkdir, open } from 'node:fs/promises';",
      `const directory = ${JSON.stringify(lockDirectory)};`,
      `const lockPath = ${JSON.stringify(lockPath)};`,
      `const marker = ${JSON.stringify(marker)};`,
      "await mkdir(directory, { recursive: true });",
      "const handle = await open(lockPath, 'wx');",
      "await handle.writeFile(marker, 'utf8');",
      'setInterval(() => {}, 1000);',
      "process.stdout.write('lock-ready\\n');",
      'await new Promise(() => {});',
      'void handle;',
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { windowsHide: true });
    children.add(child);
    await waitUntilReady(child);
    expect(child.exitCode).toBeNull();
    expect(child.kill('SIGKILL')).toBe(true);
    await once(child, 'exit');
    children.delete(child);

    expect(await readFile(lockPath, 'utf8')).toBe(marker);
    await expect(inspectSkillLock(vaultPath, skillId)).resolves.toEqual({
      vaultPath: resolve(vaultPath),
      skillId,
      lockPath: resolve(lockPath),
      marker,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test('requires explicit stopped-owner confirmation and the current inspection fingerprint', async () => {
    const { vaultPath, lockDirectory } = await fixture();
    const skillId = 'safe-evolution';
    const lockPath = join(lockDirectory, `${skillId}.lock`);
    await writeFile(lockPath, randomUUID(), { flag: 'wx' });
    const first = await inspectSkillLock(vaultPath, skillId);

    await expect(recoverSkillLock({ ...first, expectedFingerprint: first.fingerprint, confirmOwnerStopped: false } as never))
      .rejects.toThrow(/confirm|stopped|owner/i);
    const replacement = randomUUID();
    await writeFile(lockPath, replacement);
    await expect(recoverSkillLock({ vaultPath, skillId, expectedFingerprint: first.fingerprint, confirmOwnerStopped: true }))
      .rejects.toThrow(/fingerprint|changed/i);
    expect(await readFile(lockPath, 'utf8')).toBe(replacement);

    const current = await inspectSkillLock(vaultPath, skillId);
    await expect(recoverSkillLock({ vaultPath, skillId, expectedFingerprint: current.fingerprint, confirmOwnerStopped: true }))
      .resolves.toEqual({ ...current, removed: true });
    await expectMissing(lockPath);
  });

  test('rejects a marker larger than 64 bytes without removing it', async () => {
    const { vaultPath, lockDirectory } = await fixture();
    const skillId = 'safe-evolution';
    const lockPath = join(lockDirectory, `${skillId}.lock`);
    const oversized = 'x'.repeat(65);
    await writeFile(lockPath, oversized, { flag: 'wx' });

    await expect(inspectSkillLock(vaultPath, skillId)).rejects.toThrow(/marker|64|large|bounded/i);
    await expect(recoverSkillLock({ vaultPath, skillId, expectedFingerprint: '0'.repeat(64), confirmOwnerStopped: true }))
      .rejects.toThrow(/marker|64|large|bounded/i);
    expect(await readFile(lockPath, 'utf8')).toBe(oversized);
  });

  test('rejects a junction lock parent without reading or changing its outside target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcpvault-skill-recovery-link-'));
    roots.push(root);
    const vaultPath = join(root, 'vault');
    const outside = join(root, 'outside');
    const outsideLocks = join(outside, 'skill-locks');
    const skillId = 'safe-evolution';
    const outsideLock = join(outsideLocks, `${skillId}.lock`);
    const secretMarker = 'outside-marker-must-not-be-returned';
    await mkdir(vaultPath);
    await mkdir(outsideLocks, { recursive: true });
    await writeFile(outsideLock, secretMarker);
    await symlink(outside, join(vaultPath, '.mcpvault'), process.platform === 'win32' ? 'junction' : 'dir');

    for (const operation of [
      () => inspectSkillLock(vaultPath, skillId),
      () => recoverSkillLock({ vaultPath, skillId, expectedFingerprint: '0'.repeat(64), confirmOwnerStopped: true }),
    ]) {
      const result = await operation().then(() => undefined, error => error as Error);
      expect(result).toBeInstanceOf(Error);
      expect(result?.message).toMatch(/symbolic|junction|containment|directory/i);
      expect(result?.message).not.toContain(secretMarker);
    }
    expect(await readFile(outsideLock, 'utf8')).toBe(secretMarker);
    expect(await readdir(outsideLocks)).toEqual([`${skillId}.lock`]);
  });

  test('rejects a symlink lock without reading or changing its outside target', async () => {
    const { root, vaultPath, lockDirectory } = await fixture();
    const skillId = 'safe-evolution';
    const outsideLock = join(root, 'outside.lock');
    const lockPath = join(lockDirectory, `${skillId}.lock`);
    const secretMarker = 'outside-file-marker';
    await writeFile(outsideLock, secretMarker);
    try {
      await symlink(outsideLock, lockPath, 'file');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error
        && ['EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))) return;
      throw error;
    }

    const result = await inspectSkillLock(vaultPath, skillId).then(() => undefined, error => error as Error);
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toMatch(/symbolic|link|lock/i);
    expect(result?.message).not.toContain(secretMarker);
    expect(await readFile(outsideLock, 'utf8')).toBe(secretMarker);
  });

  test('allows at most one of two concurrent host recoveries to remove the exact lock', async () => {
    const { vaultPath, lockDirectory } = await fixture();
    const skillId = 'safe-evolution';
    const lockPath = join(lockDirectory, `${skillId}.lock`);
    await writeFile(lockPath, randomUUID(), { flag: 'wx' });
    const inspection = await inspectSkillLock(vaultPath, skillId);
    const approval = { vaultPath, skillId, expectedFingerprint: inspection.fingerprint, confirmOwnerStopped: true as const };

    const attempts = await Promise.allSettled([recoverSkillLock(approval), recoverSkillLock(approval)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expectMissing(lockPath);
    expect(await readdir(lockDirectory)).toEqual([]);
  });
});
