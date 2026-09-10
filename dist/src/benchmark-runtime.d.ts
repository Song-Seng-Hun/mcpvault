import type { LoadedBenchmarkHostConfig } from './benchmark-host.js';
export interface BenchmarkWriter {
    close(): Promise<void>;
    assertHeld(): Promise<void>;
}
/** One local host writer per canonical Vault. Runtime and offline host CLI must
 * acquire the same configured host-directory lease before any benchmark write.
 * A leftover marker is a recovery condition, never an invitation to steal it. */
export declare function acquireBenchmarkWriter(config: LoadedBenchmarkHostConfig): Promise<BenchmarkWriter>;
//# sourceMappingURL=benchmark-runtime.d.ts.map