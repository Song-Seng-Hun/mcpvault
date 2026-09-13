export declare const EXPRESSION_CHAPTERS: readonly ['language', 'precision', 'fiction'];
export declare const EXPRESSION_PROFILE_ID = "vault-dense-english";
export declare function expressionChapter(id: string): string;
export declare const EXPRESSION_REVISION: string;
export declare function expressionReference(): {
    profileId: string;
    executionAuthority: boolean;
    readAction: {
        endpointId: string;
        arguments: {
            topic: string;
            expectedProfileRevision: string;
            maxChars: number;
        };
    };
};
export interface ExpressionPolicyOptions {
    chapter?: unknown;
    expectedProfileRevision?: unknown;
    maxChars?: unknown;
    prettyPrint?: unknown;
}
export declare function expressionPolicy(options?: ExpressionPolicyOptions, envelope?: Record<string, unknown>): Record<string, any>;
//# sourceMappingURL=expression-profile.d.ts.map