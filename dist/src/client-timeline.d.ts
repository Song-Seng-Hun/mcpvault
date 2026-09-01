export interface ClientTimelineCacheOptions<T> {
    maxEntries?: number;
    getId: (item: T) => string;
    getRevision?: (item: T) => string | undefined;
}
export interface ClientTimelineMergeResult<T> {
    /** One current copy for each valid incoming item, in incoming order. */
    items: T[];
    addedIds: string[];
    updatedIds: string[];
    duplicateIds: string[];
}
/**
 * Host-side bounded cache for cursor-paginated chat or community timelines.
 * It deduplicates context overlap locally; server authorization and freshness
 * remain authoritative.
 */
export declare class ClientTimelineCache<T> {
    private readonly options;
    private readonly entries;
    private readonly maxEntries;
    constructor(options: ClientTimelineCacheOptions<T>);
    merge(items: T[]): ClientTimelineMergeResult<T>;
    get(id: string): T | undefined;
    values(): T[];
    size(): number;
    remove(id: string): boolean;
    clear(): void;
    private idFor;
    private isSame;
}
//# sourceMappingURL=client-timeline.d.ts.map