import type { Tool } from '@modelcontextprotocol/server';
export declare const WORK_MUTATING_TOOLS: readonly ['manage_work_group', 'manage_work_project', 'claim_work_task', 'handoff_work_task', 'review_work_task'];
export declare const WORK_TASK_PROPERTIES: {
    changeContext: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            reason: {
                type: string;
                maxLength: number;
            };
            scope: {
                type: string;
                maxLength: number;
            };
            constraints: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            decisions: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            risks: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            dissent: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            unverified: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            locators: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        id: {
                            type: string;
                            maxLength: number;
                        };
                        role: {
                            type: string;
                            enum: string[];
                        };
                        path: {
                            type: string;
                            maxLength: number;
                        };
                        revision: {
                            type: string;
                            maxLength: number;
                        };
                        repository: {
                            type: string;
                            maxLength: number;
                        };
                        commit: {
                            type: string;
                            maxLength: number;
                        };
                        file: {
                            type: string;
                            maxLength: number;
                        };
                        startLine: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        endLine: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        required: {
                            type: string;
                            default: boolean;
                        };
                    };
                };
            };
        };
    };
    migrateReviewContract: {
        type: string;
        description: string;
    };
    responsibility: {
        type: string;
        additionalProperties: boolean;
        description: string;
        properties: {
            question: {
                type: string;
                maxLength: number;
            };
            perspective: {
                type: string;
                maxLength: number;
            };
            mode: {
                type: string;
                enum: string[];
            };
            deliverables: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            conditions: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
            };
            coversCriteria: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    maxLength: number;
                };
                description: string;
            };
            resources: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    properties: {
                        path: {
                            type: string;
                            maxLength: number;
                        };
                        repository: {
                            type: string;
                            maxLength: number;
                        };
                        file: {
                            type: string;
                            maxLength: number;
                        };
                    };
                    description: string;
                };
            };
        };
    };
    projectId: {
        type: string;
        maxLength: number;
    };
    parentTaskId: {
        type: string;
        maxLength: number;
    };
    dependsOn: {
        type: string;
        maxItems: number;
        items: {
            type: string;
            maxLength: number;
        };
    };
    completionCriteria: {
        type: string;
        maxItems: number;
        items: {
            type: string;
            maxLength: number;
        };
    };
    artifacts: {
        type: string;
        maxItems: number;
        items: {
            type: string;
            additionalProperties: boolean;
            properties: {
                path: {
                    type: string;
                    maxLength: number;
                };
                revision: {
                    type: string;
                    maxLength: number;
                };
                repository: {
                    type: string;
                    maxLength: number;
                };
                branch: {
                    type: string;
                    maxLength: number;
                };
                commit: {
                    type: string;
                    pattern: string;
                    description: string;
                };
                files: {
                    type: string;
                    maxItems: number;
                    items: {
                        type: string;
                        maxLength: number;
                    };
                };
            };
        };
    };
    workKind: {
        type: string;
        enum: string[];
        description: string;
    };
    discussionSlug: {
        type: string;
        maxLength: number;
    };
    verification: {
        type: string;
        maxLength: number;
    };
    expectedGeneration: {
        type: string;
        minimum: number;
        description: string;
    };
    requestId: {
        type: string;
        maxLength: number;
        description: string;
    };
};
export declare function getWorkTools(): Tool[];
//# sourceMappingURL=work-tools.d.ts.map