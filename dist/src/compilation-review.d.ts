import type { CompilationJob } from './compilation-model.js';
export interface CompilationFinding {
    path: string;
    revision: string;
    code: string;
    basis: string;
    attribution: 'agent_report' | 'mechanical';
    affectedEvidence?: Array<{
        path: string;
        revision: string;
    }>;
    nextAction: {
        endpointId: 'wiki.compilation';
        arguments: {
            op: 'read';
            requestId: string;
            expectedJobRevision: string;
            includeInspection: true;
            maxChars: number;
        };
    };
}
/** Validated paths only; no agent prose, query, draft or hidden job counters. */
export declare function compilationFindings(job: CompilationJob, path: string, revision: string, drift?: string): CompilationFinding[];
//# sourceMappingURL=compilation-review.d.ts.map