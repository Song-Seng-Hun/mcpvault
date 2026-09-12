import { type FileHandle } from 'node:fs/promises';
interface SnapshotWriteLimits {
    maxBytes: number;
    maxDecodedBytes: number;
}
/** Write to a caller-owned, already private exclusive handle. The owner is
 * responsible for closing, publication and identity-checked cleanup. */
export declare function writeGzipSnapshotHandle(handle: FileHandle, chunks: Iterable<string | Uint8Array>, limits: SnapshotWriteLimits): Promise<void>;
/** Internal disposable cache paths only. Does not authorize source-document IO. */
export declare function writeGzipSnapshot(path: string, chunks: Iterable<string | Uint8Array>, limits: SnapshotWriteLimits): Promise<void>;
export {};
//# sourceMappingURL=snapshot-write.d.ts.map