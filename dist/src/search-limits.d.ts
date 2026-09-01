export declare const DEFAULT_SEARCH_LIMIT = 5;
export declare const MAX_SEARCH_LIMIT = 20;
export declare const DEFAULT_SEARCH_MAX_CHARS = 4000;
export declare const MAX_SEARCH_MAX_CHARS = 12000;
export declare function normalizeSearchLimit(value: unknown, defaultValue?: number): number;
export declare function normalizeSearchMaxChars(value: unknown, defaultValue?: number): number;
/** Keep the compact JSON payload within the requested context budget. */
export declare function boundSearchResults<T>(results: T[], maxChars: number): T[];
/** Bound metadata/list responses without cutting JSON in the middle. */
export declare function boundItems<T>(items: T[], maxChars: number): {
    items: T[];
    truncated: boolean;
};
/**
 * Keep only the best K items while iterating a large result set. `compare`
 * follows Array#sort semantics: negative means the first item is better.
 * The returned items are sorted with the same comparator.
 */
export declare function boundedTopK<T>(items: Iterable<T>, limit: number, compare: (a: T, b: T) => number): T[];
//# sourceMappingURL=search-limits.d.ts.map