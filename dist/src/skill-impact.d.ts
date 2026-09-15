import { type ImpactLevel, type SkillDescriptor } from './skill-descriptor.js';
/** Declarative worst-case consequences, not a likelihood estimate or a safety certificate. */
export declare function skillPotentialImpact(descriptor?: SkillDescriptor): {
    version: number;
    meaning: string;
    coverage: string;
    maliciousness: string;
    residualRisk: string;
    permissionGranted: boolean;
    limit: string;
    axes: Record<"accounts" | "assets" | "data" | "domain" | "legal" | "policy" | "system", {
        level: ImpactLevel;
        scenarios: string[];
        assumptions: string[];
        basis: string[];
    }>;
};
//# sourceMappingURL=skill-impact.d.ts.map