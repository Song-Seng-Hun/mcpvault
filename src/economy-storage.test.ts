import { afterEach, expect, test, vi } from 'vitest';
import * as fileOps from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EconomyLedger, assertEconomyConfigured } from './economy-ledger.js';
import { loadEconomyHostConfig, inspectEconomyRecovery } from './economy-host.js';
import type { EconomyPolicy } from './economy-model.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
const ledgers: EconomyLedger[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const ledger of ledgers.splice(0)) await ledger.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const policy: EconomyPolicy = { version: 1, revision: 'split-storage', enabled: true, treasury: 'treasury', operators: ['operator'], owners: { treasury: 'host', alice: 'a' }, reviewers: [], subjectiveReview: false, maxSupply: 5000, minReward: 10, maxReward: 100, postingFee: 2, reviewFee: 5, dailySpend: 107, dailyPosts: 1, openContracts: 2, treasuryWeeklyBudget: 500 };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'economy-split-')); roots.push(root);
  const vaultPath = join(root, 'vault'), hostPath = join(root, 'host'), ledgerPath = join(root, 'ledger');
  for (const path of [vaultPath, hostPath, ledgerPath]) await mkdir(path);
  return { vaultPath, hostPath, ledgerPath, policy, storageVerified: true };
}
const issue = { op: 'issue' as const, actor: 'operator', requestId: 'initial-supply', amount: 5000, reason: 'test-only supply' };
test('separate storage writes canonical journal locally and binds the live Wiki without a NAS journal', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger);
  await ledger.transact(issue);
  expect(await readdir(join(o.vaultPath, '.mcpvault-economy'))).toEqual(['storage-binding.json']);
  expect(await readFile(join(o.ledgerPath, '.mcpvault-economy/journal/0000000001.md'), 'utf8')).toContain('economy_transaction');
  await expect(assertEconomyConfigured(o.vaultPath, false)).rejects.toThrow(/configuration/);
  await ledger.close();
  const reopened = await EconomyLedger.open(o); ledgers.push(reopened);
  expect((await reopened.snapshot()).issued).toBe(5000);
  expect(await reopened.transact(issue)).toMatchObject({ sequence: 1 });
});
test('separate host config admits an explicit ledger path and recovery inspects that journal', async () => {
  const o = await fixture(), path = join(o.hostPath, 'config.json');
  await writeFile(path, JSON.stringify({ version: 1, vaultPath: o.vaultPath, hostPath: o.hostPath, ledgerPath: o.ledgerPath, policy }));
  expect((await loadEconomyHostConfig(path, o.vaultPath) as any).ledgerPath).toBe(o.ledgerPath);
  const ledger = await EconomyLedger.initialize(o); ledgers.push(ledger); await ledger.transact(issue);
  expect(await inspectEconomyRecovery(o)).toMatchObject({ journalFiles: 1, lock: { pid: process.pid } });
});
test('another physical ledger cannot become a second writer for the same Wiki', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger);
  const other = await fixture();
  await expect(EconomyLedger.initialize({ ...other, vaultPath: o.vaultPath })).rejects.toThrow(/binding|bound/);
  await expect(EconomyLedger.open(o)).rejects.toThrow(/writer/);
});
test('logical Wiki identity remains bound after a close and cannot be redirected', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger); await ledger.close();
  const other = await fixture();
  await expect(EconomyLedger.open({ ...o, vaultPath: other.vaultPath })).rejects.toThrow(/binding|bound/);
});
test('changed or deleted NAS binding stops an already admitted writer before new transactions', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger);
  const binding = join(o.vaultPath, '.mcpvault-economy/storage-binding.json');
  await writeFile(binding, '{}');
  await expect(ledger.transact(issue)).rejects.toThrow(/binding/);
  expect(await readdir(join(o.ledgerPath, '.mcpvault-economy/journal'))).toEqual([]);
  await unlink(binding);
  await expect(ledger.snapshot()).rejects.toThrow(/binding/);
});
test('separation refuses existing legacy journals instead of starting an unrelated empty ledger', async () => {
  const o = await fixture(), legacy = await EconomyLedger.initialize({ ...o, ledgerPath: undefined }); ledgers.push(legacy);
  await legacy.transact(issue); await legacy.close();
  await expect(EconomyLedger.initialize(o)).rejects.toThrow(/migration|existing|binding/);
});
test('separate journal cannot be inside the live Wiki or overlap the checkpoint directory', async () => {
  const o = await fixture(), child = join(o.vaultPath, 'local-looking'); await mkdir(child);
  await expect(EconomyLedger.initialize({ ...o, ledgerPath: child })).rejects.toThrow(/outside|overlap|separate/);
  await expect(EconomyLedger.initialize({ ...o, ledgerPath: o.hostPath })).rejects.toThrow(/outside|overlap|separate/);
});
test('legacy admission cannot bypass an existing split binding on either side', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger); await ledger.close();
  const other = await fixture();
  await expect(EconomyLedger.initialize({ ...o, ledgerPath: undefined, hostPath: other.hostPath })).rejects.toThrow(/binding|separate/);
  await expect(EconomyLedger.open({ ...o, ledgerPath: undefined, vaultPath: o.ledgerPath })).rejects.toThrow(/binding|separate/);
});
test('split journal restart detects rollback and binding is rechecked after caller validation', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger);
  const markerPath = join(o.vaultPath, '.mcpvault-economy/storage-binding.json'), marker = await readFile(markerPath, 'utf8');
  await expect(ledger.transact(issue, async () => { await writeFile(markerPath, '{}'); })).rejects.toThrow(/binding/);
  await writeFile(markerPath, marker);
  await ledger.transact(issue); await ledger.close();
  await unlink(join(o.ledgerPath, '.mcpvault-economy/journal/0000000001.md'));
  await expect(EconomyLedger.open(o)).rejects.toThrow(/rollback|checkpoint/);
});
test('a copied local binding cannot be repointed to a different local ledger', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger); await ledger.close();
  const other = await fixture();
  await expect(EconomyLedger.open({ ...o, ledgerPath: other.ledgerPath })).rejects.toThrow(/binding/);
});
test('a fresh checkpoint host cannot take an empty split physical journal through legacy initialization', async () => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger); await ledger.close();
  const other = await fixture();
  await expect(EconomyLedger.initialize({ ...o, vaultPath: o.ledgerPath, hostPath: other.hostPath, ledgerPath: undefined })).rejects.toThrow(/binding/);
  expect(await readdir(other.hostPath)).toEqual([]);
});
test('a crash immediately after the private binding is durable keeps unconfigured Work blocked', async () => {
  const o = await fixture(), originalOpen = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;
  vi.mocked(fileOps.open).mockImplementationOnce(async (...args: Parameters<typeof fileOps.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('economy-storage-binding.json')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); throw new Error('simulated private binding publication crash'); };
    }
    return handle;
  });
  await expect(EconomyLedger.initialize(o)).rejects.toThrow(/simulated/);
  vi.restoreAllMocks();
  await expect(assertEconomyConfigured(o.vaultPath, false)).rejects.toThrow(/configuration/);
  await expect(EconomyLedger.open(o)).rejects.toThrow(/binding/);
});
test.each(['physical', 'private'])('%s binding tampering during validation stops the transaction', async kind => {
  const o = await fixture(), ledger = await EconomyLedger.initialize(o); ledgers.push(ledger);
  const path = kind === 'physical' ? join(o.ledgerPath, '.mcpvault-economy/storage-binding.json') : join(o.hostPath, 'economy-storage-binding.json');
  const original = await readFile(path, 'utf8');
  await expect(ledger.transact(issue, async () => { await writeFile(path, '{}'); })).rejects.toThrow(/binding/);
  expect(await readdir(join(o.ledgerPath, '.mcpvault-economy/journal'))).toEqual([]);
  await writeFile(path, original);
  expect((await ledger.snapshot()).issued).toBe(0);
});
