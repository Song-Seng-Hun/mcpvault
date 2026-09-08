/**
 * Cross-submission provenance checks for managed workshop methods. The caller
 * supplies only submissions from `workshopLineagePrerequisites(stepId)`;
 * this module never reads a workshop, index, or derived view itself.
 */
export interface WorkshopLineageSubmission {
    accountId: string;
    stepId: string;
    structured: Record<string, unknown>;
}
export interface WorkshopLineageResult {
    requiredPrerequisiteStepIds: readonly string[];
}
/** `complete: false` means the caller hit its bounded per-step read limit. */
export interface WorkshopLineagePrerequisiteCoverage {
    stepId: string;
    complete: boolean;
}
/** The service uses this before its bounded chronological submission read. */
export declare function workshopLineagePrerequisites(stepId: string): readonly string[];
export declare function validateWorkshopLineage(params: {
    stepId: string;
    structured: Record<string, unknown>;
    priorSubmissions?: readonly WorkshopLineageSubmission[];
    participants?: readonly string[];
    prerequisiteCoverage?: readonly WorkshopLineagePrerequisiteCoverage[];
}): WorkshopLineageResult;
//# sourceMappingURL=workshop-lineage.d.ts.map