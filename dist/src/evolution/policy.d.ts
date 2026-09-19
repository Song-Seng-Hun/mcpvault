export type TargetKind = 'skill' | 'wiki' | 'persona' | 'computer' | 'fiction' | 'harness';
export interface Target {
    kind: TargetKind;
    id: string;
    path?: string;
}
export interface Scope {
    kind: 'account' | 'owner' | 'project' | 'computer' | 'scene' | 'session';
    id: string;
}
export interface Evidence {
    path: string;
    revision: string;
}
export interface FeedbackProof {
    origin: 'human' | 'host_observation';
    eventId: string;
    taskId: string;
    sessionId: string;
    observedAt: string;
}
export declare const CAUSES: readonly ['search', 'knowledge', 'procedure', 'expression', 'environment', 'tool_failure', 'unknown'];
export interface Feedback {
    id: string;
    taskId: string;
    sessionId: string;
    target: Target;
    scope: Scope;
    kind: string;
    signal: 'explicit' | 'implicit';
    key: string;
    value: string;
    summary: string;
    basis: Evidence[];
    origin: FeedbackProof['origin'] | 'agent_report';
    eventId: string;
    observedAt: string;
    withdrawn: boolean;
    cause: typeof CAUSES[number];
}
export interface Preference {
    key: string;
    value: string;
    scope: Scope;
    cycleId: string;
}
export declare const hash: (v: unknown) => string;
export declare const unavailable: () => never;
export declare function object(v: unknown, keys: readonly string[]): Record<string, any>;
export declare const id: (v: unknown) => string;
export declare const revision: (v: unknown) => string;
export declare function text(v: unknown, max?: number): string;
export declare function target(v: unknown): Target;
export declare function scope(v: unknown): Scope;
export declare const STYLE_VALUES: Readonly<Record<string, readonly string[]>>;
export declare function style(key: unknown, value: unknown): {
    key: string;
    value: string;
};
export declare function normalizeFeedback(v: unknown, proof?: FeedbackProof): Feedback;
export declare const feedbackGroup: (f: Feedback) => string;
export declare function repetitionReady(feedback: readonly Feedback[], now: number): boolean;
export interface Evaluation {
    profileRevision: string;
    safety: boolean;
    targetCaseIds: string[];
    /** Host evaluator provenance. Missing provenance never counts as an operational trial. */
    method?: 'static' | 'synthetic' | 'agent_behavior' | 'operational';
    receiptHash?: string;
    cases: {
        id: string;
        split: string;
        baseline: boolean;
        candidate: boolean;
        withoutSkill?: boolean;
    }[];
    baselineTokens?: number;
    candidateTokens?: number;
    withoutSkillTokens?: number;
    baselineMs?: number;
    candidateMs?: number;
    trials?: EvaluationTrial[];
}
export type EvaluationTrial = Pick<Evaluation, 'cases' | 'safety' | 'baselineTokens' | 'candidateTokens' | 'withoutSkillTokens' | 'baselineMs' | 'candidateMs'>;
export declare const median: (values: number[]) => number;
export declare function compareEvaluation(kind: TargetKind, e: Evaluation): {
    status: 'passed' | 'failed' | 'review_required';
    reason: string;
};
export declare function selectPreferences(items: readonly Preference[], context: Record<string, string>): {
    preferences: Preference[];
    conflicts: string[];
    partial: boolean;
};
//# sourceMappingURL=policy.d.ts.map