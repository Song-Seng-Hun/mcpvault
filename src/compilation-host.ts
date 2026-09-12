import { loadHostWorkStorage, type HostWorkStorage } from './host-work-storage.js';
import { validateCompilationConfig, type CompilationConfig } from './compilation-policy.js';

export type CompilationHost = HostWorkStorage<CompilationConfig>;
export const MAX_COMPILATION_STATE_BYTES = 4 * 1024 * 1024;
/** Separate grant, receipt namespace and lease. No maintenance permission is reused. */
export const loadCompilationHostConfig = (path: string, vaultPath: string): Promise<CompilationHost> =>
  loadHostWorkStorage(path, vaultPath, { namespace: 'compilation', maxStateBytes: MAX_COMPILATION_STATE_BYTES, validate: validateCompilationConfig });
