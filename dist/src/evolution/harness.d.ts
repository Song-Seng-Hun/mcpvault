import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionAdapter } from './model.js';
import type { EvolutionRepository } from './repository.js';
export interface HarnessProfile {
    modelId: string;
    taskKind: string;
    route: 'auto' | 'keyword' | 'hybrid';
    optionalSkillBundles: 0 | 1;
    maxChars: number;
    expansionLimit: 0 | 1 | 2;
    repairLimit: 0 | 1;
    optionalReview: boolean;
}
export declare function validateHarness(input: unknown): HarnessProfile;
export interface HarnessBinding {
    accountId: string;
    taskId: string;
    sessionId: string;
    revision: string;
    profile: HarnessProfile;
    assertCurrent?: () => Promise<void>;
}
/** Only trusted in-process task execution calls this. Never accept a profile from MCP arguments. */
export declare function withHarness<T>(input: HarnessBinding, work: () => Promise<T>): Promise<T>;
export declare function currentHarness(p?: ScopePrincipal): Readonly<HarnessBinding> | undefined;
export declare function harnessAdapter(repo: EvolutionRepository): EvolutionAdapter;
//# sourceMappingURL=harness.d.ts.map