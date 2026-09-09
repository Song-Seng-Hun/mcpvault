import { type SkillEvaluationProfile } from './skill-evaluation.js';
import type { SkillEvolutionHost } from './skill-evolution.js';
/** Fail closed before reading secrets; no paths, ACL details or key contents are logged. */
export declare function assertHostPrivateStorage(paths: readonly string[]): Promise<void>;
/** Host-only loader. JSON selects registered profiles; it cannot load scripts or inline keys. */
export declare function loadSkillEvolutionHostConfig(configPath: string, expectedVault: string, registeredProfiles?: readonly SkillEvaluationProfile[]): Promise<SkillEvolutionHost>;
//# sourceMappingURL=skill-evolution-host.d.ts.map