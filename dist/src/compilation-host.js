import { loadHostWorkStorage } from './host-work-storage.js';
import { validateCompilationConfig } from './compilation-policy.js';
export const MAX_COMPILATION_STATE_BYTES = 4 * 1024 * 1024;
/** Separate grant, receipt namespace and lease. No maintenance permission is reused. */
export const loadCompilationHostConfig = (path, vaultPath) => loadHostWorkStorage(path, vaultPath, { namespace: 'compilation', maxStateBytes: MAX_COMPILATION_STATE_BYTES, validate: validateCompilationConfig });
