export interface KnowledgeInvestigation {
    question: string;
    targets: Array<{
        path: string;
        revision: string;
    }>;
    conditions: string;
    alternatives: string[];
    decisionRules: Array<{
        observation: string;
        interpretation: 'supports' | 'challenges' | 'inconclusive';
        consequence: string;
    }>;
    executionBoundary: string;
    result?: {
        planRevision: string;
        observed: string;
        outcome: 'supports' | 'challenges' | 'inconclusive';
        interpretation: string;
        limitations: string;
        evidence: Array<{
            path: string;
            revision: string;
        }>;
    };
}
export declare const KNOWLEDGE_INVESTIGATION_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        question: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
        targets: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    path: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                    revision: {
                        type: string;
                        pattern: string;
                    };
                };
            };
        };
        conditions: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
        };
        alternatives: {
            type: string;
            minItems: number;
            maxItems: number;
            uniqueItems: boolean;
            items: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
        };
        decisionRules: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    observation: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                    interpretation: {
                        type: string;
                        enum: string[];
                    };
                    consequence: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                };
            };
        };
        executionBoundary: {
            type: string;
            minLength: number;
            maxLength: number;
            pattern: string;
            description: string;
        };
        result: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                planRevision: {
                    type: string;
                    pattern: string;
                };
                observed: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                    pattern: string;
                };
                outcome: {
                    type: string;
                    enum: string[];
                };
                interpretation: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                    pattern: string;
                };
                limitations: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                    pattern: string;
                };
                evidence: {
                    type: string;
                    minItems: number;
                    maxItems: number;
                    items: {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            path: {
                                type: string;
                                minLength: number;
                                maxLength: number;
                                pattern: string;
                            };
                            revision: {
                                type: string;
                                pattern: string;
                            };
                        };
                    };
                };
            };
        };
    };
    description: string;
};
export declare function normalizeKnowledgeInvestigation(value: unknown): KnowledgeInvestigation;
//# sourceMappingURL=knowledge-investigation-model.d.ts.map