import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAuthService } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ModerationService } from './moderation.js';
import { maintenanceExecution } from './maintenance-execution.js';

let vault: string, fs: FileSystemService, auth: ScopeAuthService, access: ScopeAccessPolicy, moderation: ModerationService;
let rules: unknown[];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-execution-')); rules = [];
  fs = new FileSystemService(vault); auth = new ScopeAuthService(vault);
  access = new ScopeAccessPolicy({ documentRules: () => rules, localInferenceAllowed: () => true });
  moderation = new ModerationService(vault, fs, auth);
  await auth.register({ accountId: 'operator', modelId: 'test', password: 'isolated-fixture-password' });
  await writeFile(join(vault, 'A.md'), '# Before');
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

test.each(['capability', 'ban', 'document'])('current %s revocation blocks a write after the execution started', async kind => {
  const execution = maintenanceExecution(auth, access, moderation, async () => {});
  const actor = (await execution.authorize('operator'))!;
  await expect(execution.runAs(actor, async () => {
    const current = await fs.readNote('A.md');
    if (kind === 'capability') {
      const path = join(vault, '.mcpvault', 'scope-auth.json');
      const value = JSON.parse(await readFile(path, 'utf8')); value.accounts[0].capabilities = [];
      await writeFile(path, JSON.stringify(value));
    } else if (kind === 'ban') {
      await writeFile(join(vault, '.mcpvault', 'moderation.json'), JSON.stringify({ version: 1, reports: [], actions: [], bans: [{ accountId: 'operator', active: true }] }));
    } else rules = [{ path: 'A.md', confidential: true }];
    await fs.writeNote({ path: 'A.md', content: '# Unexpected', expectedRevision: current.revision });
  })).rejects.toThrow();
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('# Before');
});

test('even an authorized local host leaves protected derivatives for manual classified repair', async () => {
  rules = [{ path: 'A.md', confidential: true }];
  const execution = maintenanceExecution(auth, access, moderation, async () => {});
  const actor = (await execution.authorize('operator'))!;
  expect(access.canAccessPhysicalPath('A.md', actor)).toBe(true);
  await expect(execution.runAs(actor, () => fs.readNote('A.md'))).rejects.toThrow(/manual classified/);
});
