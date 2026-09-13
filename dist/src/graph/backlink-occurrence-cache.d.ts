/** Bounded, caller-view-local read model. Values are occurrences, not decisions
 * about access, verification, ranking or truth. Only exhaustive scans commit. */
export declare class BacklinkOccurrenceCache<T> {
    private readonly maxTargets;
    private readonly maxRetained;
    private readonly maxFill;
    private readonly entries;
    private retained;
    private filling;
    constructor(maxTargets?: number, maxRetained?: number, maxFill?: number);
    read(target: string, scan: () => Iterable<T>): Generator<T>;
}
//# sourceMappingURL=backlink-occurrence-cache.d.ts.map