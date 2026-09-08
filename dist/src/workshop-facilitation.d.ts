/**
 * Pure, persisted workshop facilitation catalogue. This module deliberately
 * does not read files, authenticate callers, write notes, call models, or
 * advance time. The IdeationService supplies those boundaries.
 */
import { workshopLineagePrerequisites, type WorkshopLineagePrerequisiteCoverage } from './workshop-lineage.js';
export declare const FACILITATION_METHOD_IDS: readonly ['page-led', 'checklist', 'how-might-we', 'brainwriting', 'six-hats', 'scamper', 'crazy8s', '1-2-4-all', 'affinity-kj', 'mind-map', 'ngt', 'dot-voting', 'daci', 'premortem', 'retrospective', 'blameless-postmortem'];
export type FacilitationMethodId = typeof FACILITATION_METHOD_IDS[number];
export interface FacilitationStep {
    id: string;
    title: string;
    required: readonly string[];
    requiredFields: readonly string[];
    finishCondition: string;
    adaptation: string;
    minimumAccounts?: number;
}
export interface FacilitationMethod {
    methodId: FacilitationMethodId;
    version: 1;
    title: string;
    adaptation: string;
    steps: readonly FacilitationStep[];
}
export declare const FACILITATION_METHODS: readonly FacilitationMethod[];
export interface FacilitationSourceRevision {
    path: string;
    revision: string;
}
export interface FacilitationMethodState {
    methodId: FacilitationMethodId;
    version: 1;
    steps: readonly FacilitationStep[];
}
export interface WorkshopFacilitation {
    version: 1;
    purpose: string;
    scope: string;
    successCriteria: string[];
    sourceRevisions: FacilitationSourceRevision[];
    methods: FacilitationMethodState[];
    currentStepId: string;
    round: number;
    brainwritingCycle?: number;
    facilitatorAccountId: string;
    facilitatorGeneration: number;
    participants: string[];
    decisionAuthority: {
        approverAccountId?: string;
        delegatedAccountId?: string;
        delegationReason?: string;
    };
    checks: Array<Record<string, unknown>>;
    waitingReason?: string;
    resumeCondition?: string;
    outputs: Array<Record<string, unknown>>;
    ordinaryRedoCount: number;
}
export interface FacilitationSubmission {
    accountId: string;
    stepId: string;
    structured: Record<string, unknown>;
}
export interface FacilitationCompletion {
    complete: boolean;
    unmet: string[];
    minimumAccounts?: number;
}
/** Validates user input as well as persisted Markdown frontmatter. */
export declare function createFacilitation(value: unknown): WorkshopFacilitation;
/** Synthesis is a cross-method output, not another submission to the last
 * method's form (a closing checklist need not be duplicated in the synthesis). */
export declare function validateFacilitationSynthesis(value: unknown): Record<string, unknown>;
export declare function validateFacilitationCompletion(facilitation: WorkshopFacilitation, submissions: readonly FacilitationSubmission[]): FacilitationCompletion;
export declare function validateFacilitationSubmission(facilitation: WorkshopFacilitation, params: {
    accountId: string;
    stepId: string;
    workshopRevision: string;
    structured: unknown;
    existingSubmissions?: readonly FacilitationSubmission[];
    prerequisiteCoverage?: readonly WorkshopLineagePrerequisiteCoverage[];
}): {
    structured: Record<string, unknown>;
    ballotAccountId?: string;
    requiredPrerequisiteStepIds: readonly string[];
};
/** The service must read only these chronological step slices before validation. */
export { workshopLineagePrerequisites, type WorkshopLineagePrerequisiteCoverage };
export declare function nextFacilitationAction(facilitation: WorkshopFacilitation, submissions: readonly FacilitationSubmission[]): {
    kind: 'submit' | 'wait' | 'advance' | 'record_output';
    stepId: string;
    required: string[];
    finishCondition: string;
    adaptation: string;
    resumeCondition?: string;
};
export declare function advanceFacilitation(facilitation: WorkshopFacilitation, reason: string, submissions?: readonly FacilitationSubmission[]): WorkshopFacilitation;
export declare function managedFacilitationMarkdown(facilitation: WorkshopFacilitation): string;
//# sourceMappingURL=workshop-facilitation.d.ts.map