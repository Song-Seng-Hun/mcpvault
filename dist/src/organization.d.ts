/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export declare const NOTE_KINDS: readonly ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'experiment', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export declare const LIFECYCLES: readonly ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
export declare const TASK_STATUSES: readonly ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'];
/** Optional Kanban-style class of service for executable work. */
export declare const SERVICE_CLASSES: readonly ['expedite', 'fixed_date', 'standard', 'research'];
export declare const REVIEW_POLICIES: readonly ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit', 'on_upstream_change'];
export declare const REVIEW_OUTCOMES: readonly ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'];
/** Small, repeatable quality checklist for an evidence review. */
export declare const REVIEW_CHECKS: readonly ['evidence', 'links', 'summary', 'moc', 'counterexamples', 'scope', 'freshness'];
export declare const INTERPRETATION_STATUSES: readonly ['unprocessed', 'interpreted', 'synthesized'];
export declare const QUESTION_STATUSES: readonly ['open', 'answered', 'blocked', 'abandoned'];
export declare const HYPOTHESIS_STATUSES: readonly ['proposed', 'supported', 'refuted', 'inconclusive'];
/** State of a reproducible experiment record; separate from task workflow. */
export declare const EXPERIMENT_STATUSES: readonly ['planned', 'running', 'completed', 'failed', 'inconclusive', 'reproduced'];
export declare const ASSUMPTION_STATUSES: readonly ['active', 'verified', 'invalidated', 'replaced'];
/** Decision Record state is intentionally separate from the coarser knowledge
 * status so rejected alternatives are not confused with superseded choices. */
export declare const DECISION_STATUSES: readonly ['proposed', 'accepted', 'rejected', 'superseded'];
/** Optional controlled-vocabulary state for a note title/alias. */
export declare const TERM_STATUSES: readonly ['preferred', 'deprecated', 'redirect'];
/** A small Zettelkasten-style role vocabulary for durable knowledge notes. */
export declare const KNOWLEDGE_ROLES: readonly ['concept', 'argument', 'model', 'observation', 'counterargument'];
/** Optional note-template IDs. Knowledge-role templates refine a durable note
 * without introducing another note kind or storage format. */
export declare const NOTE_TEMPLATE_IDS: readonly ["atomic", "literature", "question", "hypothesis", "experiment", "assumption", "decision", "project", "moc", "negative", "concept", "argument", "model", "observation", "counterargument"];
/** Standard Obsidian Bases projections. Keep the runtime and tool schema on
 * one shared list so a documented view cannot become unreachable. */
export declare const BASES_VIEW_IDS: readonly ['all', 'inbox', 'inbox_oldest', 'projects', 'project_next_actions', 'review', 'epistemic', 'experiments', 'open_questions', 'decisions', 'knowledge', 'concepts', 'arguments', 'models', 'observations', 'counterarguments', 'unreviewed_evidence', 'negative_knowledge', 'deprecated_terms', 'maintenance', 'authority', 'review_checklist', 'collections'];
/** Optional recall result for high-value knowledge; separate from evidence review. */
export declare const RECALL_QUALITIES: readonly ['unseen', 'failed', 'partial', 'good'];
/** Error Book state is split into resolution and learning so a closed issue
 * can still leave an explicit retrospective trail. */
