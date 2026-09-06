/** Allocate distinct physical destinations within one bounded proposal snapshot.
 * This is not a filesystem reservation or an authorization check. Callers must
 * still validate visibility and require a current/missing revision for writes. */
export declare function allocateProposalPaths(items: Array<{
    path: string;
    identity: string;
}>): string[];
//# sourceMappingURL=proposal-paths.d.ts.map