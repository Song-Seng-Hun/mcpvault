/** Preserve SHA256(decoded UTF-8), including replacement characters, without
 * retaining a whole file. Paths/permissions remain the service caller's job. */
export declare function hashUtf8Source(path: string, maxBytes?: number): Promise<string>;
//# sourceMappingURL=streaming-revision.d.ts.map