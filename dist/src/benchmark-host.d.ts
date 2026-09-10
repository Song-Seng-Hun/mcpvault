import { type BenchmarkDefinition, type BenchmarkProfile } from './benchmark-model.js';
export { acquireBenchmarkWriter, type BenchmarkWriter } from './benchmark-runtime.js';
export interface BenchmarkIntegrity {
    sign: (record: unknown) => Promise<string>;
    verify: (record: unknown, seal: string) => Promise<boolean>;
}
export interface BenchmarkHostConfig {
    version: 1;
    enabled: boolean;
    vaultPath: string;
    hostPath: string;
    operators: string[];
    definitions: BenchmarkDefinition[];
    profiles: Record<string, BenchmarkProfile>;
    integrityKeyFile: string;
    answerFile?: string;
}
export interface LoadedBenchmarkHostConfig extends BenchmarkHostConfig {
    answerReader: (definitionId: string) => Promise<string>;
    integrity: BenchmarkIntegrity;
    accountProfiles: () => Promise<Record<string, BenchmarkProfile>>;
    assertHumanOperator: (actor: string) => Promise<void>;
}
export declare function validateBenchmarkProfiles(raw: unknown): Record<string, BenchmarkProfile>;
export declare function validateBenchmarkHostConfig(raw: unknown): BenchmarkHostConfig;
/** Key is supplied by a verified host-private reader, never a note/endpoint. */
export declare function createBenchmarkIntegrity(key: Uint8Array): BenchmarkIntegrity;
/** Read-only host loader. No numerical approval, key, directory or answer is created. */
export declare function loadBenchmarkHostConfig(configPath: string, expectedVault: string): Promise<LoadedBenchmarkHostConfig>;
//# sourceMappingURL=benchmark-host.d.ts.map