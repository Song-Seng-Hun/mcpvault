import { type HostFeatureConfig } from './host-features.js';
/** Startup-only immutable selection. Editing a file never changes a running
 * service graph. Feature selection is not a document or execution grant. */
export declare function loadHostFeatureConfig(path: string | undefined, vaultPath: string): Promise<HostFeatureConfig>;
//# sourceMappingURL=host-feature-config.d.ts.map