export interface LearningConfigurationState {
    definition: Record<string, unknown>;
    mappings: Array<{
        nodeId: string;
        path: string;
        revision: string;
    }>;
    fingerprint: string;
}
export declare function prepareLearningConfiguration(input: unknown, entries: Array<{
    path: string;
    revision: string;
}>, context: {
    rootPath: string;
    rootRevision: string;
    sourceFingerprint: string;
    order: string;
}, allowUnpinned: boolean): LearningConfigurationState;
export declare function isLearningConfigurationState(value: unknown): value is LearningConfigurationState;
export declare const LEARNING_CONFIGURATION_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        definition: {
            type: string;
            description: string;
        };
        mappings: {
            type: string;
            minItems: number;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    nodeId: {
                        type: string;
                        pattern: string;
                    };
                    path: {
                        type: string;
                        maxLength: number;
                    };
                };
            };
        };
        expectedFingerprint: {
            type: string;
            pattern: string;
        };
    };
};
//# sourceMappingURL=learning-configuration.d.ts.map