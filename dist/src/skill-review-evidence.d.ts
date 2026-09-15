import { type SkillDescriptor } from './skill-descriptor.js';
import type { SkillInventory } from './skill-review-inventory.js';
declare const FIELDS: readonly ['kind', 'domains', 'purpose', 'useWhen', 'avoidWhen', 'keywords', 'inputs', 'outputs', 'effects', 'connections', 'examples', 'impactClaims', 'compatibility', 'relatedSkills', 'incompatibleSkills'];
type Field = typeof FIELDS[number];
export interface SkillMetadataEvidence {
    fields: Field[];
    path: string;
    sha256: string;
    startLine: number;
    endLine: number;
    quote: string;
    interpretation: 'literal' | 'reviewer_inference';
}
/** Host-side evidence check only. A quote match proves bytes, not interpretation.
 * readSource must be a confined, bounded host reader, never an endpoint path loader. */
export declare function validateSkillMetadataEvidence(input: unknown, inventory: SkillInventory, readSource: (path: string) => Promise<Buffer>): Promise<{
    version: 1;
    state: 'evidence_valid';
    targetId: string;
    sourceFingerprint: string;
    reviewer: string;
    descriptor: SkillDescriptor;
    evidence: SkillMetadataEvidence[];
    unknowns: Partial<Record<"avoidWhen" | "compatibility" | "connections" | "domains" | "effects" | "examples" | "impactClaims" | "incompatibleSkills" | "inputs" | "keywords" | "kind" | "outputs" | "purpose" | "relatedSkills" | "useWhen", string>>;
    semanticVerification: 'not_proven_by_locator_checks';
    executionAuthorized: false;
    releaseApproved: false;
    usage: {
        resolvedCalls: null;
        verifiedApplications: null;
        observation: 'not_supplied';
    };
}>;
export {};
//# sourceMappingURL=skill-review-evidence.d.ts.map