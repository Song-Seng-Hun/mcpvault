/** Exact first limit round-robin entries: at most limit groups * limit rows.
 * Distinct group keys still use O(groups) memory for an observed diversity count. */
export declare function createRecallCollector<T>(limit: number, compare: (a: T, b: T) => number): {
    add(group: string, row: T): void;
    readonly retainedCount: number;
    readonly groupCount: number;
    values(): T[];
};
/** Never turn a compacted active-recall task into a silently shortened question. */
export declare function packRecallQueue(candidates: Array<Record<string, any>>, total: number, groups: number, maxChars: number, pretty: boolean): Record<string, any> & {
    items: Array<Record<string, any>>;
    total: number;
    truncated: boolean;
};
//# sourceMappingURL=recall-queue.d.ts.map