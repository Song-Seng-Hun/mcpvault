import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare const COMPILATION_OPERATIONS: readonly ['index', 'synthesize', 'embed', 'vision', 'convert'];
export type CompilationOperation = typeof COMPILATION_OPERATIONS[number];
export interface CompilationSourcePolicy {
    path: string;
    classification: 'resolved' | 'unresolved';
    mode: 'source_only' | 'synthesis_allowed';
}
export interface CompilationProject {
    id: string;
    ruleVersion: string;
    sources: CompilationSourcePolicy[];
    outputPaths: string[];
    runtimeIds: string[];
    operations: CompilationOperation[];
}
export interface CompilationConfig {
    version: 1;
    enabled: boolean;
    accountId: string;
    projects: CompilationProject[];
}
/** Only returned by a trusted host verifier. Provider/model/client names are not verification. */
export interface CompilationRuntime {
    id: string;
    revision: string;
    local: boolean;
    operations: readonly CompilationOperation[];
}
export type CompilationAdmission = {
    status: 'ready';
    fingerprint: string;
    sourceFingerprint: string;
} | {
    status: 'diagnostic_only' | 'unavailable' | 'review_required' | 'waiting_runtime';
    fingerprint?: never;
};
export declare const compilationHash: (value: unknown) => string;
/** Exact physical Markdown paths. Never normalize a wildcard, traversal or alias into a grant. */
export declare function compilationPath(value: unknown): string;
export declare function validateCompilationConfig(value: unknown): CompilationConfig;
/** Admission is metadata-only and emits no rejected path, title, count or department. */
export declare function inspectCompilationPolicy(params: {
    config?: CompilationConfig;
    projectId: string;
    principal?: ScopePrincipal;
    access: ScopeAccessPolicy;
    paths: string[];
    outputPath: string;
    operation: CompilationOperation;
    runtime?: CompilationRuntime;
}): CompilationAdmission;
//# sourceMappingURL=compilation-policy.d.ts.map