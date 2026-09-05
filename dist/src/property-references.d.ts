/**
 * Managed frontmatter fields whose string values are note identities rather
 * than ordinary prose. Keeping this contract in one module prevents graph,
 * move, and delete operations from disagreeing about structural references.
 */
export declare const PLAIN_REFERENCE_PROPERTIES: Set<string>;
export interface FrontmatterReferenceValue {
    propertyPath: string;
    value: string;
    root: string;
    leaf: string;
}
export declare function isNavigationalFrontmatterReference(reference: FrontmatterReferenceValue): boolean;
/** Captured file paths are Vault-relative identities, not authored wikilinks. */
export declare function isReferenceSnapshotPath(segments: Array<string | number>): boolean;
export declare function propertyPathText(segments: Array<string | number>): string;
export declare function acceptsPlainReference(segments: Array<string | number>): boolean;
/** Return path-like values; explicit Obsidian links stay handled by the Markdown scanner. */
export declare function collectPlainFrontmatterReferences(frontmatter: Record<string, unknown>): FrontmatterReferenceValue[];
//# sourceMappingURL=property-references.d.ts.map