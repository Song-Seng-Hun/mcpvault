interface Content {
    content: string;
    frontmatter: Record<string, unknown>;
    path?: string;
}
/** Narrow automatic duplicate proof, not a semantic-equivalence classifier.
 * Unknown properties, provenance, aliases, conditions and raw body are retained.
 * Broader replacement proposals require reviewed passage mappings. */
export declare function archiveCoverage(source: Content, replacement: Content): boolean;
export {};
//# sourceMappingURL=archive.d.ts.map