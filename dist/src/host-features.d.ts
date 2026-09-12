/** Explicit v1 snapshot. Adding a future feature must not expand saved selections. */
export declare const HOST_FEATURE_IDS_V1: readonly ["wiki-core", "document-search", "personal-memory", "work-management", "collaboration", "ideation-research", "explanation-translation", "benchmarks", "economy", "roleplay", "skill-evolution"];
export type HostFeatureId = typeof HOST_FEATURE_IDS_V1[number];
export interface HostFeatureConfig {
    readonly version: 1;
    readonly selected: readonly HostFeatureId[];
}
export declare const DEFAULT_HOST_FEATURE_CONFIG: HostFeatureConfig;
/** Strict data-only object parsing. No coercion, getters, execution or defaults.
 * The host owns bounded JSON/file loading and chooses the default explicitly. */
export declare function parseHostFeatureConfig(input: unknown): HostFeatureConfig;
/** Config identity only, not a deployment, permission or endpoint-catalog hash. */
export declare function hostFeatureConfigFingerprint(input: unknown): string;
export declare const HOST_FEATURE_TOOL_MAP: Readonly<Record<string, HostFeatureId>>;
export declare function hostFeatureForTool(toolName: string): HostFeatureId | undefined;
export interface HostFeatureEligibility {
    readonly feature?: HostFeatureId;
    readonly eligible: boolean;
    readonly reason: 'selected' | 'disabled' | 'unmapped';
    readonly permissionsGranted: false;
}
/** Selection only: caller capabilities, document rights, read-only mode, owner
 * consent, configured services/providers and operation-level guards still apply.
 * This performs no I/O, mutation, cleanup, model call or service initialization.
 * Re-enabling a feature has no migration/deletion semantics.
 */
export declare function hostFeatureEligibility(input: unknown, toolName: string): HostFeatureEligibility;
//# sourceMappingURL=host-features.d.ts.map