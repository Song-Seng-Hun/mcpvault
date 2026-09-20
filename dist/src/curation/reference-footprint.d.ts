export declare function referenceTargetKeys(note: {
    path: string;
    frontmatter: Record<string, any>;
}): string[];
export declare function referenceDocumentPath(path: string): void;
export declare function referenceFootprint(note: {
    path: string;
    text: string;
    frontmatter: Record<string, unknown>;
}): {
    keys: string[];
    partial: boolean;
};
//# sourceMappingURL=reference-footprint.d.ts.map