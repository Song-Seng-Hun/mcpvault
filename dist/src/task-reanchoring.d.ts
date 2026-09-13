/** A failed edit may offer a fresh read, never permission to replay the old edit. */
export declare class TaskReanchorError extends Error {
    readonly recovery: {
        error: string;
        reason: string;
        currentRevision: string;
        candidate?: {
            line: number;
            taskId: string;
        };
        nextAction: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                startLine: number;
                endLine: number;
                maxChars: number;
            };
        };
    };
    constructor(path: string, revision: string, content: string, taskId?: string, reason?: string);
}
//# sourceMappingURL=task-reanchoring.d.ts.map