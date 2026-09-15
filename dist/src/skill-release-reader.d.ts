import { type SkillReleaseManifest } from './skill-release-manifest.js';
/** Host-code adapters only; never construct these from an endpoint argument. */
export interface ReviewedSkillHost {
    /** Private bounded discovery window, not an inventory or an access decision.
     * IDs must never be returned until the same release reader authorizes them. */
    candidates?(): Promise<readonly string[]>;
    entry(skillId: string): Promise<{
        releaseHash: string;
        generation: string;
        sourceName: string;
    } | undefined>;
    /** Final synchronous registry and complete delivered-resource fence. Optional
     * hashes preserve entry-only host checks; readers always provide their full set.
     * No callback or awaited IO may follow the delivery fence. */
    assertFresh(entry: {
        releaseHash: string;
        generation: string;
        sourceName: string;
    }, blobHashes?: readonly string[]): void;
    readBlob(sha256: string): Promise<Buffer>;
    sourceFingerprint(sourceName: string): Promise<string | null>;
    verifyEvidence(manifest: SkillReleaseManifest): Promise<boolean>;
}
export interface ReviewedSkillAuthorization {
    /** Must check real current identity, original ACL, owner consent and runtime. */
    begin(skillId: string, sourceName: string): Promise<{
        revalidate(): Promise<void>;
        assertFresh(): void;
    }>;
}
export interface ReviewedSkillDeliveryFence {
    revalidate(): Promise<void>;
    assertFresh(): void;
}
/** No fallback to a mutable or quarantined source. Blob IO must be bounded by the host. */
export declare function readReviewedSkill(host: ReviewedSkillHost, authorization: ReviewedSkillAuthorization, p: Record<string, unknown>, captureDeliveryFence?: (fence: ReviewedSkillDeliveryFence) => void): Promise<Record<string, any>>;
//# sourceMappingURL=skill-release-reader.d.ts.map