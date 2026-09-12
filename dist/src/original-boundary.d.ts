/** All scope-local source trees, including platform aliases, are append-only.
 * New captures use exclusive file creation; no permission can authorize replacing
 * an original. Ordinary knowledge paths do not acquire this restriction. */
export declare function isOriginalPath(value: string): boolean;
export declare function assertOriginalMutation(path: string, exclusiveCreation?: boolean): void;
//# sourceMappingURL=original-boundary.d.ts.map