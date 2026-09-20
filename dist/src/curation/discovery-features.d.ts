/** Advisory deterministic cues only. Not managed ownership, permission, semantic
 * equivalence, historical use, or absence of protected references. */
export declare function curationFeatures(row: {
    path: string;
    revision?: string;
    frontmatter: Record<string, unknown>;
    text: string;
}): {
    version: number;
    relations: boolean;
    body: string | null;
};
//# sourceMappingURL=discovery-features.d.ts.map