interface SnapshotReadLimits {
    maxBytes: number;
    /** When present, the file is gzip and this caps decoded bytes before parsing. */
    maxDecodedBytes?: number;
}
/** Bounded optional cache IO, not a source-document reader or a global RAM cap. */
export declare function readSnapshotBytes(path: string, limits: SnapshotReadLimits): Promise<Buffer>;
export {};
//# sourceMappingURL=snapshot-read.d.ts.map