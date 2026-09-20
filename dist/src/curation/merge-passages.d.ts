interface Input {
    path: string;
    content: string;
    revision: string;
    frontmatter: Record<string, unknown>;
}
export interface PassageMapping {
    path: string;
    revision: string;
    sourceStart: number;
    sourceEnd: number;
    outputStart: number;
    outputEnd: number;
}
/** Lossless, locally checkable union. No free-text synthesis or semantic claim.
 * Existing canonical bytes stay first, preserving their original anchor order.
 * Wider metadata/link migrations use review rather than guessing equivalence. */
export declare function mergePassages(source: Input, canonical: Input): {
    status: 'review_required';
    reason: string;
} | {
    status: 'ready';
    content: string;
    coverage: PassageMapping[];
    semanticJudgment: 'not_inferred';
};
export {};
//# sourceMappingURL=merge-passages.d.ts.map