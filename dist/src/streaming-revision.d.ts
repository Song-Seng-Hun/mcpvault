/** Preserve SHA256(decoded UTF-8), including replacement characters, without
 * retaining a whole file. An optional synchronous consumer observes the same
 * decoded stream (including its final suffix); it owns any text it retains.
 * Paths/permissions remain the service caller's job. */
export declare function hashUtf8Source(path: string, maxBytes?: number, consume?: (text: string) => void): Promise<string>;
//# sourceMappingURL=streaming-revision.d.ts.map