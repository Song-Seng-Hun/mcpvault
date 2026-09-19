import { loadHostWorkStorage } from '../host-work-storage.js';
import { object, unavailable } from './policy.js';
/** Storage configuration is not an execution grant. Host code must also supply authority. */
export function loadEvolutionStorage(path, vault) {
    return loadHostWorkStorage(path, vault, { namespace: 'evolution', maxStateBytes: 4096, maxRecordBytes: 256 * 1024,
        validate: value => {
            const config = object(value, ['version', 'enabled']);
            if (config.version !== 1 || typeof config.enabled !== 'boolean')
                return unavailable();
            return { version: 1, enabled: config.enabled };
        } });
}
