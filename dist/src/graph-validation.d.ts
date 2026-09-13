export interface ParsedClaimReference {
    raw: string;
    document: string;
    blockId: string;
}
export declare function claimId(value: string | undefined, index: number): string;
export declare function parseClaimReference(value: unknown): ParsedClaimReference;
export declare function blockAnchorLineIndex(content: string): Map<string, number[]>;
/** Descriptive local profiles. Existing lint/preview retains severity, ACL and
 * bounded scope; this is not a SHACL engine or a new write-policy layer. */
export declare const GRAPH_VALIDATION_PROFILES: readonly [{
    readonly id: 'identity';
    readonly checks: readonly ['aliases', 'preferred_term', 'stable_id'];
    readonly authority: 'existing_lint_preview';
}, {
    readonly id: 'typed_target';
    readonly checks: readonly ['answers_questions', 'tests'];
    readonly authority: 'existing_lint_preview';
}, {
    readonly id: 'claim';
    readonly checks: readonly ['normalized_id', 'unique_id', 'block_anchor', 'relation_reference'];
    readonly authority: 'existing_lint_preview';
}, {
    readonly id: 'evidence';
    readonly checks: readonly ['source_revision', 'exact_locator'];
    readonly authority: 'existing_lint_preview';
}, {
    readonly id: 'cycles';
    readonly checks: readonly ['depends_on', 'moc_parent'];
    readonly authority: 'existing_lint_preview';
}];
//# sourceMappingURL=graph-validation.d.ts.map