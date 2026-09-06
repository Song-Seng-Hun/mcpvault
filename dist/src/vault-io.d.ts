import { type Utf8MetadataSource } from './streaming-metadata.js';
export type VaultIoPriority = 'foreground' | 'background';
export interface VaultIoCoordinatorOptions {
    minConcurrency?: number;
    maxConcurrency?: number;
    initialConcurrency?: number;
    reader?: (path: string) => Promise<string>;
    boundedReader?: (path: string, maxBytes: number) => Promise<string>;
    revisionReader?: (path: string, maxBytes?: number) => Promise<string>;
    metadataReader?: (path: string, maxBytes?: number) => Promise<Utf8MetadataSource>;
}
/**
 * Deduplicates concurrent note reads and applies adaptive backpressure to
 * derived read-model work. It intentionally retains no content after a read
 * finishes: Markdown remains authoritative and memory use stays bounded.
 */
export declare class VaultIoCoordinator {
    private readonly reader;
    private readonly boundedReader;
    private readonly revisionReader;
    private readonly metadataReader;
    private readonly minConcurrency;
    private readonly maxConcurrency;
    private targetConcurrency;
    private active;
    private readonly queue;
    private readonly inFlight;
    private latencyEmaMs;
    constructor(options?: VaultIoCoordinatorOptions);
    readUtf8(path: string, priority?: VaultIoPriority): Promise<string>;
    readUtf8Bounded(path: string, maxBytes: number, priority?: VaultIoPriority): Promise<string>;
    readUtf8Revision(path: string, maxBytes?: number, priority?: VaultIoPriority): Promise<string>;
    readUtf8Metadata(path: string, maxBytes?: number, priority?: VaultIoPriority): Promise<Utf8MetadataSource>;
    private schedule;
    status(): {
        active: number;
        queued: number;
        targetConcurrency: number;
        latencyEmaMs: number;
    };
    private pump;
    private finish;
}
//# sourceMappingURL=vault-io.d.ts.map