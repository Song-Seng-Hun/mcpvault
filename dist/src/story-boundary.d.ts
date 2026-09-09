/** Exact, synchronous-lifetime authority issued by trusted service code only. */
export declare function withStoryWrite<T>(path: string, operation: () => Promise<T>): Promise<T>;
export declare function assertStoryMutationBoundary(path: string): void;
//# sourceMappingURL=story-boundary.d.ts.map