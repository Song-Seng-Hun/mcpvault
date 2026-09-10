import { type ExplanationSourceConfig } from './explanation-service.js';
import type { WorkExecutionProfile } from './work-staffing.js';
export interface ExplanationHostDefinition {
    version: 1;
    enabled: boolean;
    sources: ExplanationSourceConfig[];
    profiles: WorkExecutionProfile[];
}
export declare function validateExplanationHostConfig(input: unknown): ExplanationHostDefinition;
/** Configuration is trusted only from an explicitly selected owner-private host
 * file. A change invalidates the running binding rather than silently expanding it.
 * Loading and checking never initializes state, creates accounts or calls models.
 */
export declare function loadExplanationHostConfig(configPath: string, expectedVault: string): Promise<{
    enabled: boolean;
    sources: ExplanationSourceConfig[];
    executionProfiles: () => Promise<WorkExecutionProfile[]>;
}>;
//# sourceMappingURL=explanation-host.d.ts.map