export declare const ISSUE_RESOLUTION_STATUSES: readonly ['open', 'in_progress', 'resolved', 'wont_fix', 'duplicate'];
export declare const ISSUE_RETROSPECTIVE_STATUSES: readonly ['not_started', 'captured', 'synthesized'];
export declare const KNOWLEDGE_POLARITIES: readonly ['positive', 'negative'];
export declare const NEGATIVE_KINDS: readonly ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'];
/** Retention is a preservation hint, not an automatic deletion command. */
export declare const RETENTION_POLICIES: readonly ['preserve', 'review', 'archive', 'tombstone'];
/** Optional event that starts or explains a retention window. */
export declare const RETENTION_EVENTS: readonly ['manual', 'created', 'last_modified', 'review_completed', 'superseded', 'project_completed'];
/** GTD horizons from concrete action up to purpose; these are optional focus metadata. */
export declare const FOCUS_HORIZONS: readonly ['ground', 'project', 'area', 'goal', 'vision', 'purpose'];
/** GTD clarification outcomes. These are workflow metadata, not deletion commands. */
export declare const CLARIFY_DISPOSITIONS: readonly ['knowledge', 'reference', 'project', 'someday', 'discard', 'delegate'];
/** Typed relationships are navigation metadata, never an access grant. */
export declare const RELATION_FIELDS: readonly ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'answers_questions', 'tests', 'related', 'same_as', 'version_of', 'refines'];
/** These relations have a meaning that is incomplete when the reverse edge is absent. */
export declare const RECIPROCAL_RELATIONS: readonly ['related', 'same_as'];
/** A compact ontology so agents can choose a relation by meaning, not by name. */
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
export declare function getOrganizationRelationContract(): ({
    field: 'supports';
    direction: 'directional';
    target: 'A claim, decision, or note supported by this note.';
    reciprocal: false;
} | {
    field: 'contradicts';
    direction: 'directional';
    target: 'A claim or conclusion challenged by this note.';
    reciprocal: false;
} | {
    field: 'supersedes';
    direction: 'directional';
    target: 'An older or replaced note.';
    reciprocal: false;
} | {
    field: 'derived_from';
    direction: 'directional';
    target: 'The source or note from which this note was derived.';
    reciprocal: false;
} | {
    field: 'depends_on';
    direction: 'directional';
    target: 'A prerequisite note, decision, or project.';
    reciprocal: false;
} | {
    field: 'implements';
    direction: 'directional';
    target: 'The design, decision, or requirement implemented here.';
    reciprocal: false;
} | {
    field: 'blocked_by';
    direction: 'directional';
    target: 'The note or dependency currently blocking this note.';
    reciprocal: false;
} | {
    field: 'answers_questions';
    direction: 'directional';
    target: 'A question note answered by this note.';
    reciprocal: false;
} | {
    field: 'tests';
    direction: 'directional';
    target: 'A question, hypothesis, or assumption tested by this experiment.';
    reciprocal: false;
} | {
    field: 'related';
    direction: 'mutual';
    target: 'A materially related note without a stronger claim.';
    reciprocal: true;
} | {
    field: 'same_as';
    direction: 'mutual';
    target: 'The same concept represented by another note or alias.';
    reciprocal: true;
} | {
    field: 'version_of';
    direction: 'directional';
    target: 'The conceptual note this version belongs to.';
    reciprocal: false;
} | {
    field: 'refines';
    direction: 'directional';
    target: 'A note made more precise or useful by this note.';
    reciprocal: false;
})[];
export declare const ORGANIZATION_LIST_FIELDS: readonly ["aliases", "tags", "mocs", "key_points", "open_questions", "next_actions", "project_support", "subject_terms", "methods", "audience", "see_also", "supports", "contradicts", "supersedes", "derived_from", "depends_on", "implements", "blocked_by", "answers_questions", "tests", "related", "same_as", "version_of", "refines"];
/**
 * The small, stable subset of frontmatter that MCPVault owns.  Custom
 * Properties remain allowed; this contract only gives agents and lint a common
 * shape for fields used by the Wiki projections and Obsidian Bases.
 */
export interface OrganizationPropertyContractEntry {
    name: string;
    type: 'text' | 'list' | 'number' | 'boolean' | 'object';
    description: string;
    allowed?: readonly string[];
    appliesTo?: readonly string[];
}
export declare const ORGANIZATION_PROPERTY_CONTRACT: readonly OrganizationPropertyContractEntry[];
export declare function getOrganizationPropertyContract(): OrganizationPropertyContractEntry[];
export interface OrganizationNoteTemplate {
    templateId: string;
    noteKind: NoteKind;
    purpose: string;
    properties: Record<string, unknown>;
    markdown: string;
}
/**
 * Small, optional scaffolds for the common note roles.  Templates are
 * intentionally suggestions: ordinary Markdown remains valid and no
 * template is required for publication.
 */
