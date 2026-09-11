import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type WorkshopOutputAdapter } from './workshop-output.js';
export declare const IDEA_STATUSES: readonly ['seed', 'exploring', 'challenging', 'evaluating', 'selected', 'rejected', 'parked', 'implemented', 'promoted'];
export type IdeaStatus = typeof IDEA_STATUSES[number];
export declare const IDEA_CONTRIBUTION_KINDS: readonly ['extension', 'challenge', 'counterexample', 'evidence', 'question', 'synthesis', 'outcome'];
export type IdeaContributionKind = typeof IDEA_CONTRIBUTION_KINDS[number];
export declare const WORKSHOP_PHASES: readonly ['diverge', 'cluster', 'critique', 'evaluate', 'synthesize', 'decide', 'closed'];
export type WorkshopPhase = typeof WORKSHOP_PHASES[number];
export declare const WORKSHOP_CONTRIBUTION_KINDS: readonly ['idea', 'extension', 'challenge', 'counterexample', 'evaluation', 'synthesis', 'decision'];
export type WorkshopContributionKind = typeof WORKSHOP_CONTRIBUTION_KINDS[number];
export declare const IDEA_EVALUATION_FIELDS: readonly ['novelty', 'usefulness', 'feasibility', 'risk', 'evidenceQuality'];
export type IdeaEvaluationField = typeof IDEA_EVALUATION_FIELDS[number];
export interface ResearchWorkshopWork {
    taskId: string;
    expectedRevision: string;
    expectedGeneration: number;
}
export declare class IdeationService {
    private readonly fileSystem;
    private readonly references;
    private outputService?;
    constructor(fileSystem: FileSystemService, references: ReferenceService);
    attachOutputAdapter(adapter: WorkshopOutputAdapter): void;
    createIdea(params: {
        principal?: ScopePrincipal;
        ideaId?: string;
        title: string;
        seed: string;
        problem?: string;
        constraints?: unknown;
        successCriteria?: unknown;
        references?: unknown;
        workshopId?: string;
        expectedRevision?: string;
        requestId?: string;
    }): Promise<{
        success: true;
        ideaId: string;
        path: string;
        status: 'seed';
        revision: string;
    }>;
    private readTyped;
    listIdeas(params: {
        status?: string;
        workshopId?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        ideas: {
            ideaId: any;
            title: string;
            status: any;
            author: any;
            workshopId: any;
            parentIdeas: any;
            updatedAt: any;
            path: string;
        }[];
        total: number;
        truncated: boolean;
    }>;
    readIdea(params: {
        ideaId: string;
        limit?: number;
        maxChars?: number;
        includeContent?: boolean;
    }): Promise<{
        contributionTotal: number;
        evaluationTotal: number;
        truncated: boolean;
    }>;
    branchIdea(params: {
        principal?: ScopePrincipal;
        parentIdeaId: string;
        ideaId?: string;
        title: string;
        seed: string;
        references?: unknown;
        expectedParentRevision: string;
        requestId?: string;
    }): Promise<{
        success: true;
        ideaId: string;
        path: string;
        status: 'seed';
        parentIdeaId: string;
        revision: string;
    }>;
    updateIdeaStatus(params: {
        principal?: ScopePrincipal;
        ideaId: string;
        status: string;
        reason: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        ideaId: string;
        status: "challenging" | "evaluating" | "exploring" | "implemented" | "parked" | "promoted" | "rejected" | "seed" | "selected";
        reason: string;
        revision: string;
    }>;
    contributeIdea(params: {
        principal?: ScopePrincipal;
        ideaId: string;
        kind: string;
        content: string;
        references?: unknown;
        replyTo?: string;
        requestId?: string;
    }): Promise<{
        success: true;
        ideaId: string;
        contributionId: string;
        kind: "challenge" | "counterexample" | "evidence" | "extension" | "outcome" | "question" | "synthesis";
        path: string;
        revision: string;
    }>;
    evaluateIdea(params: {
        principal?: ScopePrincipal;
        ideaId: string;
        novelty: unknown;
        usefulness: unknown;
        feasibility: unknown;
        risk: unknown;
        evidenceQuality: unknown;
        rationale: string;
        references?: unknown;
        expectedRevision?: string;
        expectedIdeaRevision?: string;
    }): Promise<{
        success: boolean;
        ideaId: string;
        evaluator: string;
        revision: string;
        evaluatedIdeaRevision: string;
    }>;
    createWorkshop(params: {
        principal?: ScopePrincipal;
        workshopId?: string;
        title: string;
        prompt: string;
        agenda?: unknown;
        ideaIds?: unknown;
        timeboxMinutes?: number;
        maxContributionsPerAgent?: number;
        references?: unknown;
        facilitation?: unknown;
        requestId?: string;
        researchWork?: ResearchWorkshopWork;
        revalidateActor?: () => Promise<ScopePrincipal>;
    }): Promise<{
        success: true;
        workshopId: string;
        path: string;
        phase: 'diverge';
        revision: string;
    }>;
    listWorkshops(params: {
        phase?: string;
        status?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        workshops: {
            workshopId: any;
            title: string;
            phase: any;
            status: any;
            facilitator: any;
            updatedAt: any;
            path: string;
        }[];
        total: number;
        truncated: boolean;
    }>;
    readWorkshop(params: {
        workshopId: string;
        limit?: number;
        maxChars?: number;
        includeContent?: boolean;
    }): Promise<{
        contributionTotal: number;
        truncated: boolean;
    }>;
    getWorkshopMethods(params?: {
        methodId?: unknown;
        stepId?: unknown;
        cursor?: unknown;
        maxChars?: number;
    }): {
        example: Record<string, unknown>;
        inputSchema: Record<string, unknown>;
        notice: string;
        methodId: "1-2-4-all" | "affinity-kj" | "blameless-postmortem" | "brainwriting" | "checklist" | "crazy8s" | "daci" | "dot-voting" | "how-might-we" | "mind-map" | "ngt" | "page-led" | "premortem" | "retrospective" | "scamper" | "six-hats";
        stepId: string;
        required: readonly string[];
        finishCondition: string;
        truncated: boolean;
    } | {
        methods: {
            methodId: "1-2-4-all" | "affinity-kj" | "blameless-postmortem" | "brainwriting" | "checklist" | "crazy8s" | "daci" | "dot-voting" | "how-might-we" | "mind-map" | "ngt" | "page-led" | "premortem" | "retrospective" | "scamper" | "six-hats";
            version: 1;
            title: string;
            stepCount: number;
        }[];
        truncated: boolean;
        nextAction: {
            endpointId: string;
            arguments: {
                methodId: "1-2-4-all" | "affinity-kj" | "blameless-postmortem" | "brainwriting" | "checklist" | "crazy8s" | "daci" | "dot-voting" | "how-might-we" | "mind-map" | "ngt" | "page-led" | "premortem" | "retrospective" | "scamper" | "six-hats";
                maxChars: number;
                cursor?: never;
            };
        };
    } | {
        methods: {
            methodId: "1-2-4-all" | "affinity-kj" | "blameless-postmortem" | "brainwriting" | "checklist" | "crazy8s" | "daci" | "dot-voting" | "how-might-we" | "mind-map" | "ngt" | "page-led" | "premortem" | "retrospective" | "scamper" | "six-hats";
            version: 1;
            title: string;
            adaptation: string;
            steps: {
                id: string;
                title: string;
                required: readonly string[];
                finishCondition: string;
                adaptation: string;
                inputAction: {
                    endpointId: string;
                    arguments: {
                        methodId: "1-2-4-all" | "affinity-kj" | "blameless-postmortem" | "brainwriting" | "checklist" | "crazy8s" | "daci" | "dot-voting" | "how-might-we" | "mind-map" | "ngt" | "page-led" | "premortem" | "retrospective" | "scamper" | "six-hats";
                        stepId: string;
                    };
                };
                minimumAccounts?: number;
            }[];
        }[];
        truncated: boolean;
        cursor?: number;
        nextAction?: {
            endpointId: string;
            arguments: {
                methodId?: never;
                cursor: number;
                maxChars: number;
            };
        };
    };
    private validateFacilitationSources;
    /** Re-open every contribution before it affects a managed workflow. Raw
     * query rows are advisory: deleted, hidden, cross-scope, malformed, stale,
     * revoked, duplicate-ballot, and wrong-workshop rows never reach a count or
     * page cursor. */
    private managedWorkshopContributions;
    private facilitationCursorOffset;
    readWorkshopFacilitation(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        cursor?: unknown;
        limit?: number;
        maxChars?: number;
    }): Promise<any>;
    updateWorkshopFacilitation(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        expectedRevision: string;
        requestId: string;
        operation: string;
        payload?: unknown;
        stepId?: string;
        structured?: unknown;
        content?: string;
        kind?: string;
        references?: unknown;
        revalidateActor?: () => Promise<ScopePrincipal>;
    }): Promise<any>;
    contributeWorkshop(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        kind: string;
        content: string;
        ideaId?: string;
        references?: unknown;
        expectedPhase?: string;
        expectedRevision?: string;
        stepId?: string;
        structured?: unknown;
        requestId?: string;
        revalidateActor?: () => Promise<ScopePrincipal>;
    }): Promise<any>;
    updateWorkshopPhase(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        phase: string;
        reason: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        workshopId: string;
        phase: "closed" | "cluster" | "critique" | "decide" | "diverge" | "evaluate" | "synthesize";
        status: string;
        reason: string;
        revision: string;
    }>;
    synthesizeWorkshop(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        synthesis: string;
        references?: unknown;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        workshopId: string;
        phase: string;
        synthesisStatus: string;
        nextAction: string;
        revision: string;
    }>;
}
//# sourceMappingURL=ideation.d.ts.map