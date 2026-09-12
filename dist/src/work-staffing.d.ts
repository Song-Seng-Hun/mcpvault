/** Host-supplied metadata only. Labels never establish authority or capability. */
export interface WorkExecutionProfile {
    accountId: string;
    provider?: string;
    family?: string;
    version?: string;
    reasoning?: string;
    tier: 'economical' | 'standard' | 'frontier' | 'unknown';
    tools: string[];
    capabilities: string[];
    hostVerified: boolean;
    /** Host-attested runtime locality; labels/provider names cannot establish it. */
    executionLocality?: 'local' | 'remote' | 'unknown';
    /** Host-attested suitability, trusted only together with hostVerified. */
    bookkeepingSuitable?: boolean;
    availableBudget?: number;
    /** Estimated cost per recommended perspective, in the caller's budget unit. */
    cost?: number;
}
export interface WorkStaffingAssignment {
    accountId: string;
    perspective: string;
    active?: boolean;
    verified?: boolean;
}
export interface WorkStaffingInput {
    candidates: WorkExecutionProfile[];
    /** Caller has already filtered authority, visibility and project membership. */
    eligibleAccountIds: string[];
    taskType: 'code' | 'research' | 'writing' | 'planning' | 'bookkeeping';
    /** Host confirms deterministic code handles all requested non-review work.
     * Bookkeeping only; this is a routing hint, never permission to run code. */
    deterministicAvailable?: boolean;
    factualVerification?: boolean;
    requiredPerspectives?: string[];
    workKind: 'general' | 'security' | 'permissions' | 'shared_policy' | 'destructive';
    authorAccountIds: string[];
    requesterAccountIds?: string[];
    assigneeAccountIds?: string[];
    currentAssignments: WorkStaffingAssignment[];
    workload: Record<string, number>;
    personalWipLimit: number;
    requiredTools?: string[];
    requiredCapabilities?: string[];
    minimumTier?: WorkExecutionProfile['tier'];
    budget?: number;
    /** Role-to-family order: user preferences, never empirical rankings. */
    preferences?: Record<string, string[]>;
}
export interface WorkStaffingRow {
    perspective: string;
    accountId: string;
    family: string | null;
    tier: WorkExecutionProfile['tier'];
    source: 'existing' | 'recommendation';
    verification: 'declared' | 'verified' | 'independent_review' | 'self_verified';
    reasons: string[];
}
export interface WorkStaffingResult {
    advisory: true;
    /** Bookkeeping routing advice only. High-risk work still needs review. */
    execution?: {
        mode: 'deterministic' | 'local_llm';
        llmRequired: boolean;
    };
    rows: WorkStaffingRow[];
    unfilled: {
        perspective: string;
        reason: 'waiting_host_verification' | 'no_qualified_candidate' | 'independent_review_required' | 'no_verified_local_candidate';
    }[];
    explanations: string[];
    summary: {
        required: number;
        covered: number;
        recommended: number;
        unfilled: number;
        estimatedCost: number;
        unknownCost: boolean;
    };
}
/**
 * Pure, bounded advisory allocation; never establishes access or approves work.
 * Caller must supply every author/requester/assignee account and only visible
 * assignments/profiles. Missing workload means zero, as supplied by the host.
 * active defaults to true. Inactive verified assignments are role history only.
 * Recommendations charge cost per role; sequential hats consume one task WIP
 * slot per account. Existing assignments have already consumed their WIP/cost.
 * Missing family/version/host verification cannot establish new availability.
 */
export declare function recommendStaffing(input: WorkStaffingInput): WorkStaffingResult;
//# sourceMappingURL=work-staffing.d.ts.map