export declare function organizationNoteTemplate(value?: unknown): OrganizationNoteTemplate;
export type NoteKind = typeof NOTE_KINDS[number];
export type Lifecycle = typeof LIFECYCLES[number];
export declare function normalizeReviewChecks(value: unknown): string[] | undefined;
export declare function normalizeTaskStatus(value: unknown, fallback?: typeof TASK_STATUSES[number]): typeof TASK_STATUSES[number] | undefined;
export declare function normalizeServiceClass(value: unknown, fallback?: typeof SERVICE_CLASSES[number]): typeof SERVICE_CLASSES[number] | undefined;
export declare function normalizeReviewPolicy(value: unknown, fallback?: typeof REVIEW_POLICIES[number]): typeof REVIEW_POLICIES[number] | undefined;
export declare function normalizeReviewOutcome(value: unknown, fallback?: typeof REVIEW_OUTCOMES[number]): typeof REVIEW_OUTCOMES[number] | undefined;
export declare function normalizeInterpretationStatus(value: unknown, fallback?: typeof INTERPRETATION_STATUSES[number]): typeof INTERPRETATION_STATUSES[number] | undefined;
export declare function normalizeEpistemicStatus(value: unknown, noteKind: NoteKind, fallback?: string): string | undefined;
export declare function normalizeDecisionStatus(value: unknown, fallback?: typeof DECISION_STATUSES[number]): typeof DECISION_STATUSES[number] | undefined;
export declare function normalizeKnowledgePolarity(value: unknown, fallback?: typeof KNOWLEDGE_POLARITIES[number]): typeof KNOWLEDGE_POLARITIES[number] | undefined;
export declare function normalizeNegativeKind(value: unknown, fallback?: typeof NEGATIVE_KINDS[number]): typeof NEGATIVE_KINDS[number] | undefined;
export declare function normalizeClarifyDisposition(value: unknown, fallback?: typeof CLARIFY_DISPOSITIONS[number]): typeof CLARIFY_DISPOSITIONS[number] | undefined;
export declare function normalizeNoteKind(value: unknown, fallback?: NoteKind): NoteKind | undefined;
export declare function normalizeLifecycle(value: unknown, fallback?: Lifecycle): Lifecycle | undefined;
export declare function normalizeFocusHorizon(value: unknown, fallback?: typeof FOCUS_HORIZONS[number]): typeof FOCUS_HORIZONS[number] | undefined;
export declare function normalizeTermStatus(value: unknown, fallback?: typeof TERM_STATUSES[number]): typeof TERM_STATUSES[number];
export declare function normalizeKnowledgeRole(value: unknown, fallback?: typeof KNOWLEDGE_ROLES[number]): typeof KNOWLEDGE_ROLES[number] | undefined;
export declare function normalizeRecallQuality(value: unknown, fallback?: typeof RECALL_QUALITIES[number]): typeof RECALL_QUALITIES[number];
export declare function normalizeRetentionPolicy(value: unknown, fallback?: typeof RETENTION_POLICIES[number]): typeof RETENTION_POLICIES[number] | undefined;
export declare function normalizeRetentionEvent(value: unknown, fallback?: typeof RETENTION_EVENTS[number]): typeof RETENTION_EVENTS[number] | undefined;
export declare function normalizeBoolean(value: unknown, field: string, fallback?: boolean): boolean | undefined;
export declare function lifecycleForKnowledgeStatus(status: string): Lifecycle;
export declare function normalizeReviewAt(value: unknown): string | undefined;
export declare function normalizeReviewIntervalDays(value: unknown, fallback?: number): number | undefined;
export declare function normalizeNavOrder(value: unknown, fallback?: number): number | undefined;
export declare function normalizeIsoDate(value: unknown, field: string): string | undefined;
export type TemporalValidityState = 'unspecified' | 'current' | 'not_yet_valid' | 'expired' | 'invalid';
/**
 * Derive a claim-validity card without confusing it with file, source, task,
 * or review dates. valid_from is inclusive and valid_until is exclusive.
 * This is a scheduling/navigation signal, never a truth judgment.
 */
