import { afterEach, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { SkillEvaluationProfile } from './skill-evaluation.js';

vi.setConfig({ testTimeout: 30000 });
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'skill-evolution-host-')); roots.push(root);
  const vault = join(root, 'vault'), host = join(root, 'private');
  await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const path = join(host, 'config.json'), keyPath = join(host, 'attestation.key');
  const config = { version: 1, vaultPath: vault, enabled: true, attestationKeyFile: 'attestation.key', approverAccounts: [], profileIds: [] };
  const save = (value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await writeFile(keyPath, 'synthetic-test-key-never-a-production-secret-123456789', { mode: 0o600 }); await save(config);
  const module = await import('./skill-evolution-host.js').catch(() => ({ loadSkillEvolutionHostConfig: undefined }));
  expect(module.loadSkillEvolutionHostConfig, 'a bounded host-only skill configuration loader is available').toBeTypeOf('function');
  return { root, vault, host, path, keyPath, config, save, load: module.loadSkillEvolutionHostConfig! };
}
test('loads the exact Vault configuration with a persistent private key and no automatic evaluator', async () => {
  const f = await fixture(), before = await readFile(f.keyPath, 'utf8');
  const first = await f.load(f.path, f.vault), second = await f.load(f.path, f.vault);
  expect(first).toEqual({ enabled: true, attestationKey: before, approverAccounts: [], profiles: [] });
  expect(second).toEqual(first); expect(await readFile(f.keyPath, 'utf8')).toBe(before);
});
test('rejects wrong Vault, unknown configuration keys, short keys and missing keys instead of disabling silently', async () => {
  const f = await fixture();
  await expect(f.load(f.path, f.host)).rejects.toThrow(/Vault/);
  await f.save({ ...f.config, attestationKey: 'must-not-accept-inline-secret' });
  await expect(f.load(f.path, f.vault)).rejects.toThrow(/configuration/);
  await f.save(f.config); await writeFile(f.keyPath, 'short');
  await expect(f.load(f.path, f.vault)).rejects.toThrow(/key/);
  await rm(f.keyPath); await expect(f.load(f.path, f.vault)).rejects.toThrow(/key|storage/);
});
test('does not load arbitrary profile code and admits only host-registered profile identifiers', async () => {
  const f = await fixture();
  await f.save({ ...f.config, profileIds: ['approved'] });
  await expect(f.load(f.path, f.vault)).rejects.toThrow(/profile/);
  const profile: SkillEvaluationProfile = { id: 'approved', revision: '1', skillId: 'synthetic', caseIds: ['test'], targetCaseIds: ['test'], maxDurationMs: 100,
    evaluate: async () => ({ risk: 'unknown', cases: [{ id: 'test', baseline: false, candidate: false }] }) };
  expect((await f.load(f.path, f.vault, [profile])).profiles).toEqual([profile]);
  await expect(f.load(f.path, f.vault, [profile, profile])).rejects.toThrow(/profile/);
});

test('the actual host loader supplies the trusted document evaluator when explicitly selected', async () => {
  const f = await fixture();
  await f.save({ ...f.config, approverAccounts: ['admin'], profileIds: ['local-tdd-document-contract-v1'] });
  const host = await f.load(f.path, f.vault);
  expect(host.profiles).toHaveLength(1);
  expect(host.profiles[0]).toMatchObject({ id: 'local-tdd-document-contract-v1', skillId: 'local-test-driven-development' });
  const result = await host.profiles[0]!.evaluate({ skillId: 'local-test-driven-development', baseline: 'Unchanged text', candidate: 'Unchanged text', signal: new AbortController().signal });
  expect(result.risk).toBe('approval_required');
  expect(result.cases).toHaveLength(6);
  expect(result.cases.every(c => c.baseline === c.candidate)).toBe(true);
});
test('rejects config in Vault, key traversal and linked private directories', async () => {
  const f = await fixture(), publicConfig = join(f.vault, 'config.json');
  await writeFile(publicConfig, JSON.stringify(f.config));
  await expect(f.load(publicConfig, f.vault)).rejects.toThrow(/outside|private/);
  await f.save({ ...f.config, attestationKeyFile: '../private/attestation.key' });
  await expect(f.load(f.path, f.vault)).rejects.toThrow(/key/);
  await f.save(f.config);
  const alias = join(f.root, 'alias'); await symlink(f.host, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.load(join(alias, 'config.json'), f.vault)).rejects.toThrow(/link|canonical|private/);
});
test('rejects a broadly readable private directory', async () => {
  const f = await fixture();
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [f.host, '/grant', '*S-1-1-0:(OI)(CI)R'], { windowsHide: true });
  else await chmod(f.host, 0o755);
  await expect(f.load(f.path, f.vault)).rejects.toThrow(/private|permission/);
});
