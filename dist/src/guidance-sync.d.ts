import type { GuidanceCatalog } from './guidance-catalog.js';
type Action = 'create' | 'update_default' | 'unchanged' | 'preserve' | 'source_conflict' | 'collision';
interface Change {
    id: string;
    path: string;
    action: Action;
    revision: string;
    sourceRevision: string;
}
/** Explicit host operation, never an agent endpoint or a periodic full scan. */
export declare class GuidanceSync {
    private readonly catalog;
    private readonly fs;
    private readonly fm;
    constructor(vaultPath: string, catalog: GuidanceCatalog);
    preview(): Promise<{
        fingerprint: string;
        changes: Change[];
    }>;
    apply(fingerprint: string): Promise<{
        id: string;
        action: Action;
        revision?: string;
    }[]>;
}
export {};
//# sourceMappingURL=guidance-sync.d.ts.map