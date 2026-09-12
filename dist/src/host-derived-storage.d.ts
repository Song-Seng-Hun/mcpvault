import { readSnapshotBytes } from './snapshot-read.js';
import { writeGzipSnapshotHandle } from './snapshot-write.js';
/** Host-only disposable snapshots. Missing configuration means memory-only. */
export declare class HostDerivedStorage {
    readonly vaultPath: string;
    readonly cacheDir?: string | undefined;
    constructor(vaultPath: string, cacheDir?: string | undefined);
    private name;
    private namespace;
    /** A private child directory for a database backend, not a Vault path. */
    directory(name: string, create?: boolean): Promise<string>;
    /** Native database backends also read descendants; a private parent alone is insufficient. */
    verifiedTree(name: string, create?: boolean): Promise<string>;
    private assertFile;
    read(name: string, options: Parameters<typeof readSnapshotBytes>[1]): Promise<Buffer>;
    write(name: string, bytes: Buffer, maxBytes: number): Promise<void>;
    writeGzip(name: string, chunks: Iterable<string | Uint8Array>, limits: Parameters<typeof writeGzipSnapshotHandle>[2]): Promise<void>;
    private publish;
}
//# sourceMappingURL=host-derived-storage.d.ts.map