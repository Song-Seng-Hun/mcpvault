import type { ReviewedSkillHost } from './skill-release-reader.js';
export interface ReviewedSkillRegistration {
    version: 1;
    skillId: string;
    sourceName: string;
    state: 'admitted' | 'revoked';
    releaseHash: string;
    scenarioSetHash: string;
    policyRevision: string;
    reviewer: string;
}
export declare function parseReviewedSkillRegistration(bytes: Buffer, skillId: string): ReviewedSkillRegistration;
/** Read-only host adapter. Provisioning/admission is a separate host operation.
 * Does not create files, recover corrupt records, install scripts or grant access.
 * sourceFingerprint MUST use a bounded source worker, not a foreground full scan. */
export declare function openReviewedSkillStore(options: {
    hostPath: string;
    vaultPath: string;
    sourceFingerprint: (sourceName: string) => Promise<string | null>;
}): Promise<ReviewedSkillHost>;
//# sourceMappingURL=skill-release-store.d.ts.map