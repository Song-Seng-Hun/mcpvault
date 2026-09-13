import { type HostWorkStorage } from './host-work-storage.js';
import { type CodexHookConfig } from './codex-hook-policy.js';
export type CodexHookHost = HostWorkStorage<CodexHookConfig>;
/** Host code only. Neither compilation nor maintenance grants enable hooks. */
export declare const loadCodexHookHostConfig: (path: string, vaultPath: string) => Promise<CodexHookHost>;
//# sourceMappingURL=codex-hook-host.d.ts.map