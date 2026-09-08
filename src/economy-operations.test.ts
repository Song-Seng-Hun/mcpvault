import { expect, it } from 'vitest';
import { applyEconomyCommand, initialEconomy, economyRevision, type EconomyState, type EconomyPolicy } from './economy-model.js';

const at = '2026-09-08T00:00:00.000Z';
const policy: EconomyPolicy = {
  version: 1, revision: 'operations-1', enabled: true, treasury: 'treasury', operators: ['operator'],
  owners: { treasury: 'host', alice: 'a', alice2: 'a', bob: 'b', reviewer: 'c' }, reviewers: ['reviewer'],
  subjectiveReview: true, maxSupply: 5000, minReward: 10, maxReward: 100, postingFee: 2, reviewFee: 5,
  dailySpend: 107, dailyPosts: 1, openContracts: 2, treasuryWeeklyBudget: 500,
};
function seed() { return applyEconomyCommand(initialEconomy(), { op: 'issue', actor: 'operator', requestId: 'issue', amount: 5000, reason: 'isolated pilot' }, policy, at).state; }
function allocate(s: EconomyState, amount: number, account: string, requestId: string, time = at) {
  return applyEconomyCommand(s, { op: 'allocate', actor: 'operator', requestId, amount, account, reason: 'approved budget' }, policy, time);
}
it('caps aggregate treasury disbursement, not per recipient or operator request', () => {
  let s = allocate(seed(), 300, 'alice', 'a').state;
  s = allocate(s, 200, 'bob', 'b').state;
  expect(() => allocate(s, 1, 'alice2', 'overflow')).toThrow(/treasury.*budget/i);
  expect(allocate(s, 200, 'bob', 'b').state).toEqual(s);
  expect(allocate(s, 1, 'alice2', 'next-week', '2026-09-16T00:00:00.000Z').state.balances.alice2).toBe(1);
});
it('stops new subjective funding after overdue escalation while preserving escrow and mechanical work', () => {
  let s = allocate(seed(), 300, 'alice', 'a').state;
  const terms = { taskId: 'one', taskRevision: 'a'.repeat(64), title: 'Research', criteria: ['report uncertainty'], exclusions: [], reward: 10,
    kind: 'research' as const, deadline: '2026-10-01T00:00:00.000Z', verifier: 'independent-review-v1' };
  s = applyEconomyCommand(s, { op: 'draft', actor: 'alice', requestId: 'd', contractId: 'one', expectedRevision: 'missing', terms }, policy, at).state;
  s = applyEconomyCommand(s, { op: 'fund', actor: 'alice', requestId: 'f', contractId: 'one', expectedRevision: economyRevision(s.contracts.one) }, policy, at).state;
  s = applyEconomyCommand(s, { op: 'claim', actor: 'bob', requestId: 'c', contractId: 'one', expectedRevision: economyRevision(s.contracts.one), expectedGeneration: 0 }, policy, at).state;
  s = applyEconomyCommand(s, { op: 'submit', actor: 'bob', requestId: 's', contractId: 'one', expectedRevision: economyRevision(s.contracts.one), expectedGeneration: 1,
    artifacts: [{ path: 'Knowledge/result.md', revision: 'b'.repeat(64) }] }, policy, at).state;
  const later = '2026-09-18T00:00:00.000Z';
  expect(() => applyEconomyCommand(s, { op: 'draft', actor: 'alice', requestId: 'd2', contractId: 'two', expectedRevision: 'missing', terms: { ...terms, taskId: 'two' } }, policy, later)).toThrow(/operator.*attention/i);
  expect(s.contracts.one.escrow).toBe(15);
  expect(applyEconomyCommand(s, { op: 'draft', actor: 'alice', requestId: 'd3', contractId: 'two', expectedRevision: 'missing', terms: { ...terms, taskId: 'two', kind: 'mechanical', verifier: 'markdown-literal-v1' } }, policy, later).state.contracts.two.status).toBe('draft');
});
