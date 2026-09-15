import { type SkillReleaseManifest } from './skill-release-manifest.js';
/** Excludes evidence hashes to avoid a circular digest. Includes every delivered
 * resource and condition: tests of an earlier derivative cannot approve new text. */
export declare function skillReleaseReviewBasis(m: SkillReleaseManifest): string;
/** This trust anchor is provisioned by the host, never from a skill or MCP input.
 * Host preparation must pin the scenario set BEFORE authoring the derivative.
 * Hashes alone cannot prove when a human/agent actually performed a review. */
export interface SkillReleaseEvidenceAnchor {
    scenarioSetHash: string;
    policyRevision: string;
    reviewer: string;
}
/** Verifies bounded evidence-record consistency, not truth, legal clearance or
 * runtime authority. Actual review observations and host admission remain required. */
export declare function verifySkillReleaseEvidence(input: SkillReleaseManifest, anchor: SkillReleaseEvidenceAnchor, readBlob: (hash: string) => Promise<Buffer>): Promise<boolean>;
//# sourceMappingURL=skill-release-evidence.d.ts.map