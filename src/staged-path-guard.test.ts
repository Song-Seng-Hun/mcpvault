import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const script = resolve('scripts/check-staged-paths.mjs');
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('staged guard permits ordinary staged files without reading their bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-stage-guard-')); roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'ordinary.txt'), 'synthetic-private-body-must-not-be-printed');
  execFileSync('git', ['-C', root, 'add', '--', 'ordinary.txt']);
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 5000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Staged paths: safe');
  expect(result.stdout + result.stderr).not.toContain('synthetic-private-body');
});

test('staged guard blocks host paths even when forced into the index', async () => {
  const { mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-stage-guard-')); roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  for (const folder of ['.mcpvault', '.agents', '.codex', 'scripts/__pycache__']) {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, 'fixture.txt'), 'synthetic-secret-body');
  }
  execFileSync('git', ['-C', root, 'add', '--force', '--', '.']);
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 5000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Blocked 4 host/cache paths');
  expect(result.stdout + result.stderr).not.toContain('synthetic-secret-body');
  // The check neither unstages nor removes the user's files.
  expect(execFileSync('git', ['-C', root, 'diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean)).toHaveLength(4);
});

test('staged guard fails closed outside a Git worktree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-stage-guard-')); roots.push(root);
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 5000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Cannot inspect staged paths');
});
