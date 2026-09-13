import type { EvidenceLocator } from './evidence-locator.js';
import type { FidelityFact } from './fidelity-service.js';
import type { CompilationInput } from './compilation-model.js';
export interface CompilationEvidence {
    query: string;
    decision: 'new_knowledge' | 'extend_existing' | 'already_covered' | 'conflicting' | 'uncertain';
    facts: Array<FidelityFact & {
        sourcePath: string;
    }>;
    coverage: Array<{
        sourcePath: string;
        locator: EvidenceLocator;
    }>;
    rationale?: {
        constraints: string[];
        rejectedAlternatives: Array<{
            option: string;
            reason: string;
        }>;
        failureConditions: string[];
    };
}
export declare function compilationLocator(value: unknown, expectedRevision: string): EvidenceLocator;
/** Bounds and pins reports. Actual source content, completeness and semantic
 * correspondence are checked separately; a client report is not a pass. */
export declare function normalizeCompilationEvidence(value: unknown, inputs: readonly CompilationInput[], draft: {
    content: string;
    fingerprint: string;
}): CompilationEvidence;
export declare function retainsCompilationObligations(previous: CompilationEvidence, next: CompilationEvidence): boolean;
//# sourceMappingURL=compilation-evidence.d.ts.map