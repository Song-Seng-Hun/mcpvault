import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export function withEnterpriseStorageContext(value, operation) {
    return context.run(value, operation);
}
export function assertEnterpriseStorageFresh() {
    const current = context.getStore();
    if (current?.access.getEnterpriseProfile())
        current.assertFresh();
}
export function canReadEnterpriseStoragePath(path) {
    const current = context.getStore();
    if (!current?.access.getEnterpriseProfile())
        return true;
    current.assertFresh();
    return current.access.canAccessPhysicalPath(path, current.principal);
}
/** A second boundary at physical IO protects service-internal reads and writes. */
export function assertEnterpriseStorageAccess(path, write = false) {
    const current = context.getStore();
    if (!current?.access.getEnterpriseProfile())
        return;
    current.assertFresh();
    if (!current.access.canAccessPhysicalPath(path, current.principal))
        throw new Error('Access denied: enterprise resource unavailable');
    if (write && /^publiccommunity(?:\/|$)/i.test(path.replace(/\\/g, '/')) && !current.publicCommunityWriter) {
        throw new Error('Managed public community writes require a dedicated community operation');
    }
    if (write && current.access.getEnterpriseProfile().mode === 'company') {
        const p = path.replace(/\\/g, '/').toLowerCase();
        if (!p.startsWith('community/') && !p.startsWith('_scopes/') && !p.startsWith('_whispers/')) {
            throw new Error('Company agents cannot write public Global material; use the administrator export workflow');
        }
    }
}
