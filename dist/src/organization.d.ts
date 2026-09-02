/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export declare const NOTE_KINDS: readonly ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export declare const LIFECYCLES: readonly ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
export declare const TASK_STATUSES: readonly ['open', 'next_action', 'waiting', 'blocked', 'completed', 'cancelled'];
/** Typed relationships are navigation metadata, never an access grant. */
export declare const RELATION_FIELDS: readonly ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'related'];
export declare const ORGANIZATION_LIST_FIELDS: readonly ["aliases", "key_points", "open_questions", "next_actions", "supports", "contradicts", "supersedes", "derived_from", "depends_on", "implements", "blocked_by", "related"];
export type NoteKind = typeof NOTE_KINDS[number];
export type Lifecycle = typeof LIFECYCLES[number];
export declare function normalizeTaskStatus(value: unknown, fallback?: typeof TASK_STATUSES[number]): typeof TASK_STATUSES[number] | undefined;
export declare function normalizeNoteKind(value: unknown, fallback?: NoteKind): NoteKind | undefined;
export declare function normalizeLifecycle(value: unknown, fallback?: Lifecycle): Lifecycle | undefined;
export declare function lifecycleForKnowledgeStatus(status: string): Lifecycle;
export declare function normalizeReviewAt(value: unknown): string | undefined;
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
    waitingFor?: unknown;
    stableId?: unknown;
    relations?: unknown;
    taskStatus?: unknown;
    contentDigest?: unknown;
}
export declare function knowledgeOrganization(input: KnowledgeOrganizationInput): Record<string, unknown>;
export interface OrganizationLintIssue {
    code: string;
    detail: string;
}
export declare function organizationLintIssues(path: string, frontmatter: Record<string, any>, content: string, nowMs?: number): OrganizationLintIssue[];
//# sourceMappingURL=organization.d.ts.map