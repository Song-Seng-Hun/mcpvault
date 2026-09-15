import { type ImpactAxis } from './skill-descriptor.js';
import type { SkillUsageTelemetry } from './skill-usage.js';
export declare const SKILL_METADATA_SECTIONS: readonly ['summary', 'description', 'impact', 'connections', 'usage'];
export type SkillMetadataSection = typeof SKILL_METADATA_SECTIONS[number];
export declare function skillMetadataSection(value: unknown): SkillMetadataSection;
export declare function skillMetadataAxis(value: unknown): ImpactAxis | undefined;
export type SkillPassportBasis = {
    source: {
        path: string;
        revision: string;
    };
    path: string;
    revision: string;
    sourceGuards: Array<{
        path: string;
        revision: string;
    }>;
    declaration?: unknown;
    status: string;
};
/** Read-only projection. Host assessment/approval and caller declarations stay distinct. */
export declare function skillPassport(id: string, b: SkillPassportBasis, section: SkillMetadataSection, usage: ReturnType<SkillUsageTelemetry['snapshot']> | null, maxChars?: number, axis?: ImpactAxis): {
    skillId: string;
    view: string;
    section: "connections" | "description" | "impact" | "summary" | "usage";
    axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
    basis: {
        source: {
            path: string;
            revision: string;
        };
        selected: {
            path: string;
            revision: string;
        };
        bundleRevision: string;
    };
    declarationTrust: string;
    hostApproval: string;
    sourceDeclarationDrift: boolean;
    partial: boolean;
    notice: string;
} | {
    skillId: string;
    view: string;
    section: "connections" | "description" | "impact" | "summary" | "usage";
    axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
    basis: {
        source: {
            path: string;
            revision: string;
        };
        selected: {
            path: string;
            revision: string;
        };
        bundleRevision: string;
    };
    declarationTrust: string;
    hostApproval: string;
    sourceDeclarationDrift: boolean;
    notice: string;
    partial: boolean;
    omitted: string[];
    requiredReads: {
        endpointId: string;
        arguments: {
            skillId: string;
            view: string;
            section: "connections" | "description" | "impact" | "summary" | "usage";
            axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
            maxChars: number;
            expectedRevision: string;
            expectedSourceRevision: string;
            expectedBundleRevision: string;
        };
    }[];
    nextAction: {
        endpointId: string;
        arguments: {
            skillId: string;
            view: string;
            section: "connections" | "description" | "impact" | "summary" | "usage";
            axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
            maxChars: number;
            expectedRevision: string;
            expectedSourceRevision: string;
            expectedBundleRevision: string;
        };
    };
} | {
    skillId: string;
    view: string;
    section: "connections" | "description" | "impact" | "summary" | "usage";
    partial: boolean;
    omitted: string[];
    nextAction: {
        endpointId: string;
        arguments: {
            skillId: string;
            view: string;
            section: "connections" | "description" | "impact" | "summary" | "usage";
            axis?: "accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system";
            maxChars: number;
            expectedRevision: string;
            expectedSourceRevision: string;
            expectedBundleRevision: string;
        };
    };
};
//# sourceMappingURL=skill-passport.d.ts.map