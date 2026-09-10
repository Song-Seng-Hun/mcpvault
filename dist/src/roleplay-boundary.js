import { guidanceError } from './guidance-runtime.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const projectionWrites = new AsyncLocalStorage();
export function isRoleplaySheetPath(path) {
    return /^Community\/Roleplay\/Sheets\/(?:[a-z0-9][a-z0-9-]{0,63}|_(?:con|prn|aux|nul|com[1-9]|lpt[1-9]))\.(md|canvas|base)$/.test(path);
}
/** Internal exact-path grant for generated sheets only; never a generic mutation permission. */
export async function withRoleplayProjectionWrite(path, operation) {
    if (!isRoleplaySheetPath(path))
        throw guidanceError(new Error('Invalid managed roleplay projection path'), 'guid-7617c2ed1c40a3d9');
    const grant = { path: path.toLowerCase(), active: true };
    return projectionWrites.run(grant, async () => { try {
        return await operation();
    }
    finally {
        grant.active = false;
    } });
}
/** Canonical roleplay records are append-only through the world store, not generic file mutations. */
export function assertRoleplayMutationBoundary(path) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    const grant = projectionWrites.getStore();
    if (grant?.active && grant.path === normalized)
        return;
    const root = 'community/roleplay';
    if (normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`))
        throw guidanceError(new Error('Committed roleplay records cannot be edited, moved or deleted; use a previewed roleplay.correct turn'), 'guid-9e94c3c375b2b78e');
}
