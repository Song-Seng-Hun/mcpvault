import { expect, test } from 'vitest';
import * as runtime from './runtime-evidence.js';
import { hash } from './policy.js';
import { memoryStorage } from '../../tests/evolution-test-fixture.js';

function setup() {
  const { storage, records: values } = memoryStorage(); let allowed = true;
  const principal: any = { accountId: 'alice', modelId: 'model', role: 'agent', capabilities: ['write'] };
  const options = { storage, authorize: async (p: any) => {
    if (!allowed || p.accountId !== 'alice') throw Error('denied'); return 'authority-v1';
  } };
  const create = () => new runtime.EvolutionRuntimeEvidence(options);
  const raw = { id: 'correction', taskId: 'before', sessionId: 'session-before', target: { kind: 'persona', id: 'assistant' },
    scope: { kind: 'account', id: 'alice' }, kind: 'preference', signal: 'explicit', key: 'verbosity', value: 'brief', summary: 'Short answers.', basis: [] };
  return { create, principal, raw, values, revoke: () => { allowed = false; } };
}

test('host feedback receipt binds every feedback field and survives a restart', async () => {
  expect(runtime.EvolutionRuntimeEvidence).toBeTypeOf('function');
  const f = setup(), store = f.create();
  const token = await store.captureFeedback(f.principal, f.raw, 'human', 'event1');
  expect(await f.create().attest(token, f.principal, f.raw)).toMatchObject({ origin: 'human', eventId: 'event1' });
  await expect(store.attest(token, f.principal, { ...f.raw, value: 'detailed' })).rejects.toThrow();
  await expect(store.attest(token, { ...f.principal, accountId: 'bob' }, f.raw)).rejects.toThrow();
  f.revoke(); await expect(store.attest(token, f.principal, f.raw)).rejects.toThrow();
});

test('delivery alone cannot prove use or effect; proof pins the exact next-task output', async () => {
  const f = setup(), store = f.create();
  const delivered = await store.captureDelivery(f.principal, { taskId: 'next-task', sessionId: 'next-session', cycleId: 'cycle1',
    revision: hash('applied'), representationHash: hash('packet'), basis: hash('basis') });
  const cycle: any = { id: 'cycle1', outputRevision: hash('applied') };
  expect(await store.proveUse(delivered, cycle, f.principal)).toBeUndefined();
  const effect = await store.verifyUse(delivered, f.principal, {
    method: 'synthetic', checkId: 'renderer-v1', evaluate: async () => ({ used: true, success: true, resultHash: hash('actual-output') }),
  });
  expect(await store.proveUse(effect, cycle, f.principal)).toMatchObject({ taskId: 'next-task', sessionId: 'next-session', success: true, method: 'synthetic' });
  await expect(store.proveUse(effect, { ...cycle, outputRevision: hash('edited') }, f.principal)).rejects.toThrow();
  const duplicate = await store.verifyUse(delivered, f.principal, {
    method: 'synthetic', checkId: 'renderer-v1', evaluate: async () => { throw Error('must not rerun'); },
  });
  expect(duplicate).toBe(effect);
});

test('unobserved use and revoked awaited checks cannot become success receipts', async () => {
  const f = setup(), store = f.create();
  const delivered = await store.captureDelivery(f.principal, { taskId: 'next', sessionId: 'next-s', cycleId: 'cycle1',
    revision: hash('applied'), representationHash: hash('packet'), basis: hash('basis') });
  await expect(store.verifyUse(delivered, f.principal, {
    method: 'synthetic', checkId: 'checker', evaluate: async () => ({ used: false, success: true, resultHash: hash('result') }),
  })).rejects.toThrow();
  await expect(store.verifyUse(delivered, f.principal, {
    method: 'synthetic', checkId: 'checker', evaluate: async () => { f.revoke(); return { used: true, success: true, resultHash: hash('result') }; },
  })).rejects.toThrow();
  expect([...f.values.values()].some((v: any) => v.kind === 'effect')).toBe(false);
});

test('conflicting task delivery is rejected, not overwritten or treated as context retention', async () => {
  const f = setup(), store = f.create();
  const input = { taskId: 'task', sessionId: 'session', cycleId: 'cycle', revision: hash('one'), representationHash: hash('packet'), basis: hash('basis') };
  const token = await store.captureDelivery(f.principal, input);
  expect(await store.captureDelivery(f.principal, input)).toBe(token);
  await expect(store.captureDelivery(f.principal, { ...input, revision: hash('two') })).rejects.toThrow();
  expect(JSON.stringify([...f.values.values()])).not.toContain('context_retained');
});

test('task harness version stays fixed across profile changes and restarts, not across changed scope', async () => {
  const f = setup(), store = f.create();
  const context = { taskId: 'task', sessionId: 'session', taskKind: 'research', project: 'project' };
  const profile = { modelId: 'model', taskKind: 'research', route: 'keyword', optionalSkillBundles: 0, maxChars: 4000,
    expansionLimit: 0, repairLimit: 0, optionalReview: false };
  const first = { cycleId: 'cycle1', revision: hash('v1'), profile };
  expect(await store.pinHarness(f.principal, context, first)).toEqual(first);
  expect(await f.create().pinHarness(f.principal, context, { ...first, revision: hash('v2') })).toEqual(first);
  await expect(store.pinHarness(f.principal, { ...context, project: 'other' }, first)).rejects.toThrow();
  f.revoke(); await expect(store.pinHarness(f.principal, context, first)).rejects.toThrow();
});
