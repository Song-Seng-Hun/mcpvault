import { test, expect } from 'vitest';
import { EvolutionOpportunity } from './opportunity.js';
test('Plan mode, no new evidence and missing approved session never call the generator', async () => {
  let calls = 0; const runner = new EvolutionOpportunity();
  const session: any = { generate: async () => { calls++; return {}; } };
  for (const request of [{ planMode: true, newEvidence: true }, { planMode: false, newEvidence: false }]) {
    expect((await runner.run({ ...request, cycleId: 'one' }, session)).status).toBe('diagnostic_only');
  }
  expect((await runner.run({ cycleId: 'one', newEvidence: true }, undefined)).status).toBe('diagnostic_only');
  expect(calls).toBe(0);
});
test('insufficient evidence never spends a generation opportunity', async () => {
  let generated = 0;
  const session: any = { authorize: async () => {}, current: async () => ({ status: 'review_required', reason: 'unverified_or_insufficient_signal', attempts: 0 }),
    generate: async () => { generated++; throw Error('must not run'); } };
  expect((await new EvolutionOpportunity().run({ cycleId: 'one', newEvidence: true }, session)).reason).toBe('unverified_or_insufficient_signal');
  expect(generated).toBe(0);
});
test('one opportunity is one cycle, at most two candidates and one refinement', async () => {
  const runner = new EvolutionOpportunity(); let generated = 0, applied = 0;
  const session: any = { authorize: async () => {}, current: async () => ({ status: 'observed', attempts: 0, revision: 'r' }),
    generate: async () => ({ candidate: { index: ++generated } }),
    evaluate: async () => ({ status: generated === 1 ? 'review_required' : 'evaluated', revision: `r${generated}` }),
    apply: async () => { applied++; return { status: 'applied' }; } };
  expect((await runner.run({ cycleId: 'one', newEvidence: true }, session)).status).toBe('applied');
  expect([generated, applied]).toEqual([2, 1]);
});
test('late generator after cancellation cannot evaluate or apply, and does not overlap another opportunity', async () => {
  const runner = new EvolutionOpportunity(), cancel = new AbortController(); let release!: (v: any) => void, writes = 0;
  const session: any = { authorize: async () => {}, current: async () => ({ status: 'observed', attempts: 0, revision: 'r' }),
    generate: async () => new Promise(resolve => { release = resolve; }),
    evaluate: async () => { writes++; return {}; }, apply: async () => { writes++; return {}; } };
  const pending = runner.run({ cycleId: 'one', newEvidence: true, signal: cancel.signal }, session);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  expect((await runner.run({ cycleId: 'two', newEvidence: true }, session)).status).toBe('deferred');
  cancel.abort(); expect((await pending).status).toBe('interrupted');
  expect((await runner.run({ cycleId: 'two', newEvidence: true }, session)).status).toBe('deferred');
  release({ candidate: {} }); await new Promise(resolve => setTimeout(resolve, 0));
  expect(writes).toBe(0);
});
