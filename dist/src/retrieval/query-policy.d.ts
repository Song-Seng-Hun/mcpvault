/** Shared query semantics only. This policy grants no access or execution authority. */
export declare function constrainedQuery(query: string): boolean;
export declare function semanticQueryState(query: string, enabled: unknown, caseSensitive?: boolean): 'disabled' | 'filtered' | 'permitted';
export declare function plainQueryExpansion(query: string): string | undefined;
//# sourceMappingURL=query-policy.d.ts.map