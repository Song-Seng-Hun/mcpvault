import { guidanceError } from './guidance-runtime.js';
import { PathFilter } from './pathfilter.js';
import { loadHostWorkStorage } from './host-work-storage.js';
export const MAINTENANCE_OPERATIONS = ['cache_refresh', 'managed_canvas_regenerate', 'moved_link_repair'];
export const MAX_MAINTENANCE_STATE_BYTES = 4 * 1024 * 1024;
/** Exact logical paths only. No inherited folder, wildcard or model authority. */
export function validateMaintenanceConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw guidanceError(new Error('Invalid maintenance configuration'), 'guid-251437f8566e14de');
    const raw = value;
    const keys = ['version', 'enabled', 'accountId', 'paths', 'operations'];
    if (Object.keys(raw).some(key => !keys.includes(key)) || raw.version !== 1 || typeof raw.enabled !== 'boolean'
        || typeof raw.accountId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(raw.accountId))
        throw guidanceError(new Error('Maintenance requires an explicit current account and supported configuration fields'), 'guid-2bae7479cf5d6ee9');
    const filter = new PathFilter();
    if (!Array.isArray(raw.paths) || raw.paths.length < 1 || raw.paths.length > 128)
        throw guidanceError(new Error('Maintenance requires 1..128 exact paths'), 'guid-bf2acd4324b33ed2');
    const paths = raw.paths.map(path => {
        if (typeof path !== 'string' || !path || path.length > 400 || /[\\:*?"<>|\x00-\x1f]/.test(path)
            || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
                || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || !filter.isAllowed(path))
            throw guidanceError(new Error('Maintenance path must be exact, canonical and permitted'), 'guid-9262cdabc9a8e342');
        return path;
    });
    if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length)
        throw guidanceError(new Error('Maintenance paths must be unique'), 'guid-590d4403bb617173');
    if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 3
        || raw.operations.some(op => !MAINTENANCE_OPERATIONS.includes(op))
        || new Set(raw.operations).size !== raw.operations.length)
        throw guidanceError(new Error('Maintenance operations must be an explicit fixed allow list'), 'guid-de707e20c2848a76');
    return { version: 1, enabled: raw.enabled, accountId: raw.accountId, paths, operations: [...raw.operations] };
}
/** Host-only durable receipts/backups; never use a Vault/repository fallback. */
export async function loadMaintenanceHostConfig(path, expectedVault) {
    const storage = await loadHostWorkStorage(path, expectedVault, {
        namespace: 'maintenance', maxStateBytes: MAX_MAINTENANCE_STATE_BYTES,
        validate: validateMaintenanceConfig,
    });
    return storage;
}
