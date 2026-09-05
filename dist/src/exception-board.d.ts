/** A narrow projection contract; no child-view metadata is spread into output. */
export interface ExceptionBoardItem {
    path: string;
    code: string;
    category: string;
    severity: 'error' | 'warning';
    state: 'open' | 'quarantined';
    revision?: string;
    sourceState: 'snapshot_matched' | 'recheck_required';
    suggestedAction: string;
    detail: string;
    nextAction: {
        endpointId: string;
        arguments: Record<string, unknown>;
    };
}
export type ExceptionBoardProjectedItem = Omit<ExceptionBoardItem, 'detail' | 'suggestedAction' | 'state' | 'category'> & Partial<Pick<ExceptionBoardItem, 'detail' | 'suggestedAction' | 'state' | 'category'>>;
export type ExceptionBoardResult = {
    counts?: Record<string, number>;
    total: number;
    countScope: 'validated_candidates';
    coverage: 'partial';
    advisory: true;
    truncated: boolean;
    items: ExceptionBoardProjectedItem[];
    note?: string;
} | {
    advisory: true;
    coverage: 'partial';
    truncated: true;
    retry: {
        endpointId: 'wiki.exception_board';
        reuseOriginalArguments: true;
        overrides: {
            maxChars: 16000;
        };
    };
};
export declare function packExceptionBoard(candidates: ExceptionBoardItem[], limit: number, maxChars: number, sourceTruncated: boolean): ExceptionBoardResult;
//# sourceMappingURL=exception-board.d.ts.map