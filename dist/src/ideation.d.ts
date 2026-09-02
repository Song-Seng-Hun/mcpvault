import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
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
export declare class IdeationService {
    private readonly fileSystem;
    private readonly references;
    constructor(fileSystem: FileSystemService, references: ReferenceService);
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
    }): Promise<{
        success: boolean;
        ideaId: string;
        path: string;
        status: string;
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
    }): Promise<{
        success: boolean;
        ideaId: string;
        path: string;
        status: string;
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
    }): Promise<{
        success: boolean;
        ideaId: string;
        contributionId: string;
        kind: "challenge" | "counterexample" | "evidence" | "extension" | "outcome" | "question" | "synthesis";
        path: string;
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
    }): Promise<{
        success: boolean;
        ideaId: string;
        evaluator: string;
        revision: string;
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
    }): Promise<{
        success: boolean;
        workshopId: string;
        path: string;
        phase: string;
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
    contributeWorkshop(params: {
        principal?: ScopePrincipal;
        workshopId: string;
        kind: string;
        content: string;
        ideaId?: string;
        references?: unknown;
        expectedPhase?: string;
    }): Promise<{
        success: boolean;
        workshopId: string;
        contributionId: string;
        phase: "closed" | "cluster" | "critique" | "decide" | "diverge" | "evaluate" | "synthesize";
        kind: "challenge" | "counterexample" | "decision" | "evaluation" | "extension" | "idea" | "synthesis";
        path: string;
    }>;
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