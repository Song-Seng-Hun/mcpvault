import type { ScopePrincipal } from './scope-auth.js';
import type { WorkArtifact } from './agent-tasks.js';
export interface WorkBaseParams {
    principal?: ScopePrincipal;
    requestId?: string;
    expectedRevision?: string;
    expectedGeneration?: number;
    reason?: string;
}
export interface WorkProjectParams extends WorkBaseParams {
    reviewPolicy?: import('./work-review.js').WorkReviewPolicy;
    staffingPolicy?: WorkStaffingPolicy;
    groupIds?: string[];
    requiredPerspectives?: string[];
    teamStatus?: 'active' | 'completed';
    op?: 'read' | 'create' | 'update';
    projectId: string;
    title?: string;
    goal?: string;
    allowedWork?: string[];
    participants?: string[];
    completionCriteria?: string[];
    wipLimit?: number;
    personalWipLimit?: number;
    roomId?: string;
    maxChars?: number;
}
export interface WorkBoardParams {
    principal?: ScopePrincipal;
    projectId: string;
    limit?: number;
    maxChars?: number;
    cursor?: string;
}
export type WorkStaffingPolicy = Pick<import('./work-staffing.js').WorkStaffingInput, 'taskType' | 'factualVerification' | 'requiredTools' | 'requiredCapabilities' | 'minimumTier' | 'budget' | 'preferences'>;
export interface WorkPacketParams {
    principal?: ScopePrincipal;
    taskId: string;
    limit?: number;
    maxChars?: number;
    cursor?: string;
    knownRevision?: string;
}
export interface WorkClaimParams extends WorkBaseParams {
    op: 'claim' | 'start' | 'release';
    taskId: string;
}
export interface WorkHandoffParams extends WorkBaseParams {
    op: 'propose' | 'accept';
    taskId: string;
    toAccountId?: string;
    completed?: string;
    remaining?: string;
    blocker?: string;
    nextAction?: string;
    artifacts?: WorkArtifact[];
}
export interface WorkReviewParams extends WorkBaseParams {
    op: 'request' | 'approve' | 'self_verify' | 'changes_requested' | 'question' | 'override';
    taskId: string;
    artifactFingerprint?: string;
    contextReceipts?: string[];
    checks?: import('./work-review.js').WorkReviewCheck[];
}
export type Properties = Record<string, any>;
export declare const WORK_KINDS: readonly ['general', 'security', 'permissions', 'shared_policy', 'destructive'];
export declare const finished: (fm: Properties) => boolean;
export declare const started: (fm: Properties) => boolean;
export declare const displayIdentity: (p: ScopePrincipal) => string;
export declare const canonical: (value: unknown) => string;
export declare const fingerprint: (value: unknown) => string;
export declare const reviewBasis: (fm: Properties) => string;
export declare function textField(value: unknown, field: string, max?: number, required?: boolean): string;
export declare function listField(value: unknown, field: string, max?: number, required?: boolean): string[];
export declare function integer(value: unknown, fallback: number, max: number, field: string): number;
export declare function coordinate<T>(operation: () => Promise<T>): Promise<T>;
export interface WorkPage {
    items: Properties[];
    total: number;
    truncated: boolean;
    cursor?: string;
    [key: string]: any;
}
/** Admission counts the complete JSON envelope, including the continuation. */
export declare function page(items: Properties[], context: Properties, signature: string, params: {
    limit?: number;
    maxChars?: number;
    cursor?: string;
}, kind: string): WorkPage;
//# sourceMappingURL=work-model.d.ts.map