import { loadHostWorkStorage } from './host-work-storage.js';
import { validateCodexHookConfig } from './codex-hook-policy.js';
/** Host code only. Neither compilation nor maintenance grants enable hooks. */
export const loadCodexHookHostConfig = (path, vaultPath) => loadHostWorkStorage(path, vaultPath, { namespace: 'codex-hooks', maxStateBytes: 1024 * 1024, validate: validateCodexHookConfig });
