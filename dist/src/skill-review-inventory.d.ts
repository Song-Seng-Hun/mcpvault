/** Host-side data inspection only. Run large inventories outside request workers.
 * Repeated reads detect observed drift; this is not an atomic NAS snapshot or OS lock. */
export interface SkillInventoryFile {
    path: string;
    bytes: number;
    sha256: string;
}
export interface SkillInventory {
    version: 1;
    rootId: string;
    complete: boolean;
    fingerprint: string | null;
    files: SkillInventoryFile[];
    reasons: string[];
    executionAuthorized: false;
}
export interface SkillInventoryLimits {
    maxFiles: number;
    maxTotalBytes: number;
    maxDepth: number;
    maxDirectories: number;
    timeoutMs: number;
}
export declare function snapshotSkillBundle(rootInput: string, input?: Partial<SkillInventoryLimits>): Promise<SkillInventory>;
export declare function compareSkillInventories(before: SkillInventory, after: SkillInventory): {
    state: 'unchanged' | 'changed' | 'unverified';
    added: string[];
    removed: string[];
    changed: string[];
};
export declare function listSkillReviewTargets(rootInput: string): Promise<{
    complete: boolean;
    fingerprint: string | null;
    targets: Array<{
        name: string;
        targetId: string;
        canonicalSkillId: string | null;
        requiresReview: boolean;
    }>;
    reasons: string[];
}>;
//# sourceMappingURL=skill-review-inventory.d.ts.map