export declare function temporalValidity(frontmatter: Record<string, any>, asOfMs?: number): {
    state: TemporalValidityState;
    asOf: string;
    validFrom?: string;
    validUntil?: string;
    observedAt?: string;
    temporalScope?: string;
    reason?: string;
};
export interface KnowledgeOrganizationInput {
    existing?: Record<string, any>;
    tags?: unknown;
    timeEstimateMinutes?: unknown;
    energy?: unknown;
    effort?: unknown;
    noteKind?: unknown;
    lifecycle?: unknown;
    decisionStatus?: unknown;
    primaryMoc?: unknown;
    mocs?: unknown;
    moc?: unknown;
    navOrder?: unknown;
    project?: unknown;
    reviewAt?: unknown;
    reviewIntervalDays?: unknown;
    recallPrompt?: unknown;
    recallIntervalDays?: unknown;
    lastRecalledAt?: unknown;
    recallQuality?: unknown;
    retentionPolicy?: unknown;
    retentionEvent?: unknown;
    retentionAt?: unknown;
    preserveUntil?: unknown;
    legalHold?: unknown;
    retentionReason?: unknown;
    replacedBy?: unknown;
    reviewSnoozedUntil?: unknown;
    reviewSnoozeReason?: unknown;
    status: string;
    aliases?: unknown;
    summary?: unknown;
    keyPoints?: unknown;
    openQuestions?: unknown;
    summaryLayer?: unknown;
    summaryHighlights?: unknown;
    nextActions?: unknown;
    nextAction?: unknown;
    waitingFor?: unknown;
    desiredOutcome?: unknown;
    projectPurpose?: unknown;
    projectSupport?: unknown;
    taskContext?: unknown;
    dueAt?: unknown;
    scheduledAt?: unknown;
    deferUntil?: unknown;
    serviceClass?: unknown;
    completionCriteria?: unknown;
    startedAt?: unknown;
    blockedSince?: unknown;
    waitingSince?: unknown;
    completedAt?: unknown;
    stableId?: unknown;
    canonicalPath?: unknown;
    termStatus?: unknown;
    termReplacedBy?: unknown;
    termScopeNote?: unknown;
    preferredTerm?: unknown;
    termLanguage?: unknown;
    authorityScheme?: unknown;
    authorityId?: unknown;
    disambiguation?: unknown;
    broaderTerms?: unknown;
    relatedTerms?: unknown;
    subjectTerms?: unknown;
    domain?: unknown;
    methods?: unknown;
    audience?: unknown;
    retrievalCues?: unknown;
    useWhen?: unknown;
    validFrom?: unknown;
    validUntil?: unknown;
    observedAt?: unknown;
    temporalScope?: unknown;
    knowledgeRole?: unknown;
    seeAlso?: unknown;
    relations?: unknown;
    relationNotes?: unknown;
    relationEvidence?: unknown;
    taskStatus?: unknown;
    reviewPolicy?: unknown;
    reviewOutcome?: unknown;
    reviewedBy?: unknown;
    reviewedAt?: unknown;
    reviewNote?: unknown;
    reviewChecks?: unknown;
    reviewOpenItems?: unknown;
    interpretationStatus?: unknown;
    epistemicStatus?: unknown;
    polarity?: unknown;
    negativeType?: unknown;
    attempted?: unknown;
    observed?: unknown;
    failureCondition?: unknown;
    affectedScope?: unknown;
    reproduction?: unknown;
    whyRejected?: unknown;
    reusableLesson?: unknown;
    replacementPath?: unknown;
    clarifyDisposition?: unknown;
    clarifiedBy?: unknown;
    clarifiedAt?: unknown;
    clarifyNote?: unknown;
    triageTarget?: unknown;
    mocPurpose?: unknown;
    mocScope?: unknown;
    mocQuestions?: unknown;
    mocParent?: unknown;
    focusHorizon?: unknown;
    focusParent?: unknown;
    focusSupports?: unknown;
    contentDigest?: unknown;
}
export declare function knowledgeOrganization(input: KnowledgeOrganizationInput): Record<string, unknown>;
export interface OrganizationLintIssue {
    code: string;
    detail: string;
}
export declare function organizationLintIssues(path: string, frontmatter: Record<string, any>, content: string, nowMs?: number): OrganizationLintIssue[];
//# sourceMappingURL=organization.d.ts.map