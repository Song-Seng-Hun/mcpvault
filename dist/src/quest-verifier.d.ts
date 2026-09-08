/** A deliberately narrow objective contract, not an LLM quality/claim evaluator.
 * No user-supplied program, regex, executable, URL fetch, or template is run. */
export declare function validateMarkdownContract(version: string, criteria: string[]): void;
export declare function verifyMarkdownContract(version: string, criteria: string[], bodies: string[]): boolean;
//# sourceMappingURL=quest-verifier.d.ts.map