/** Shared descriptive vocabulary, never an access grant or inference engine.
 * Version is separate from the existing organization API's serialized entries. */
export const GRAPH_CONTRACT_VERSION = 1;
export const RELATION_FIELDS = ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'answers_questions', 'tests', 'related', 'same_as', 'close_match', 'version_of', 'refines'];
export const RECIPROCAL_RELATIONS = ['related', 'same_as', 'close_match'];
export const RELATION_SEMANTICS = [
    { field: 'supports', direction: 'directional', target: 'A claim, decision, or note supported by this note.', reciprocal: false },
    { field: 'contradicts', direction: 'directional', target: 'A claim or conclusion challenged by this note.', reciprocal: false },
    { field: 'supersedes', direction: 'directional', target: 'An older or replaced note.', reciprocal: false },
    { field: 'derived_from', direction: 'directional', target: 'The source or note from which this note was derived.', reciprocal: false },
    { field: 'depends_on', direction: 'directional', target: 'A prerequisite note, decision, or project.', reciprocal: false },
    { field: 'implements', direction: 'directional', target: 'The design, decision, or requirement implemented here.', reciprocal: false },
    { field: 'blocked_by', direction: 'directional', target: 'The note or dependency currently blocking this note.', reciprocal: false },
    { field: 'answers_questions', direction: 'directional', target: 'A question note answered by this note.', reciprocal: false },
    { field: 'tests', direction: 'directional', target: 'A question, hypothesis, or assumption tested by this experiment.', reciprocal: false },
    { field: 'related', direction: 'mutual', target: 'A materially related note without a stronger claim.', reciprocal: true },
    { field: 'same_as', direction: 'mutual', target: 'The same concept represented by another note or alias.', reciprocal: true },
    { field: 'close_match', direction: 'mutual', target: 'A near-equivalent concept useful for discovery but not safe to merge or treat as exact identity.', reciprocal: true },
    { field: 'version_of', direction: 'directional', target: 'The conceptual note this version belongs to.', reciprocal: false },
    { field: 'refines', direction: 'directional', target: 'A note made more precise or useful by this note.', reciprocal: false },
];
export const CLAIM_RELATION_FIELDS = [
    { input: 'supportsClaims', property: 'supports_claims', relation: 'supports' },
    { input: 'contradictsClaims', property: 'contradicts_claims', relation: 'contradicts' },
    { input: 'dependsOnClaims', property: 'depends_on_claims', relation: 'depends_on' },
];
/** Backlink labels are a projection, not additional authored relation fields. */
export const CLAIM_GRAPH_RELATIONS = CLAIM_RELATION_FIELDS.map(({ property, relation }) => ({
    field: property, relation: `claim_${relation}`,
}));
export const RELATION_TARGET_KIND_RULES = [
    { relation: 'answers_questions', kinds: ['question'], reason: 'answers_questions targets must have note_kind: question.' },
    { relation: 'tests', kinds: ['question', 'hypothesis', 'assumption'], reason: 'tests targets must have note_kind: question, hypothesis, or assumption.' },
];
/** Callers retain their existing normalization and ACL checks. Unknown relations
 * are not rejected here: this helper only expresses the two existing rules. */
export function typedRelationTargetKindReason(relation, targetKind) {
    const rule = RELATION_TARGET_KIND_RULES.find(entry => entry.relation === relation);
    return rule && !rule.kinds.includes(targetKind) ? rule.reason : undefined;
}
/** Opt-in question retrieval is intentionally narrower than the authored graph.
 * Evidence is virtual. Declaration groups preserve ordering around source pins. */
export const QUESTION_GRAPH_PROFILE = {
    relations: ['evidence', 'supports', 'contradicts', 'depends_on', 'derived_from'],
    priorityRelations: ['contradicts', 'depends_on'],
    contextRelations: ['supports', 'derived_from'],
    reverseRelations: ['contradicts', 'claim_contradicts'],
};
