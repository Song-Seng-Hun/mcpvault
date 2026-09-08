import type { EconomyPolicy, EconomyState, QuestContract } from './economy-model.js';
/** Read-time projection. Elapsed time never settles, refunds or assigns work. */
export declare function questAttention(contract: QuestContract, at: string): 'none' | 'independent_review_due' | 'operator_attention';
export declare function assertSubjectiveAdmission(state: EconomyState, at: string): void;
export declare function reserveTreasuryBudget(state: EconomyState, policy: EconomyPolicy, at: string, amount: number): void;
//# sourceMappingURL=economy-operations.d.ts.map