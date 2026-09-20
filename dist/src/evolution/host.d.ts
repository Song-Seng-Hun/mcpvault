import type { EvolutionConfig } from './model.js';
export declare function validateEvolutionConfig(value: unknown): EvolutionConfig;
/** Storage configuration is not an execution grant. Host code must also supply authority. */
export declare function loadEvolutionStorage(path: string, vault: string): Promise<import("../host-work-storage.js").HostWorkStorage<EvolutionConfig>>;
//# sourceMappingURL=host.d.ts.map