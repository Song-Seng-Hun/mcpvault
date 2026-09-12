/** Shared descriptive vocabulary, never an access grant or inference engine.
 * Version is separate from the existing organization API's serialized entries. */
export declare const GRAPH_CONTRACT_VERSION = 1;
export declare const RELATION_FIELDS: readonly ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'answers_questions', 'tests', 'related', 'same_as', 'close_match', 'version_of', 'refines'];
export declare const RECIPROCAL_RELATIONS: readonly ['related', 'same_as', 'close_match'];
export declare const RELATION_SEMANTICS: readonly [{
    readonly field: 'supports';
    readonly direction: 'directional';
    readonly target: 'A claim, decision, or note supported by this note.';
    readonly reciprocal: false;
}, {
    readonly field: 'contradicts';
    readonly direction: 'directional';
    readonly target: 'A claim or conclusion challenged by this note.';
    readonly reciprocal: false;
}, {
    readonly field: 'supersedes';
    readonly direction: 'directional';
    readonly target: 'An older or replaced note.';
    readonly reciprocal: false;
}, {
    readonly field: 'derived_from';
    readonly direction: 'directional';
    readonly target: 'The source or note from which this note was derived.';
    readonly reciprocal: false;
}, {
    readonly field: 'depends_on';
    readonly direction: 'directional';
    readonly target: 'A prerequisite note, decision, or project.';
    readonly reciprocal: false;
}, {
    readonly field: 'implements';
    readonly direction: 'directional';
    readonly target: 'The design, decision, or requirement implemented here.';
    readonly reciprocal: false;
}, {
    readonly field: 'blocked_by';
    readonly direction: 'directional';
    readonly target: 'The note or dependency currently blocking this note.';
    readonly reciprocal: false;
}, {
    readonly field: 'answers_questions';
    readonly direction: 'directional';
    readonly target: 'A question note answered by this note.';
    readonly reciprocal: false;
}, {
    readonly field: 'tests';
    readonly direction: 'directional';
    readonly target: 'A question, hypothesis, or assumption tested by this experiment.';
    readonly reciprocal: false;
}, {
    readonly field: 'related';
    readonly direction: 'mutual';
    readonly target: 'A materially related note without a stronger claim.';
    readonly reciprocal: true;
}, {
    readonly field: 'same_as';
    readonly direction: 'mutual';
    readonly target: 'The same concept represented by another note or alias.';
    readonly reciprocal: true;
}, {
    readonly field: 'close_match';
    readonly direction: 'mutual';
    readonly target: 'A near-equivalent concept useful for discovery but not safe to merge or treat as exact identity.';
    readonly reciprocal: true;
}, {
    readonly field: 'version_of';
    readonly direction: 'directional';
    readonly target: 'The conceptual note this version belongs to.';
    readonly reciprocal: false;
}, {
    readonly field: 'refines';
    readonly direction: 'directional';
    readonly target: 'A note made more precise or useful by this note.';
    readonly reciprocal: false;
}];
export declare const CLAIM_RELATION_FIELDS: readonly [{
    readonly input: 'supportsClaims';
    readonly property: 'supports_claims';
    readonly relation: 'supports';
}, {
    readonly input: 'contradictsClaims';
    readonly property: 'contradicts_claims';
    readonly relation: 'contradicts';
}, {
    readonly input: 'dependsOnClaims';
    readonly property: 'depends_on_claims';
    readonly relation: 'depends_on';
}];
/** Backlink labels are a projection, not additional authored relation fields. */
export declare const CLAIM_GRAPH_RELATIONS: {
    field: "contradicts_claims" | "depends_on_claims" | "supports_claims";
    relation: "claim_contradicts" | "claim_depends_on" | "claim_supports";
}[];
export declare const RELATION_TARGET_KIND_RULES: readonly [{
    readonly relation: 'answers_questions';
    readonly kinds: readonly ['question'];
    readonly reason: 'answers_questions targets must have note_kind: question.';
}, {
    readonly relation: 'tests';
    readonly kinds: readonly ['question', 'hypothesis', 'assumption'];
    readonly reason: 'tests targets must have note_kind: question, hypothesis, or assumption.';
}];
/** Callers retain their existing normalization and ACL checks. Unknown relations
 * are not rejected here: this helper only expresses the two existing rules. */
export declare function typedRelationTargetKindReason(relation: string, targetKind: string): string | undefined;
/** Opt-in question retrieval is intentionally narrower than the authored graph.
 * Evidence is virtual. Declaration groups preserve ordering around source pins. */
export declare const QUESTION_GRAPH_PROFILE: {
    readonly relations: readonly ['evidence', 'supports', 'contradicts', 'depends_on', 'derived_from'];
    readonly priorityRelations: readonly ['contradicts', 'depends_on'];
    readonly contextRelations: readonly ['supports', 'derived_from'];
    readonly reverseRelations: readonly ['contradicts', 'claim_contradicts'];
};
//# sourceMappingURL=graph-contract.d.ts.map