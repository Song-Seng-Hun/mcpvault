import type { QueryNote } from './types.js';
type ReadAction = {
    endpointId: 'notes.read';
    arguments: {
        path: string;
        maxChars: number;
    };
};
type RepairTarget = {
    path: string;
    revision: string;
};
export interface CollectionItem {
    key?: string;
    groupKeyOmitted?: true;
    repairTarget: RepairTarget;
    entryPoint?: string;
    representativePath?: string;
    representativeTitle?: string;
    purpose?: string;
    scope?: string;
    questions?: string[];
    total?: number;
    knowledge?: number;
    inbox?: number;
    reviewDue?: number;
    withoutSummary?: number;
    withOpenQuestions?: number;
    attentionScore?: number;
    signals?: string[];
    /** Legacy intent label, not an endpoint ID. */
    nextAction?: string;
    action?: ReadAction;
}
export interface CollectionReport {
    advisory: true;
    basis: 'known_source_snapshot';
    totalNotes?: number;
    collectionTotal?: number;
    collectionCountComplete?: boolean;
    untrackedMemberships?: number;
    generatedAt?: string;
    items?: CollectionItem[];
    nextAction?: ReadAction;
    truncated: boolean;
    retry?: {
        endpointId: 'wiki.organization_health';
        reuseOriginalArguments: true;
        overrides: {
            maxChars: 16000;
        };
    };
    unavailable?: 'exact_target_exceeds_maximum_budget';
}
/** Consumes only the caller's coherent, visible note snapshots. No IO or writes. */
export declare class CollectionHealthProjection {
    private readonly publicPath;
    private readonly evaluatedAt;
    private readonly groups;
    private totalNotes;
    private untrackedMemberships;
    private nextReviewAt;
    constructor(publicPath: (path: string) => string, evaluatedAt?: number);
    isCurrent(at?: number): boolean;
    add(note: QueryNote & {
        revision: string;
    }): void;
    report(limit: number, maxChars: number): CollectionReport;
}
export {};
//# sourceMappingURL=collection-health.d.ts.map