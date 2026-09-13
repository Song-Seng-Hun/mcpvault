import type { CompilationBundle } from './compilation-bundle-model.js';
import type { HostWorkRecords, HostWorkWriter } from './host-work-storage.js';
import type { DocumentStructure } from './document-structure.js';
import type { BundleChapterPlan } from './document-bundle-plan.js';
export interface CandidateContext {
    bundle: CompilationBundle;
    source: DocumentStructure;
    plan: BundleChapterPlan;
    jobRevision: string;
    records: HostWorkRecords;
    acquire(): Promise<HostWorkWriter>;
    assertCurrent(): Promise<void>;
    assertReferences(paths: string[]): void;
    reserveCandidate(raw: string): void;
}
export declare function chapterPlanPage(ctx: CandidateContext, params: Record<string, any>): {
    bundleId: string;
    planRevision: string;
    sourceRevision: string;
    items: Record<string, unknown>[];
    partial: boolean;
    automaticApplication: boolean;
    nextAction?: {
        endpointId: string;
        arguments: {
            kind: string;
            op: string;
            projection: string;
            bundleId: string;
            expectedJobRevision: string;
            expectedPlanRevision: string;
            chapterCursor: number;
            maxChars: any;
        };
    };
};
/** Private, per-chapter receipts. No model, Vault write, semantic pass or publication.
 * Parent service owns current ACL/runtime/source checks, including every return. */
export declare function chapterCandidate(ctx: CandidateContext, params: Record<string, any>): Promise<any>;
//# sourceMappingURL=compilation-bundle-candidates.d.ts.map