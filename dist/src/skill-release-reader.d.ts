import { type SkillReleaseManifest } from './skill-release-manifest.js';
/** Host-code adapters only; never construct these from an endpoint argument. */
export interface ReviewedSkillEntry {
    releaseHash: string;
    generation: string;
    sourceName: string;
    /** Current NAS output binding; manifest sourceFingerprint remains review provenance. */
    contentFingerprint?: string;
}
export interface ReviewedSkillHost {
    /** Private bounded discovery window, not an inventory or an access decision.
     * IDs must never be returned until the same release reader authorizes them. */
    candidates?(): Promise<readonly string[]>;
    /** Bounded, resumable registry iteration. The host cursor is private to the
     * adapter; discovery replaces it with an authenticated opaque cursor. */
    candidatesPage?(cursor?: string, scanBudget?: number): Promise<{
        candidates: readonly string[];
        nextCursor?: string;
        registryGeneration: string;
    }>;
    entry(skillId: string): Promise<ReviewedSkillEntry | undefined>;
    /** Final synchronous registry and complete delivered-resource fence. Optional
     * hashes preserve entry-only host checks; readers always provide their full set.
     * No callback or awaited IO may follow the delivery fence. */
    assertFresh(entry: ReviewedSkillEntry, blobHashes?: readonly string[]): void;
    readBlob(sha256: string, entry?: ReviewedSkillEntry): Promise<Buffer>;
    sourceFingerprint(sourceName: string): Promise<string | null>;
    verifyEvidence(manifest: SkillReleaseManifest): Promise<boolean>;
}
export interface ReviewedSkillAuthorization {
    /** Check current identity, source ACLs and host validity; legacy hosts also check owner consent. */
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