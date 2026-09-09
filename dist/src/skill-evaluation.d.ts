export interface SkillEvaluationProfile {
    id: string;
    revision: string;
    skillId: string;
    caseIds: readonly string[];
    targetCaseIds: readonly string[];
    maxDurationMs: number;
    evaluate: (input: Readonly<SkillEvaluationInput> & {
        signal: AbortSignal;
    }) => Promise<{
        risk: 'low' | 'approval_required' | 'unknown';
        cases: Array<{
            id: string;
            baseline: boolean;
            candidate: boolean;
        }>;
    }>;
}
export interface SkillEvaluationInput {
    skillId: string;
    baseline: string;
    candidate: string;
}
export interface SkillEvaluationResult {
    status: 'passed' | 'failed' | 'review_required';
    reason: string;
    profileFingerprint?: string;
    cases: Array<{
        id: string;
        baseline: boolean;
        candidate: boolean;
    }>;
}
/** Returns an identity-binding digest, or undefined when the profile cannot safely be used. */
export declare function profileFingerprint(profile: SkillEvaluationProfile | undefined): string | undefined;
/**
 * Invokes only the pre-registered trusted host callback. Candidate strings are
 * immutable input data; they are never parsed as code, imported, or executed.
 */
export declare function evaluateSkill(profile: SkillEvaluationProfile | undefined, input: SkillEvaluationInput): Promise<SkillEvaluationResult>;
/** Returns visible procedure lines, suppressing complete and unterminated Markdown fence blocks. */
export declare function proceduralLines(content: string): string[];
//# sourceMappingURL=skill-evaluation.d.ts.map