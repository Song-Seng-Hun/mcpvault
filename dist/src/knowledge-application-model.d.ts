export declare const APPLICATION_OUTCOMES: readonly ['succeeded', 'failed', 'inconclusive'];
export interface KnowledgeApplication {
    id: string;
    knowledge: {
        path: string;
        revision: string;
    };
    environment: string;
    conditions: string;
    outcome: (typeof APPLICATION_OUTCOMES)[number];
    observed: string;
    limitations?: string;
    verification?: {
        path: string;
        revision: string;
    };
}
export declare const KNOWLEDGE_APPLICATIONS_SCHEMA: {
    type: string;
    description: string;
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
            knowledge: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    path: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    revision: {
                        type: string;
                        pattern: string;
                    };
                };
            };
            environment: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            conditions: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            outcome: {
                type: string;
                enum: ("failed" | "inconclusive" | "succeeded")[];
            };
            observed: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            limitations: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            verification: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    path: {
                        type: string;
                        minLength: number;
                        maxLength: number;
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
export declare function normalizeKnowledgeApplications(value: unknown): KnowledgeApplication[];
//# sourceMappingURL=knowledge-application-model.d.ts.map