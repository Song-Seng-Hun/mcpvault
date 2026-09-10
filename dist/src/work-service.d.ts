import { type HostExecutionVerifier, type ContextReader } from './work-review.js';
import { type WorkExecutionProfile } from './work-staffing.js';
import { type FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { type AgentTaskService } from './agent-tasks.js';
import { type Properties, type WorkBoardParams, type WorkClaimParams, type WorkHandoffParams, type WorkPacketParams, type WorkProjectParams, type WorkReviewParams } from './work-model.js';
export type { WorkBaseParams, WorkBoardParams, WorkClaimParams, WorkHandoffParams, WorkPacketParams, WorkProjectParams, WorkReviewParams } from './work-model.js';
type Guard = {
    path: string;
    expectedRevision: string;
};
export interface WorkServiceOptions {
    executionProfiles?: () => Promise<WorkExecutionProfile[]>;
    verifyReviewExecution?: HostExecutionVerifier;
    readReviewGitSource?: ContextReader;
    assertActor?: (principal: ScopePrincipal) => Promise<void>;
    assertTaskMutation?: (taskId: string) => Promise<void>;
    paidProjection?: (taskIds: string[], principal?: ScopePrincipal) => Promise<Record<string, Properties>>;
}
/** Markdown is the sole durable state, including approvals and retry receipts.
 * No timer, worker token, external executor, or account creation lives here. */
export declare class WorkService {
    private readonly fileSystem;
    private readonly references;
    private readonly auth;
    private readonly tasks;
    private readonly options;
    private readonly reviewEngine;
    private readonly access;
    private readonly intents;
    private readonly workshopCreates;
    constructor(fileSystem: FileSystemService, references: ReferenceService, auth: ScopeAuthService, tasks: AgentTaskService, options?: WorkServiceOptions);
    private actor;
    /** Server-owned adapter, not an agent-supplied authority or task field. */
    authorizeWorkshopProject(principal: ScopePrincipal, projectId: string, owner: boolean, delegate?: string, grantor?: string): Promise<Guard>;
    createWorkshopTask(params: Parameters<AgentTaskService['create']>[0], guards: Guard[], receipt: import('./workshop-output.js').WorkshopOutputReceipt, assertAccess: () => Promise<void>): Promise<any>;
    private visible;
    private projectNote;
    private communityTarget;
    private member;
    private revision;
    private request;
    private receiptState;
    private receiptMatches;
    private retry;
    private addReceipt;
    private event;
    private projectProjection;
    project(params: WorkProjectParams): Promise<Properties>;
    private inventory;
    private accountForAssignee;
    private publicPath;
    private artifacts;
    private dependencies;
    private ready;
    private wip;
    private runTask;
    private applyIntent;
    private mutate;
    claim(params: WorkClaimParams): Promise<Properties>;
    /** Internal paid lease still traverses every ordinary Work admission rule. */
    claimPaid(params: WorkClaimParams, contractId: string): Promise<Properties>;
    handoff(params: WorkHandoffParams): Promise<Properties>;
    review(params: WorkReviewParams): Promise<Properties>;
    private blocker;
    private boardWip;
    private resourceKeys;
    private resourceAdmission;
    private responsibilityItems;
    coverage(params: WorkBoardParams): Promise<import("./work-model.js").WorkPage>;
    board(params: WorkBoardParams): Promise<import("./work-model.js").WorkPage>;
    private currentReview;
    private staffingPolicy;
    staffing(params: WorkBoardParams & {
        taskId?: string;
    }): Promise<import("./work-model.js").WorkPage>;
    reviewContext(params: WorkPacketParams & {
        locatorId?: string;
    }): Promise<import("./work-model.js").WorkPage>;
    packet(params: WorkPacketParams): Promise<import("./work-model.js").WorkPage>;
    private packetActions;
    pulse(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        nextAction?: {
            tool: string;
            arguments: Properties;
        };
        reason?: string;
        summary?: Properties;
    }>;
}
//# sourceMappingURL=work-service.d.ts.map