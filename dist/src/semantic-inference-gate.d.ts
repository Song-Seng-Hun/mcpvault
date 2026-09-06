export type SemanticInferencePriority = 'foreground' | 'background';
export declare class SemanticInferenceBusyError extends Error {
    constructor();
}
/** One native model call at a time, not a global request or file-IO limiter. */
export declare class SemanticInferenceGate {
    private active;
    private foregroundBurst;
    private readonly waiting;
    run<T>(priority: SemanticInferencePriority, task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    private pump;
}
export declare const semanticInferenceGate: SemanticInferenceGate;
//# sourceMappingURL=semantic-inference-gate.d.ts.map