export type ResearchEvidence = {
    path: string;
    revision: string;
};
export type ResearchSubmission = {
    candidate: string;
    conditions: string;
    failedSearches: string;
    uncertainties: string;
    evidence: ResearchEvidence[];
};
export type ResearchReview = {
    targetAccountId: string;
    targetFingerprint: string;
    disposition: 'support' | 'challenge' | 'alternative';
    rationale: string;
    evidence: ResearchEvidence[];
};
export type ResearchConfig = {
    question: string;
    constraints: string[];
    participants: string[];
    budgetMinutes: number;
};
export declare function validateResearchConfig(value: unknown): ResearchConfig;
export declare function validateResearchSubmission(value: unknown): ResearchSubmission;
export declare function validateResearchReview(value: unknown): ResearchReview;
export declare function researchFingerprint(value: unknown): string;
//# sourceMappingURL=independent-research-model.d.ts.map