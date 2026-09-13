import type { DocumentStructure } from './document-structure.js';
export declare const BUNDLE_PLAN_RULE = "private-chapter-plan-v1";
export interface BundlePlanBasis {
    documentId: string;
    bundleId: string;
    chapterRoot: string;
    ruleVersion: string;
}
export declare function createBundlePlan(source: DocumentStructure, basis: BundlePlanBasis): {
    revision: string;
    rule: string;
    documentId: string;
    bundleId: string;
    sourceRevision: string;
    items: {
        chapterId: string;
        path: string;
        parent: string;
        identity: "ambiguous" | "content";
        sourceHash: string;
        kind: "chapter" | "source_reference";
        title: string;
        description: string;
        startOffset: number;
        endOffset: number;
        position: number;
        previous: string | undefined;
        next: string | undefined;
    }[];
};
export type BundleChapterPlan = ReturnType<typeof createBundlePlan>;
//# sourceMappingURL=document-bundle-plan.d.ts.map