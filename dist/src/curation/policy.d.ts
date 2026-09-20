export declare const CURATION_OPERATIONS: readonly ['deduplicate_relations', 'archive_duplicate', 'merge_duplicates', 'merge_passages'];
export type CurationOperation = typeof CURATION_OPERATIONS[number];
export interface CurationGrant {
    accountId: string;
    paths: string[];
    operations: CurationOperation[];
    owner?: 'wiki_knowledge';
}
export declare function curationPath(value: unknown): string;
/** Structural journal/input validation only. Does not authorize a service path. */
export declare function curationRecordPath(value: unknown): string;
/** Host-owned exact-path automation grant. Metadata cannot grant managed ownership. */
export declare function curationGrants(value: unknown): CurationGrant[];
//# sourceMappingURL=policy.d.ts.map