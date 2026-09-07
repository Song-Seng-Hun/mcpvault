export interface KnowledgeSynthesis {
    question: string;
    inputs: Array<{
        id: string;
        path: string;
        revision: string;
        role?: 'premise' | 'historical_context';
    }>;
    explanations: Array<{
        id: string;
        explanation: string;
        appliesWhen: string;
        limitations: string;
        basis: string[];
    }>;
    choices: Array<{
        when: string;
        explanationId: string;
        basis: string[];
        reason: string;
    }>;
    counterexamples: Array<{
        description: string;
        basis: string[];
    }>;
    unresolvedQuestions: string[];
}
export declare const KNOWLEDGE_SYNTHESIS_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        question: {
            type: string;
            minLength: number;
            maxLength: number;
        };
        inputs: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                    path: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    revision: {
                        type: string;
                        pattern: string;
                    };
                    role: {
                        type: string;
                        enum: string[];
                        description: string;
                    };
                };
                required: string[];
            };
        };
        explanations: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                    explanation: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    appliesWhen: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    limitations: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    basis: {
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
                };
            };
        };
        choices: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    when: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    explanationId: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                        pattern: string;
                    };
                    basis: {
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
                    reason: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
            };
        };
        counterexamples: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    description: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    basis: {
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
                };
            };
        };
        unresolvedQuestions: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                minLength: number;
                maxLength: number;
            };
        };
    };
    description: string;
};
/** Checks shape and declared support only; contradictory or malicious prose remains untrusted data. */
export declare function normalizeKnowledgeSynthesis(value: unknown): KnowledgeSynthesis;
//# sourceMappingURL=knowledge-synthesis-model.d.ts.map