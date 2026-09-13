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
/** Verbatim preservation is distinct from literal correspondence and semantic
 * understanding. Natural-language obligations require the entire selected span
 * to survive unchanged; matching a number cannot establish a condition/negation.
 * This does not broaden the literal checker's scope or certify omitted facts. */
export declare function checkFidelityPreservation(input: FidelityLiteralInput, kind: 'condition' | 'negation' | 'counterexample' | 'contradiction' | 'number' | 'date' | 'version' | 'quote'): {
    literal: FidelityLiteralResult;
    verbatim: string;
    preserved: boolean;
    semanticJudgment: 'not_assessed';
};
//# sourceMappingURL=fidelity-literals.d.ts.map