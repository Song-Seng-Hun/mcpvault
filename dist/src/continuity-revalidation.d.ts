type RevisionEntry = {
    path: string;
    currentRevision?: string;
};
/** Bounded review instructions, not read receipts or a shortcut to ready. */
export declare function learningRevalidation(input: {
    root: {
        path: string;
        revision: string;
    };
    rootChanged: boolean;
    structureChanged: boolean;
    sourceSnapshotChanged: boolean;
    changedEntries: RevisionEntry[];
}): {
    state: string;
    understandingVerified: boolean;
    pathReviewRequired: boolean;
    changedReadsTotal: number;
    reads: {
        endpointId: string;
        arguments: {
            path: string;
            expectedRevision: string;
            startLine: number;
            endLine: number;
            maxChars: number;
        };
    }[];
    readsOmitted: number;
    checkpoint: {
        endpointId: string;
        requiredArguments: string[];
    };
    guidance: "Read changed sources at these revisions; follow read continuations for omitted content. Review route/dependencies when required. Save reviewed progress using the resume checkpoint revision, preserving only still-valid completedThrough. Read receipts do not validate understanding; its checks remain separate.";
};
export {};
//# sourceMappingURL=continuity-revalidation.d.ts.map