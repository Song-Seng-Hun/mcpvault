export interface UnderstandingLocator {
    path: string;
    revision: string;
    startLine?: number;
    endLine?: number;
}
export interface UnderstandingEntry {
    explanation: string;
    supports: UnderstandingLocator[];
    checks?: Array<{
        kind: 'self_check' | 'peer_check_report';
        method: string;
        outcome: 'passed' | 'failed' | 'inconclusive';
        evidence: UnderstandingLocator[];
    }>;
    openQuestions?: string[];
    nextStep: string;
}
export declare const UNDERSTANDING_SCHEMA: {
    type: string;
    minItems: number;
    maxItems: number;
    items: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            explanation: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            supports: {
                type: string;
                minItems: number;
                maxItems: number;
                items: {
                    anyOf: {
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
                    }[];
                    description: string;
                };
            };
            checks: {
                type: string;
                minItems: number;
                maxItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        kind: {
                            type: string;
                            enum: string[];
                        };
                        method: {
                            type: string;
                            minLength: number;
                            maxLength: number;
                            pattern: string;
                        };
                        outcome: {
                            type: string;
                            enum: string[];
                        };
                        evidence: {
                            type: string;
                            minItems: number;
                            maxItems: number;
                            items: {
                                anyOf: {
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
                                }[];
                                description: string;
                            };
                        };
                    };
                };
            };
            openQuestions: {
                type: string;
                minItems: number;
                maxItems: number;
                items: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                    pattern: string;
                };
            };
            nextStep: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
        };
    };
    description: string;
};
export declare function normalizeUnderstanding(value: unknown): UnderstandingEntry[];
//# sourceMappingURL=continuity-understanding-model.d.ts.map