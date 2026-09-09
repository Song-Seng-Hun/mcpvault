import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-skill-lock-'));
});

afterEach(async () => {
  await rm(vaultPath, { recursive: true, force: true });
});

describe('FileSystemService.withSkillTransaction', () => {
  test('serializes concurrent calls from separate service instances for one vault and skill', async () => {
    const firstService = new FileSystemService(vaultPath);
    const secondService = new FileSystemService(vaultPath);
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let firstStarted!: () => void;
    const enteredFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
    const first = firstService.withSkillTransaction('safe-evolution', async () => {
      events.push('first-start');
      firstStarted();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push('first-end');
    });
    const second = secondService.withSkillTransaction('safe-evolution', async () => {
      events.push('second-start');
    });

    await enteredFirst;
    expect(events).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  test('fails closed and never invokes the operation when another process owns the lock', async () => {
    const service = new FileSystemService(vaultPath);
    const lockDirectory = join(vaultPath, '.mcpvault', 'skill-locks');
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(join(lockDirectory, 'safe-evolution.lock'), '');
    let called = false;

    await expect(service.withSkillTransaction('safe-evolution', async () => { called = true; }))
      .rejects.toThrow(/busy/i);
    expect(called).toBe(false);
  });

  test('releases its lock after an operation error', async () => {
    const service = new FileSystemService(vaultPath);

    await expect(service.withSkillTransaction('safe-evolution', async () => {
      throw new Error('expected operation failure');
    })).rejects.toThrow('expected operation failure');
    await expect(service.withSkillTransaction('safe-evolution', async () => 'released')).resolves.toBe('released');
  });

  test('rejects unsafe and reserved identifiers without running the operation', async () => {
    const service = new FileSystemService(vaultPath);
    let called = false;

    for (const skillId of ['', '-leading', 'Uppercase', 'a'.repeat(101), 'con', 'com1', 'path/alias']) {
      await expect(service.withSkillTransaction(skillId, async () => { called = true; })).rejects.toThrow(/skill/i);
    }
    expect(called).toBe(false);
  });

  test('rejects a symlinked or Windows-junction lock-parent before creating children outside the vault', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'mcpvault-skill-lock-outside-'));
    try {
      await symlink(outside, join(vaultPath, '.mcpvault'), 'junction');
      const service = new FileSystemService(vaultPath);
      let called = false;

      await expect(service.withSkillTransaction('safe-evolution', async () => { called = true; })).rejects.toThrow(/symbolic link|containment/i);
      expect(called).toBe(false);
      await expect(stat(join(outside, 'skill-locks'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
