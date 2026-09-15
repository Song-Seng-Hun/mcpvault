/** Host release DATA only. Parsing this file is not review, admission or execution authority. */
export interface SkillReleaseResource {
    id: string;
    blob: string;
    bytes: number;
    title: string;
    kind: 'procedure' | 'reference' | 'license' | 'descriptor';
}
export interface SkillReleaseManifest {
    version: 1;
    skillId: string;
    sourceFingerprint: string;
    metadataEvidenceHash: string;
    policyRevision: string;
    mode: 'procedural_reference';
    mainResource: string;
    resources: SkillReleaseResource[];
    descriptorResource?: string;
    retainedFunctions: string[];
    limitations: string[];
    useWhen: string[];
    avoidWhen: string[];
    review: {
        reviewer: string;
        evidenceHashes: string[];
        normalCaseHashes: string[];
        adversarialCaseHashes: string[];
    };
}
export declare function parseSkillReleaseManifest(input: unknown): SkillReleaseManifest;
//# sourceMappingURL=skill-release-manifest.d.ts.map