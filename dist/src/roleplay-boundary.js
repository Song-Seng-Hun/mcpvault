/** Canonical roleplay records are append-only through the world store, not generic file mutations. */
export function assertRoleplayMutationBoundary(path) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    const root = 'community/roleplay';
    if (normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`))
        throw new Error('Committed roleplay records cannot be edited, moved or deleted; use a previewed roleplay.correct turn');
}
