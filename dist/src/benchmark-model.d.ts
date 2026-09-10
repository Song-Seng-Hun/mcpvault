import { fingerprint } from './work-model.js';
export declare const BENCHMARK_MAX_TEXT = 12000;
export declare const benchmarkFingerprint: typeof fingerprint;
export type BenchmarkGrade = 'pass' | 'fail' | 'indeterminate';
export type BenchmarkGrader = {
    kind: 'exact';
} | {
    kind: 'structured_json';
} | {
    kind: 'numeric';
    absoluteTolerance: number;
};
export interface BenchmarkSource {
    path: string;
    revision: string;
}
export interface BenchmarkCriterion {
    id: string;
    description: string;
    minimum: number;
}
export interface BenchmarkDefinition {
    id: string;
    lineage: string;
    version: string;
    title: string;
    problem: string;
    sources: BenchmarkSource[];
    rubric: BenchmarkCriterion[];
    deadline: string;
    allowedTools: string[];
    mode: 'objective' | 'peer';
    answerKnown: boolean;
    grader?: BenchmarkGrader;
    reward: number;
    maxWinners: number;
    cap: number;
    qualityThreshold: number;
    participants: string[];
    reviewers: string[];
    allowSameOwnerReview: boolean;
}
export interface BenchmarkProfile {
    accountId: string;
    ownerId: string;
    modelFamily: string;
    approved: boolean;
    modelVerified: boolean;
}
export interface BenchmarkCriterionReview {
    criterion: string;
    score: number;
    reason: string;
    sources: BenchmarkSource[];
    uncertainty: string;
    evidence: 'supported' | 'contradicted' | 'uncertain';
}
export interface BenchmarkReview {
    id: string;
    account: string;
    owner: string;
    modelFamily: string;
    entryId: string;
    criteria: BenchmarkCriterionReview[];
    resolutionOf: string[];
}
export declare function benchmarkId(v: unknown): string;
export declare function benchmarkObject(v: unknown, keys: readonly string[]): Record<string, unknown>;
export declare function benchmarkInteger(v: unknown, min: number, max: number): number;
export declare function benchmarkPath(value: unknown): string;
export declare function benchmarkSources(value: unknown): BenchmarkSource[];
export declare function validateBenchmarkDefinition(value: unknown): BenchmarkDefinition;
export declare function gradeBenchmark(grader: BenchmarkGrader, answer: unknown, submission: unknown): BenchmarkGrade;
export declare function validateBenchmarkReview(value: unknown, d: BenchmarkDefinition): Pick<BenchmarkReview, 'entryId' | 'criteria' | 'resolutionOf'>;
export declare function benchmarkPass(d: BenchmarkDefinition, scores: number[]): boolean;
export declare function evaluateBenchmarkPeer(d: BenchmarkDefinition, reviews: BenchmarkReview[]): {
    state: 'held' | 'pass' | 'fail';
    scores: number[];
};
export declare function rankBenchmark(d: BenchmarkDefinition, entries: Array<{
    entryId: string;
    sequence: number;
    scores: number[];
}>): string[];
//# sourceMappingURL=benchmark-model.d.ts.map