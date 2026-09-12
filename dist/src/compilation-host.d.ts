import { type HostWorkStorage } from './host-work-storage.js';
import { type CompilationConfig } from './compilation-policy.js';
export type CompilationHost = HostWorkStorage<CompilationConfig>;
export declare const MAX_COMPILATION_STATE_BYTES: number;
/** Separate grant, receipt namespace and lease. No maintenance permission is reused. */
export declare const loadCompilationHostConfig: (path: string, vaultPath: string) => Promise<CompilationHost>;
//# sourceMappingURL=compilation-host.d.ts.map