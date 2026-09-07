import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { type AgentTaskService } from './agent-tasks.js';
import { type Properties, type WorkBoardParams, type WorkClaimParams, type WorkHandoffParams, type WorkPacketParams, type WorkProjectParams, type WorkReviewParams } from './work-model.js';
export type { WorkBaseParams, WorkBoardParams, WorkClaimParams, WorkHandoffParams, WorkPacketParams, WorkProjectParams, WorkReviewParams } from './work-model.js';
export interface WorkServiceOptions {
    assertActor?: (principal: ScopePrincipal) => Promise<void>;
}
/** Markdown is the sole durable state, including approvals and retry receipts.
 * No timer, worker token, external executor, or account creation lives here. */
export declare class WorkService {
    private readonly fileSystem;
    private readonly references;
    private readonly auth;
    private readonly tasks;
    private readonly options;
    private readonly access;
    private readonly intents;
    constructor(fileSystem: FileSystemService, references: ReferenceService, auth: ScopeAuthService, tasks: AgentTaskService, options?: WorkServiceOptions);
    private actor;
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
    handoff(params: WorkHandoffParams): Promise<Properties>;
    review(params: WorkReviewParams): Promise<Properties>;
    private blocker;
    private boardWip;
    private resourceKeys;
    board(params: WorkBoardParams): Promise<import("./work-model.js").WorkPage>;
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