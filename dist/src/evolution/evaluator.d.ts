import { type Evaluation, type Target, type TargetKind } from './policy.js';
import type { Cycle } from './model.js';
import type { ScopePrincipal } from '../scope-auth.js';
export interface CaseOutcome {
    passed: boolean;
    safety: boolean;
    resultHash: string;
    tokens?: number;
    elapsedMs?: number;
}
export interface EvaluationCase {
    id: string;
    split: 'development' | 'holdout';
    target?: boolean;
    /** Code-owned implementation; private inputs/answers live in this closure, never in profile metadata. */
    run(input: {
        variant: 'baseline' | 'candidate' | 'withoutSkill';
        cycle: Readonly<Cycle>;
        signal: AbortSignal;
        trial: number;
        principal?: ScopePrincipal;
    }): Promise<CaseOutcome>;
}
export interface EvaluationProfile {
    kind: TargetKind;
    revision: string;
    method: NonNullable<Evaluation['method']>;
    cases: readonly EvaluationCase[];
    repetitions?: 3;
    measurementScope?: Evaluation['measurementScope'];
    adoption?: 'diagnostic';
}
/** Runs checks, not model self-reports. Sequential trials avoid parallel memory spikes.
 * The host must install actual, reviewed checks; absent checks remain unavailable.
 */
export declare class EvolutionEvaluator {
    private readonly profiles;
    constructor(profiles: readonly EvaluationProfile[]);
    profile(target: Target): {
        revision: string;
        caseIds: string[];
        targetCaseIds: string[];
        holdoutCaseIds: string[];
    } | undefined;
    evaluate(input: Readonly<Cycle>, signal: AbortSignal, principal?: ScopePrincipal): Promise<Evaluation>;
}
//# sourceMappingURL=evaluator.d.ts.map