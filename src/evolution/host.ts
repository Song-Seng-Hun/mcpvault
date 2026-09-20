import { loadHostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
import { object, unavailable } from './policy.js';
import { curationGrants } from '../curation/policy.js';

export function validateEvolutionConfig(value: unknown): EvolutionConfig {
  const config = object(value, ['version', 'enabled', 'curation']);
  if (config.version !== 1 || typeof config.enabled !== 'boolean') return unavailable();
  return { version: 1, enabled: config.enabled,
    ...(config.curation === undefined ? {} : { curation: curationGrants(config.curation) }) };
}

/** Storage configuration is not an execution grant. Host code must also supply authority. */
export function loadEvolutionStorage(path: string, vault: string) {
  return loadHostWorkStorage<EvolutionConfig>(path, vault, { namespace: 'evolution', maxStateBytes: 4096, maxRecordBytes: 256 * 1024,
    validate: validateEvolutionConfig });
}
