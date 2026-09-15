import type { ReviewedSkillDeliveryFence, ReviewedSkillHost } from './skill-release-reader.js';
/** Procedural data is deliberately not a RetrievalHit / factual source path. */
export interface ReviewedProcedureCard {
    skillId: string;
    releaseRevision: string;
    executionAuthorized: false;
    limitations: string[];
    useWhen: string[];
    avoidWhen: string[];
    card: Record<string, unknown>;
    nextAction: unknown;
}
export interface ReviewedProcedureDiscovery {
    kind: 'reviewed_procedures';
    cards: ReviewedProcedureCard[];
    partial: true;
    notice: string;
}
export declare function emptyReviewedProcedureDiscovery(): ReviewedProcedureDiscovery;
/** Bounded canary discovery, not a full-library ranker. Only the host can name
 * candidates. The caller supplies the very same verified reader used by resolve.
 * Hidden/revoked/failed/nonmatching candidates produce no titles or counts. */
export declare function discoverReviewedProcedures(options: {
    host: ReviewedSkillHost;
    query: unknown;
    maxChars?: unknown;
    limit?: unknown;
    identity: ReviewedSkillDeliveryFence;
    read: (skillId: string, capture: (f: ReviewedSkillDeliveryFence) => void) => Promise<Record<string, any>>;
}, captureDeliveryFence?: (f: ReviewedSkillDeliveryFence) => void): Promise<ReviewedProcedureDiscovery>;
//# sourceMappingURL=skill-release-discovery.d.ts.map