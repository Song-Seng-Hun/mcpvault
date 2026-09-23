import { type ReviewedSkillRegistration } from './skill-release-store.js';
import type { ReviewedSkillHost } from './skill-release-reader.js';
export declare const VAULT_SKILL_REVIEWS = ".mcpvault-reviewed-skills";
export interface VaultSkillRegistration {
    registration: ReviewedSkillRegistration;
    contentFingerprint: string;
    resources: ReadonlyArray<{
        blob: string;
        path: string;
    }>;
}
/** NAS bytes remain untrusted. A private server setting pins the registry hash;
 * neither an active frontmatter flag nor replacing NAS evidence grants approval.
 * Bodies live in Community/Skills, not in the evidence store or a local mirror. */
export declare function openVaultReviewedSkills(options: {
    vaultPath: string;
    registryHash: string;
    sourceFingerprint: (name: string) => Promise<string | null>;
}): Promise<ReviewedSkillHost>;
//# sourceMappingURL=skill-release-vault.d.ts.map