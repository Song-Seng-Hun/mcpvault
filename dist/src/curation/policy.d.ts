export declare const CURATION_OPERATIONS: readonly ['deduplicate_relations'];
export type CurationOperation = typeof CURATION_OPERATIONS[number];
export interface CurationGrant {
    accountId: string;
    paths: string[];
    operations: CurationOperation[];
}
export declare function curationPath(value: unknown): string;
/** Host-owned exact-path automation grant. Metadata cannot grant managed ownership. */
export declare function curationGrants(value: unknown): CurationGrant[];
//# sourceMappingURL=policy.d.ts.map