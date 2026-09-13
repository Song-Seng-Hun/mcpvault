import { type EvidenceLocator } from './evidence-locator.js';
export interface FidelitySnapshot {
    body: string;
    revision: string;
}
export interface FidelityLiteralInput {
    source?: FidelitySnapshot | undefined;
    output?: FidelitySnapshot | undefined;
    sourceLocator: EvidenceLocator;
    outputLocator?: EvidenceLocator | undefined;
    comparisonMode: 'exact' | 'translation' | 'calculation' | 'ambiguous_unit';
}
export interface FidelityLiteralResult {
    status: 'match' | 'suspect' | 'out_of_scope' | 'unavailable';
    kinds: string[];
    semanticJudgment: 'not_assessed';
}
/** Pure local correspondence only. The caller must first establish current ACL,
 * immutable source integrity and revision. This never emits source text, decides
 * semantic preservation, grants publication, or invokes an external provider. */
export declare function checkFidelityLiterals(input: FidelityLiteralInput): FidelityLiteralResult;
//# sourceMappingURL=fidelity-literals.d.ts.map