/** Spendable XP is NOT reputation. Only host approvals introduce supply. */
export interface EconomyPolicy {
    version: 1;
    revision: string;
    enabled: boolean;
    treasury: string;
    operators: string[];
    owners: Record<string, string>;
    reviewers: string[];
    subjectiveReview: boolean;
    maxSupply: number;
    minReward: number;
    maxReward: number;
    postingFee: number;
    reviewFee: number;
    dailySpend: number;
    dailyPosts: number;
    openContracts: number;
    /** Host-approved rolling seven-day disbursement cap, not new supply. */
    treasuryWeeklyBudget?: number;
}
export interface QuestArtifact {
    path: string;
    revision: string;
}
export interface QuestWorkBinding {
    revision: string;
    generation: number;
    requestId: string;
}
export interface QuestTerms {
    taskId: string;
    taskRevision: string;
    title: string;
    criteria: string[];
    exclusions: string[];
    reward: number;
    kind: 'research' | 'creative' | 'mechanical';
    deadline: string;
    verifier: string;
}
export interface QuestContract {
    id: string;
    requester: string;
    requesterOwner: string;
    terms: QuestTerms;
    policyRevision: string;
    reviewFee: number;
    postingFee: number;
    escrow: number;
    status: 'draft' | 'funded' | 'claimed' | 'submitted' | 'changes_requested' | 'disputed' | 'settled' | 'cancelled';
    generation: number;
    createdAt: string;
    updatedAt: string;
    fundedAt?: string;
    worker?: string;
    workerOwner?: string;
    reviewer?: string;
    reviewerOwner?: string;
    workBinding?: QuestWorkBinding;
    submission?: {
        artifacts: QuestArtifact[];
        basis: string;
        at: string;
    };
    review?: {
        actor: string;
        verdict: string;
        reason: string;
        artifact: QuestArtifact;
        basis: string;
        at: string;
    };
    revisionRequests: number;
    disputeReason?: string;
    claimRecovery?: {
        operator: string;
        reason: string;
        at: string;
        requestId: string;
    };
}
export interface EconomyCommand {
    op: 'issue' | 'allocate' | 'draft' | 'fund' | 'claim' | 'recover_claim' | 'submit' | 'cancel' | 'review' | 'dispute' | 'resolve';
    actor: string;
    requestId: string;
    contractId?: string;
    expectedRevision?: string;
    expectedGeneration?: number;
    amount?: number;
    account?: string;
    reason?: string;
    terms?: QuestTerms;
    artifacts?: QuestArtifact[];
    verdict?: 'approve' | 'changes_requested' | 'dispute';
    basis?: string;
    reviewArtifact?: QuestArtifact;
    /** Internal Work adapter receipt; never part of the public input schema. */
    workBinding?: QuestWorkBinding;
}
export interface EconomyReceipt {
    transactionId: string;
    sequence: number;
    contractId?: string;
    revision?: string;
    status?: string;
}
export interface EconomyState {
    issued: number;
    sequence: number;
    balances: Record<string, number>;
    contracts: Record<string, QuestContract>;
    requests: Record<string, {
        payload: string;
        result: EconomyReceipt;
    }>;
    treasuryDisbursements?: {
        at: string;
        amount: number;
    }[];
}
export declare const economyRevision: (value: unknown) => string;
export declare const initialEconomy: () => EconomyState;
export declare function validateEconomyPolicy(p: EconomyPolicy): EconomyPolicy;
export declare function assertEconomyConservation(s: EconomyState): void;
/** Deterministic transitions. Policy and original command accompany each journal event.
 * Live permission, visible exact artifacts and trusted verifier checks belong to the
 * adapter immediately before this reducer, never to caller-authored receipts. */
export declare function economyRetry(state: EconomyState, command: EconomyCommand): EconomyReceipt | undefined;
/** Shared read-only owner/deadline/WIP gate. Projection callers compute busy
 * once, without cloning/reducing the complete financial history per candidate. */
export declare function questClaimAuthority(contract: QuestContract, worker: string, p: EconomyPolicy, at: string, busy: boolean, recovering?: boolean): {
    workerOwner: string;
    reviewer: string | undefined;
};
export declare function applyEconomyCommand(input: EconomyState, command: EconomyCommand, rawPolicy: EconomyPolicy, now: string): {
    state: EconomyState;
    receipt: EconomyReceipt;
};
//# sourceMappingURL=economy-model.d.ts.map