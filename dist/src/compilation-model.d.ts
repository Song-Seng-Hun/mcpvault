import { type CompilationEvidence } from './compilation-evidence.js';
import { type CompilationOperation } from './compilation-policy.js';
export declare const COMPILATION_STATUSES: readonly ['prepared', 'generated', 'checked', 'applying', 'applied', 'completed', 'partial', 'failed', 'review_required', 'stopped'];
export type CompilationStatus = typeof COMPILATION_STATUSES[number];
export interface CompilationInput {
    path: string;
    revision: string;
    role: 'source' | 'member' | 'concept' | 'topic';
}
export interface CompilationIntent {
    fingerprint: string;
    revision: string;
}
export interface CompilationJob {
    requestId: string;
    requestFingerprint: string;
    projectId: string;
    accountId: string;
    operation: CompilationOperation;
    inputs: CompilationInput[];
    outputPath: string;
    outputRevision: string;
    ruleVersion: string;
    graphContractVersion: number;
    authorityFingerprint: string;
    status: CompilationStatus;
    attempts: number;
    protection: 'pending' | 'ready';
    reason?: string;
    draft?: {
        content: string;
        fingerprint: string;
        generatedAt?: string;
    };
    evidence?: CompilationEvidence;
    refinements?: number;
    validation?: {
        status: 'passed' | 'partial';
        ruleVersion: string;
        basis: string;
    };
    intent?: CompilationIntent;
    applied?: {
        outputRevision: string;
        basis: string;
    };
    receipt?: {
        outputRevision: string;
        basis: string;
    };
}
export interface CompilationHistory {
    version: 1;
    jobs: CompilationJob[];
}
export declare const compilationContentHash: (content: string) => string;
export declare const isCompilationRevision: (value: unknown) => value is string;
export declare const compilationJobRevision: (job: CompilationJob) => string;
export declare const compilationValidationBasis: (job: CompilationJob) => string;
export declare const compilationReceiptBasis: (job: CompilationJob) => string;
export declare const compilationId: (value: unknown) => value is string;
/** Strict bounded receipts. Unknown or damaged history is never silently reset. */
export declare function parseCompilationHistory(value: unknown): CompilationHistory;
//# sourceMappingURL=compilation-model.d.ts.map