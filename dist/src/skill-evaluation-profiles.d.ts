import { type SkillEvaluationProfile } from './skill-evaluation.js';
/**
 * Host registration inventory, not automatic activation. Pass this list to
 * loadSkillEvolutionHostConfig; the host must explicitly select profile ID
 * `local-tdd-document-contract-v1`. No candidate can register an evaluator.
 *
 * The revision also binds the imported parser implementation, which the core
 * callback-source fingerprint cannot see. Change parser behavior or policy and
 * existing evaluations require fresh revision-bound evaluation/attestation.
 */
export declare function createTrustedSkillEvaluationProfiles(): readonly SkillEvaluationProfile[];
//# sourceMappingURL=skill-evaluation-profiles.d.ts.map