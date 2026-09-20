interface MemoryGroundingItem {
    path: string;
    revision: string;
    role: string;
    validity: string;
    state: string;
    basis: Array<{
        path?: string;
        revision?: string;
        state: string;
    }>;
}
/** Typed, read-only handoff. Mechanical revision checks are not semantic or environment verification. */
export declare function memoryGrounding(item: MemoryGroundingItem): {
    state: string;
    reasons: string[];
    sourceFamily: string;
    sourceIntegrity: string;
    environment: string;
    semanticJudgment: string;
    automaticApplication: boolean;
    nextAction: {
        endpointId: string;
        arguments: {
            op: string;
            maxChars: number;
        };
    };
    workflow: string;
};
export {};
//# sourceMappingURL=grounding.d.ts.map