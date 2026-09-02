/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export declare const NOTE_KINDS: readonly ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export declare const LIFECYCLES: readonly ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
export declare const TASK_STATUSES: readonly ['open', 'next_action', 'waiting', 'blocked', 'completed', 'cancelled'];
export declare const REVIEW_POLICIES: readonly ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit'];
export declare const REVIEW_OUTCOMES: readonly ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'];
export declare const QUESTION_STATUSES: readonly ['open', 'answered', 'blocked', 'abandoned'];
export declare const HYPOTHESIS_STATUSES: readonly ['proposed', 'supported', 'refuted', 'inconclusive'];
export declare const ASSUMPTION_STATUSES: readonly ['active', 'verified', 'invalidated', 'replaced'];
export declare const KNOWLEDGE_POLARITIES: readonly ['positive', 'negative'];
export declare const NEGATIVE_KINDS: readonly ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'];
/** Typed relationships are navigation metadata, never an access grant. */
export declare const RELATION_FIELDS: readonly ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'related'];
export declare const ORGANIZATION_LIST_FIELDS: readonly ["aliases", "key_points", "open_questions", "next_actions", "supports", "contradicts", "supersedes", "derived_from", "depends_on", "implements", "blocked_by", "related"];
export type NoteKind = typeof NOTE_KINDS[number];
export type Lifecycle = typeof LIFECYCLES[number];
export declare function normalizeTaskStatus(value: unknown, fallback?: typeof TASK_STATUSES[number]): typeof TASK_STATUSES[number] | undefined;
export declare function normalizeReviewPolicy(value: unknown, fallback?: typeof REVIEW_POLICIES[number]): typeof REVIEW_POLICIES[number] | undefined;
export declare function normalizeReviewOutcome(value: unknown, fallback?: typeof REVIEW_OUTCOMES[number]): typeof REVIEW_OUTCOMES[number] | undefined;
export declare function normalizeEpistemicStatus(value: unknown, noteKind: NoteKind, fallback?: string): string | undefined;
export declare function normalizeKnowledgePolarity(value: unknown, fallback?: typeof KNOWLEDGE_POLARITIES[number]): typeof KNOWLEDGE_POLARITIES[number] | undefined;
export declare function normalizeNegativeKind(value: unknown, fallback?: typeof NEGATIVE_KINDS[number]): typeof NEGATIVE_KINDS[number] | undefined;
export declare function normalizeNoteKind(value: unknown, fallback?: NoteKind): NoteKind | undefined;
export declare function normalizeLifecycle(value: unknown, fallback?: Lifecycle): Lifecycle | undefined;
export declare function lifecycleForKnowledgeStatus(status: string): Lifecycle;
export declare function normalizeReviewAt(value: unknown): string | undefined;
export declare function normalizeIsoDate(value: unknown, field: string): string | undefined;
export interface KnowledgeOrganizationInput {
    existing?: Record<string, any>;
    noteKind?: unknown;
    lifecycle?: unknown;
    moc?: unknown;
    project?: unknown;
    reviewAt?: unknown;
    status: string;
    aliases?: unknown;
    summary?: unknown;
    keyPoints?: unknown;
    openQuestions?: unknown;
    nextActions?: unknown;
    nextAction?: unknown;
    waitingFor?: unknown;
    desiredOutcome?: unknown;
    taskContext?: unknown;
    dueAt?: unknown;
    deferUntil?: unknown;
    stableId?: unknown;
    relations?: unknown;
    taskStatus?: unknown;
    reviewPolicy?: unknown;
    reviewOutcome?: unknown;
    reviewedBy?: unknown;
    reviewedAt?: unknown;
    reviewNote?: unknown;
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
    contentDigest?: unknown;
}
export declare function knowledgeOrganization(input: KnowledgeOrganizationInput): Record<string, unknown>;
export interface OrganizationLintIssue {
    code: string;
    detail: string;
}
export declare function organizationLintIssues(path: string, frontmatter: Record<string, any>, content: string, nowMs?: number): OrganizationLintIssue[];
//# sourceMappingURL=organization.d.ts.map