interface SnapshotWriteLimits {
    maxBytes: number;
    maxDecodedBytes: number;
}
/** Internal disposable cache paths only. Does not authorize source-document IO. */
export declare function writeGzipSnapshot(path: string, chunks: Iterable<string | Uint8Array>, limits: SnapshotWriteLimits): Promise<void>;
export {};
//# sourceMappingURL=snapshot-write.d.ts.map