import type { SkillInventory } from './skill-review-inventory.js';
export interface SkillSourceInspection {
    inventory: SkillInventory;
    visible: boolean;
}
/** One owned child at a time. No foreground scan, inherited credentials, shell,
 * remote code or automatic dependencies. A busy/timeout/invalid result is unknown.
 * Source-mode tests require a fresh npm build for the fixed compiled worker. */
export declare function createSkillSourceInspector(vaultPath: string): {
    inspect(sourceName: string, options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<SkillSourceInspection | null>;
    close(): void;
};
//# sourceMappingURL=skill-release-source.d.ts.map