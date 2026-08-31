import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { GitHistoryService } from './git-history.js';

const execFileAsync = promisify(execFile);
let vaultPath: string;
let history: GitHistoryService;

beforeEach(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-history-'));
  history = new GitHistoryService(vaultPath);
});

afterEach(async () => {
  await rm(vaultPath, { recursive: true, force: true });
});

test('initializes revision history without creating a commit', async () => {
  await expect(history.status()).resolves.toMatchObject({ enabled: false, pending: [] });

  await expect(history.initialize()).resolves.toMatchObject({
    success: true,
    initialized: true,
  });
  await expect(history.status()).resolves.toMatchObject({
    enabled: true,
    pending: [],
  });
});

test('commits meaningful checkpoints and reads history, diffs, and snapshots', async () => {
  await history.initialize();
  await writeFile(join(vaultPath, 'Plan.md'), 'version one\n');

  const first = await history.commitChanges({
    reason: 'Create the initial plan',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
  });
  expect(first.committed).toBe(true);
  expect(first.paths).toEqual(['Plan.md']);

  await writeFile(join(vaultPath, 'Plan.md'), 'version two\n');
  await expect(history.status()).resolves.toMatchObject({
    pending: [{ path: 'Plan.md' }],
  });
  const second = await history.commitChanges({
    reason: 'Clarify the plan',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
  });
  expect(second.committed).toBe(true);

  const entries = await history.noteHistory('Plan.md');
  expect(entries.map(entry => entry.reason)).toEqual(['Clarify the plan', 'Create the initial plan']);
  expect(entries[0]).toMatchObject({ authorName: 'Test Author', authorEmail: 'test@example.com' });

  const diff = await history.compareNoteRevisions('Plan.md', first.revision!, second.revision!);
  expect(diff.diff).toContain('-version one');
  expect(diff.diff).toContain('+version two');

  const snapshot = await history.fileAtRevision('Plan.md', first.revision!);
  expect(snapshot.content).toBe('version one\n');
});

test('commits only safe vault paths and ignores restricted application state', async () => {
  await history.initialize();
  await writeFile(join(vaultPath, 'Note.md'), 'safe');
  await mkdir(join(vaultPath, '.obsidian'), { recursive: true });
  await writeFile(join(vaultPath, '.obsidian', 'workspace.json'), '{}');
  await execFileAsync('git', ['add', '--', '.obsidian/workspace.json'], { cwd: vaultPath });

  const result = await history.commitChanges({
    reason: 'Save the note',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
  });
  expect(result.paths).toEqual(['Note.md']);
  expect((await history.status()).pending).toEqual([]);
  const committed = await execFileAsync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: vaultPath, encoding: 'utf8' });
  expect(committed.stdout.trim()).toBe('Note.md');
});

test('refuses executable clean filters before staging content', async () => {
  await history.initialize();
  await execFileAsync('git', ['config', '--local', 'filter.evil.clean', 'malicious-command'], { cwd: vaultPath });
  await writeFile(join(vaultPath, 'Note.md'), 'safe');

  await expect(history.commitChanges({
    reason: 'Should be blocked',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
  })).rejects.toThrow(/executable filter/);
});

test('refuses a vault nested inside a broader Git repository', async () => {
  await execFileAsync('git', ['init'], { cwd: vaultPath });
  const nestedPath = join(vaultPath, 'nested-vault');
  await mkdir(nestedPath);
  const nestedHistory = new GitHistoryService(nestedPath);

  await expect(nestedHistory.status()).rejects.toThrow(/repository root/);
  await expect(nestedHistory.initialize()).rejects.toThrow(/repository root/);
});
