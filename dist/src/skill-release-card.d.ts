import type { SkillReleaseManifest } from './skill-release-manifest.js';
import { type SkillDescriptor } from './skill-descriptor.js';
/** Public projection of reviewed release metadata only. Private review artifacts and
 * source declarations are never promoted to approved metadata by this adapter. */
export declare function reviewedSkillCard(manifest: SkillReleaseManifest, release: string, max: number, p: Record<string, unknown>, descriptor?: SkillDescriptor): {
    skillId: string;
    view: string;
    section: "connections" | "description" | "impact" | "summary" | "usage";
    axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
    status: string;
    releaseRevision: string;
    executionAuthorized: boolean;
    limitations: string[];
    useWhen: string[];
    avoidWhen: string[];
    notice: string;
    metadataScope: string;
    partial: boolean;
} | {
    skillId: string;
    view: string;
    section: "connections" | "description" | "impact" | "summary" | "usage";
    status: string;
    releaseRevision: string;
    executionAuthorized: boolean;
    partial: boolean;
    omitted: string[];
    nextAction: {
        endpointId: string;
        arguments: {
            skillId: string;
            view: string;
            resourceId: string;
            expectedRelease: string;
            maxChars: number;
        };
    } | {
        endpointId: string;
        arguments: {
            skillId: string;
            view: string;
            section: "connections" | "description" | "impact" | "summary" | "usage";
            axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
            expectedRelease: string;
            maxChars: number;
        };
    };
};
//# sourceMappingURL=skill-release-card.d.ts.map