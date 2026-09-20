import { type BundlePlanBasis } from './document-bundle-plan.js';
export interface VerbatimSplitPlan {
    status: 'ready';
    sourceRevision: string;
    fingerprint: string;
    toc: string;
    chapters: {
        path: string;
        content: string;
        revision: string;
        startOffset: number;
        endOffset: number;
        chapterId: string;
    }[];
}
/** Lossless structural split, not translation, semantic merging or approval.
 * Unsupported anchor/link ownership is an explicit review, never silent loss. */
export declare function planVerbatimSplit(path: string, raw: string, basis: BundlePlanBasis): VerbatimSplitPlan | {
    status: 'review_required';
    reason: string;
};
//# sourceMappingURL=compilation-split-plan.d.ts.map