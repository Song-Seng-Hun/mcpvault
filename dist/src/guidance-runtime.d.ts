export interface GuidanceResolver {
    resolve(id: string, original: string): string;
    resolveDefault(original: string): string;
}
export declare function withGuidance<T>(resolver: GuidanceResolver | undefined, operation: () => T): T;
export declare function guidanceText<T extends string>(id: string, original: T): T;
export declare function guidanceError<T extends Error>(error: T, id: string): T;
export declare function renderGuidanceError(error: unknown): string;
/** Only call on code-owned schemas/policy, NEVER arbitrary tool results/notes. */
export declare function projectGuidance<T>(trusted: T): T;
//# sourceMappingURL=guidance-runtime.d.ts.map