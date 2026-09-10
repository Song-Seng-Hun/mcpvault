import type { WorkExecutionProfile } from './work-staffing.js';
export interface ExplanationSource {
    path: string;
    revision: string;
    content: string;
}
export interface ExplanationBlock {
    text: string;
    startLine: number;
    endLine: number;
    example?: boolean;
}
export interface ExplanationDraft {
    blocks: ExplanationBlock[];
}
export declare const EXPLANATION_CRITERIA: readonly ['fidelity', 'coverage', 'no_invention', 'clarity'];
export interface ExplanationReview {
    checks: Array<{
        criterion: typeof EXPLANATION_CRITERIA[number];
        verdict: 'pass' | 'changes' | 'uncertain';
        reason: string;
        blockIndices: number[];
    }>;
}
/** Revision is authoritative. Content is checked separately by the source reader. */
export declare function explanationKey(source: ExplanationSource, language?: string, audience?: string): string;
export declare function validateExplanationDraft(input: unknown, source: ExplanationSource): ExplanationDraft;
export declare function validateExplanationReview(input: unknown, blockCount: number): ExplanationReview;
export declare function verifiedExplanationProfile(profiles: WorkExecutionProfile[], account: string): WorkExecutionProfile | undefined;
/** Pin the execution identity/policy, not volatile prices or remaining budget. */
export declare function explanationProfileFingerprint(profiles: WorkExecutionProfile[], account: string): string | undefined;
export declare function explanationApproval(input: {
    sourceRevision: string;
    currentRevision: string;
    author: string;
    reviewer: string;
    profiles: WorkExecutionProfile[];
    review: ExplanationReview;
}): {
    approved: boolean;
    reason: string;
};
//# sourceMappingURL=explanation-model.d.ts.map