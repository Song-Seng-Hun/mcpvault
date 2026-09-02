/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export declare const NOTE_KINDS: readonly ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export declare const LIFECYCLES: readonly ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
export type NoteKind = typeof NOTE_KINDS[number];
export type Lifecycle = typeof LIFECYCLES[number];
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
}
export declare function knowledgeOrganization(input: KnowledgeOrganizationInput): Record<string, unknown>;
export interface OrganizationLintIssue {
    code: string;
    detail: string;
}
export declare function organizationLintIssues(path: string, frontmatter: Record<string, any>, content: string, nowMs?: number): OrganizationLintIssue[];
//# sourceMappingURL=organization.d.ts.map