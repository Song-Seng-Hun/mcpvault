import { type Properties } from './work-model.js';
import type { WorkArtifact } from './agent-tasks.js';
export interface WorkReviewPolicy {
    version: 2;
    requireHostExecution?: boolean;
    optionalCriteria?: string[];
}
export interface WorkContextLocator {
    id: string;
    role: 'before' | 'after' | 'diff' | 'source' | 'test' | 'upstream';
    path?: string;
    revision?: string;
    repository?: string;
    commit?: string;
    file?: string;
    startLine: number;
    endLine: number;
    required: boolean;
}
export interface WorkChangeContext {
    reason: string;
    scope: string;
    constraints: string[];
    decisions: string[];
    risks: string[];
    dissent: string[];
    unverified: string[];
    locators: WorkContextLocator[];
}
export interface WorkReviewTest {
    locatorId: string;
    snapshot: string;
    environment: string;
    result: 'pass' | 'fail' | 'unknown';
    missingChecks: string[];
    executionId?: string;
}
export interface WorkReviewCheck {
    criterion: string;
    verdict: 'pass' | 'fail' | 'unknown' | 'not_applicable';
    rationale: string;
    evidenceIds: string[];
    missingChecks: string[];
    tests: WorkReviewTest[];
}
export type HostExecutionVerifier = (id: string, expected: {
    artifactFingerprint: string;
    criterion: string;
    locator: WorkContextLocator;
    test: WorkReviewTest;
}) => Promise<boolean>;
export interface ContextSource {
    content: string;
    revision: string;
    guard?: {
        path: string;
        expectedRevision: string;
    };
    projectId?: string;
    relatedTaskIds?: string[];
    sourceWorkId?: string;
}
export type ContextReader = (locator: WorkContextLocator) => Promise<ContextSource>;
export declare class ReviewBudgetError extends Error {
}
export declare function reviewPolicy(value: unknown): WorkReviewPolicy;
export declare function effectiveReviewPolicy(task: Properties, project: Properties): WorkReviewPolicy;
export declare function changeContext(value: unknown): WorkChangeContext;
/** Ephemeral delivery proof; restart/expiry requires rereading, not a durable approval.
 * Tokens attest delivery only. Review claims remain claims unless the host verifies execution. */
export declare class WorkReviewEngine {
    private readonly reader;
    private readonly verifyExecution?;
    private readonly receipts;
    constructor(reader: ContextReader, verifyExecution?: HostExecutionVerifier | undefined);
    state(fm: Properties, project: Properties, strict?: boolean): Promise<{
        fingerprint: string;
        guards: {
            path: string;
            expectedRevision: string;
        }[];
        context: WorkChangeContext | undefined;
        sources: Properties[];
    }>;
    read(params: {
        taskId: string;
        accountId: string;
        basis: string;
        context?: WorkChangeContext;
        project: Properties;
        criteria: string[];
        locatorId?: string;
        limit?: number;
        maxChars?: number;
        cursor?: string;
    }): Promise<import("./work-model.js").WorkPage>;
    validate(params: {
        taskId: string;
        accountId: string;
        basis: string;
        context?: WorkChangeContext;
        criteria: string[];
        policy: WorkReviewPolicy;
        artifacts?: WorkArtifact[];
        receipts?: string[];
        checks?: WorkReviewCheck[];
        approve: boolean;
    }): Promise<{
        checks: WorkReviewCheck[];
        execution_evidence: string;
        context_delivery: {
            account_id: string;
            fingerprint: string;
            locator_ids: string[];
        };
    }>;
}
/** Never let a valid large review become an indivisible pagination barrier. */
export declare function reviewPacketItems(review: Properties): Properties[];
//# sourceMappingURL=work-review.d.ts.map