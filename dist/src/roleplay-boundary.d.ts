export declare function isRoleplaySheetPath(path: string): boolean;
/** Internal exact-path grant for generated sheets only; never a generic mutation permission. */
export declare function withRoleplayProjectionWrite<T>(path: string, operation: () => Promise<T>): Promise<T>;
/** Canonical roleplay records are append-only through the world store, not generic file mutations. */
export declare function assertRoleplayMutationBoundary(path: string): void;
//# sourceMappingURL=roleplay-boundary.d.ts.map