import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare const COMPILATION_OPERATIONS: readonly ['index', 'synthesize', 'embed', 'vision', 'convert'];
export type CompilationOperation = typeof COMPILATION_OPERATIONS[number];
export interface CompilationSourcePolicy {
    path: string;
    classification: 'resolved' | 'unresolved';
    mode: 'source_only' | 'synthesis_allowed';
}
export interface CompilationBundleGrant {
    documentPath: string;
    documentId: string;
    chapterRoot: string;
    publication?: 'verbatim';
    processing?: 'verbatim';
}
export interface CompilationProject {
    id: string;
    ruleVersion: string;
    sources: CompilationSourcePolicy[];
    outputPaths: string[];
    /** Exact owner-service route, not a generic Community write grant. */
    outputOwner?: 'wiki_knowledge';
    runtimeIds: string[];
    operations: CompilationOperation[];
    /** Separate explicit grant; existing output/maintenance rights do not imply it. */
    chapterBundles?: CompilationBundleGrant[];
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
/** Generic migration must not take ownership of service records or templates. */
export declare const ordinaryCompilationDocument: (path: string) => boolean;
/** Deliberately case-exact service namespace; no aliases or nested service roots. */
export declare const wikiKnowledgeOutput: (path: string) => boolean;
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
    outputOwner?: 'wiki_knowledge';
}): CompilationAdmission;
//# sourceMappingURL=compilation-policy.d.ts.map