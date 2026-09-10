import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { type ResearchConfig, type ResearchSubmission, type ResearchReview } from './independent-research-model.js';
type Submitted = {
    accountId: string;
    fingerprint: string;
    submittedAt: string;
    submission: ResearchSubmission;
};
type Reviewed = {
    accountId: string;
    reviewedAt: string;
    review: ResearchReview;
};
export interface ResearchRound {
    version: 1;
    workshopId: string;
    roundId: string;
    config: ResearchConfig;
    phase: 'collecting' | 'review' | 'closed';
    createdAt: string;
    disclosedAt?: string;
    submissions: Submitted[];
    reviews: Reviewed[];
    closure?: {
        outcome: 'synthesis' | 'unresolved';
        explanation: string;
        accountId: string;
    };
    receipts: Array<{
        key: string;
        payload: string;
    }>;
    sourceGuards: Guard[];
}
export interface ResearchParams {
    principal?: ScopePrincipal;
    workshopId: string;
    roundId: string;
    expectedRevision?: string;
    expectedWorkshopRevision?: string;
    requestId?: string;
    operation?: 'create' | 'submit' | 'disclose' | 'review' | 'close';
    config?: unknown;
    submission?: unknown;
    review?: unknown;
    closure?: unknown;
    field?: 'status' | 'submissions' | 'reviews' | 'config' | 'closure' | 'submission' | 'review';
    itemIndex?: number;
    limit?: number;
    maxChars?: number;
    cursor?: string;
    revalidateActor: () => Promise<ScopePrincipal>;
}
type Guard = {
    path: string;
    expectedRevision: string;
};
/** Managed Markdown, hidden by the existing _whispers service-path boundary.
 * Embargoed prose never enters ordinary Workshop contribution records. */
export declare class IndependentResearchService {
    private readonly fs;
    private readonly refs;
    private readonly access;
    private readonly participantAvailable;
    constructor(fs: FileSystemService, refs: ReferenceService, access: ScopeAccessPolicy, participantAvailable: (accountId: string) => Promise<boolean>);
    private paths;
    private actor;
    private workshop;
    private parse;
    private closure;
    private evidence;
    private readRecord;
    read(p: ResearchParams): Promise<import("./work-model.js").WorkPage | {
        workshopId: string;
        roundId: string;
        field: string;
        revision: string;
        phase: "closed" | "collecting" | "review";
        basisState: "current" | "unavailable_or_changed";
        nextAction?: {
            endpointId: string;
            arguments: {
                workshopId: string;
                roundId: string;
                operation: string;
                expectedRevision: string;
                closure: {
                    outcome: string;
                };
            };
            required: string[];
        };
    }>;
    update(p: ResearchParams): Promise<{
        success: boolean;
        replay: boolean;
        workshopId: string;
        roundId: string;
        revision: string;
        phase: "closed" | "collecting" | "review";
    } | {
        replay?: never;
        success: boolean;
        workshopId: string;
        roundId: string;
        revision: string;
        phase: "closed" | "collecting" | "review";
    }>;
}
export {};
//# sourceMappingURL=independent-research.d.ts.map