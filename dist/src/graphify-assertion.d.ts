import type { GraphAssertion } from './graph-assertion.js';
export interface GraphifyAssertionHost {
    repositoryId: string;
    /** Explicit host allowlist/current permission, not a client supplied grant. */
    canRead(path: string): boolean;
    /** Re-read actual source bytes, validate local path/link safety, return SHA256.
     * Never return a cached or packet-supplied hash here. */
    readRevision(path: string): Promise<string>;
}
/** Host-only adapter for the existing P3 bounded query result. It never runs an
 * AST extractor or reads a Vault. Private structural candidates, NOT MCP output
 * or claims of complete token occurrences, passing tests or verified evidence. */
export declare function adaptGraphifyAssertions(input: unknown, host: GraphifyAssertionHost): Promise<{
    assertions: GraphAssertion[];
    partial: boolean;
    testStatus: string;
    tool: {
        name: string;
        version: string;
        adapterVersion: number;
    };
    notice: string;
}>;
//# sourceMappingURL=graphify-assertion.d.ts.map