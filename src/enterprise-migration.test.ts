import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewMemoryMigration } from './enterprise-migration.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test('memory preview keeps legacy user and model content private and requires explicit owner verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-migration-')); roots.push(root);
  for (const path of ['users/employee', 'agents/network', 'agents/orphan', 'models/codex']) {
    await mkdir(join(root, '_scopes', path), { recursive: true });
    await writeFile(join(root, '_scopes', path, 'Secret.md'), 'never include body in report');
  }
  const report = await previewMemoryMigration({ vaultPath: root, verifiedAgents: [{ agentId: 'network', userId: 'employee' }] });
  expect(report.entries.find(row => row.scope === 'user')?.disposition).toBe('keep-host-private');
  expect(report.entries.find(row => row.scope === 'model')?.disposition).toBe('ownership-review-required');
  expect(report.entries.find(row => row.identity === 'orphan')?.disposition).toBe('ownership-review-required');
  expect(report.entries.find(row => row.identity === 'network')).toMatchObject({ disposition: 'manual-agent-copy-candidate', verifiedOwner: 'employee' });
  expect(JSON.stringify(report)).not.toContain('never include body');
  expect(report.automaticMigration).toBe(false);
  expect((await previewMemoryMigration({ vaultPath: root, limit: 1 })).truncated).toBe(true);
});
test('memory preview rejects ambiguous owner mappings and invalid bounds', async () => {
  await expect(previewMemoryMigration({ vaultPath: '.', verifiedAgents: [{ agentId: 'same', userId: 'a' }, { agentId: 'same', userId: 'b' }] })).rejects.toThrow(/ambiguous/i);
  await expect(previewMemoryMigration({ vaultPath: '.', limit: 0 })).rejects.toThrow(/limit/);
});
