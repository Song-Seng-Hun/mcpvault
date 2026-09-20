import type { FileSystemService } from '../filesystem.js';
import type { VaultCatalogChange, VaultFileCatalog } from '../vault-catalog.js';
export interface ReferenceImpactCapture {
    targetRevision: string;
    candidates: Array<{
        path: string;
        revision: string;
    }>;
    assertCurrent(): Promise<void>;
    assertObserved(): void;
}
/** Private background integrity index, not the public search graph. A complete
 * scan covers every reference-bearing file in the filesystem's host boundary,
 * including fiction/drafts/checkpoints. Any unreadable scope stops coverage.
 * Watcher generations fence known changes; this is not an atomic NAS snapshot. */
export declare class ReferenceImpactIndex {
    private fs;
    private readonly catalog?;
    private readonly canIndex;
    private readonly owner;
    private readonly storage;
    private store?;
    private state;
    private revision;
    private full;
    private pending;
    private draining;
    private reconciling;
    private tail;
    private unsubscribes;
    constructor(fs: FileSystemService, cacheDir: string, catalog?: VaultFileCatalog | undefined, canIndex?: (path: string) => boolean);
    start(): Promise<void>;
    status(): "closed" | "cold" | "preparing" | "ready" | "unavailable";
    invalidate(changes?: readonly VaultCatalogChange[]): Promise<void>;
    private closed;
    private refresh;
    private rebuild;
    capture(path: string, canAccess: (path: string) => boolean): Promise<ReferenceImpactCapture>;
    close(): Promise<void>;
}
//# sourceMappingURL=reference-index.d.ts.map