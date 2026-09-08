import type { EconomyPolicy, EconomyState, QuestContract } from './economy-model.js';

const DAY = 86_400_000;
/** Read-time projection. Elapsed time never settles, refunds or assigns work. */
export function questAttention(contract: QuestContract, at: string): 'none' | 'independent_review_due' | 'operator_attention' {
  if (['draft','funded','settled','cancelled'].includes(contract.status)) return 'none';
  const basis = contract.status === 'disputed' ? contract.updatedAt
    : contract.status === 'submitted' ? contract.submission?.at : contract.terms.deadline;
  if (!basis) return 'none';
  const elapsed = Date.parse(at) - Date.parse(basis);
  const escalationDelay = contract.status === 'disputed' ? 0 : 2 * DAY;
  if (elapsed >= escalationDelay + 7 * DAY) return 'operator_attention';
  return elapsed >= escalationDelay ? 'independent_review_due' : 'none';
}
export function assertSubjectiveAdmission(state: EconomyState, at: string): void {
  if (Object.values(state.contracts).some(c => c.terms.kind !== 'mechanical' && questAttention(c,at) === 'operator_attention')) {
    throw new Error('Operator attention overdue; new subjective contracts are suspended. Existing escrow is unchanged.');
  }
}
export function reserveTreasuryBudget(state: EconomyState, policy: EconomyPolicy, at: string, amount: number): void {
  // Absent on historical policies: do not reinterpret already committed events.
  if (policy.treasuryWeeklyBudget === undefined) return;
  const cutoff = Date.parse(at) - 7 * DAY;
  const entries = (state.treasuryDisbursements || []).filter(item => Date.parse(item.at) > cutoff);
  if (entries.reduce((n,item) => n + item.amount,0) + amount > policy.treasuryWeeklyBudget) throw new Error('Treasury weekly budget exceeded');
  state.treasuryDisbursements = [...entries,{at,amount}];
}
