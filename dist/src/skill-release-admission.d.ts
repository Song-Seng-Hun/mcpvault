export interface ReviewedSkillAdmissionRequest {
    requestId: string;
    skillId: string;
    sourceName: string;
    releaseHash: string;
    scenarioSetHash: string;
    policyRevision: string;
    reviewer: string;
    expectedRevision: string | null;
}
export interface ReviewedSkillAdmissionOptions {
    hostPath: string;
    vaultPath: string;
    sourceFingerprint: (sourceName: string) => Promise<string | null>;
    readCandidateBlob: (hash: string) => Promise<Buffer>;
    /** Trusted host policy callback only; reading a skill never supplies this authority. */
    authorize: (request: Readonly<ReviewedSkillAdmissionRequest>) => Promise<{
        revalidate(): Promise<void>;
        assertFresh(): void;
    }>;
}
/** Host CLI/admin path only. No endpoint and no directory provisioning or stale-lock takeover.
 * Orphan hash blobs are harmless pending data; registry publication is last.
 * A prepared receipt allows re-verification of an already applied exact result. */
export declare function admitReviewedSkill(options: ReviewedSkillAdmissionOptions, input: ReviewedSkillAdmissionRequest): Promise<{
    state: 'complete';
    skillId: string;
    revision: string;
    releaseHash: string;
    executionAuthorized: false;
}>;
//# sourceMappingURL=skill-release-admission.d.ts.map