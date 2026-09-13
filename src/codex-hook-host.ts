import { loadHostWorkStorage, type HostWorkStorage } from './host-work-storage.js';
import { validateCodexHookConfig, type CodexHookConfig } from './codex-hook-policy.js';

export type CodexHookHost = HostWorkStorage<CodexHookConfig>;
/** Host code only. Neither compilation nor maintenance grants enable hooks. */
export const loadCodexHookHostConfig = (path: string, vaultPath: string): Promise<CodexHookHost> =>
  loadHostWorkStorage(path, vaultPath, { namespace: 'codex-hooks', maxStateBytes: 1024 * 1024, validate: validateCodexHookConfig });
