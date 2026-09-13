export type AssertionLocator = {
    basis: 'properties';
    propertyPath: string;
} | {
    basis: 'markdown_body';
    line: number;
    occurrence: number;
} | {
    basis: 'graphify_result';
    occurrence: number;
    sourceLocation?: string;
};
export interface GraphAssertion {
    id: string;
    source: {
        repositoryId: string;
        documentId: string;
        versionId: string;
        path: string;
        revision: string;
        identityBasis: 'repository_path_not_rename_stable';
        claimId?: string;
        symbolId?: string;
    };
    relation: string;
    direction: 'source_to_target';
    targetReference: string;
    /** Present only after a host adapter has resolved and revalidated the target.
     * Still private; not a substitute for a public endpoint's ACL boundary. */
    target?: {
        documentId: string;
        versionId: string;
        path: string;
        revision: string;
        symbolId?: string;
    };
    syntax?: 'markdown';
    locator: AssertionLocator;
    kind: 'authored' | 'extracted' | 'inferred';
    extraction: {
        method: 'properties' | 'obsidian_links' | 'graphify_result';
        version: number;
    };
    evidenceState: 'not_verified';
}
/** Private candidate extraction, NOT an ACL boundary. Never serialize candidates
 * until both endpoints have been uniquely resolved and revalidated by the caller.
 * Properties and body occurrences are separate; line coordinates exclude headers.
 * Identical occurrences remain separate even if a consumer uses a simple graph. */
export declare function extractGraphAssertions(input: {
    repositoryId: string;
    path: string;
    revision: string;
    frontmatter: Record<string, unknown>;
    content: string;
    limit?: number;
}): {
    assertions: GraphAssertion[];
    partial: boolean;
};
/** Lossy discovery-only projection; raw occurrence records remain untouched.
 * No weights, confidence, evidence independence or permission propagation. */
export declare function projectAssertionPairs(assertions: readonly GraphAssertion[]): {
    source: string;
    targetReference: string;
}[];
//# sourceMappingURL=graph-assertion.d.ts.map