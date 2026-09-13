import type { CompilationInput } from './compilation-model.js';
import type { CompilationOperation } from './compilation-policy.js';
import type { EvidenceLocator } from './evidence-locator.js';
/** An attributed agent report, not a draft body or a claim of semantic truth. */
export interface CompilationObservation {
    kind: 'source_only' | 'already_covered';
    reason: string;
    query?: string;
    coverage: Array<{
        sourcePath: string;
        locator: EvidenceLocator;
    }>;
    matches?: Array<{
        sourcePath: string;
        sourceLocator: EvidenceLocator;
        knowledgePath: string;
        knowledgeLocator: EvidenceLocator;
        semanticJudgment: 'covered' | 'uncertain';
    }>;
}
export declare function normalizeCompilationObservation(value: unknown, inputs: readonly CompilationInput[], operation: CompilationOperation): CompilationObservation;
//# sourceMappingURL=compilation-observation.d.ts.map