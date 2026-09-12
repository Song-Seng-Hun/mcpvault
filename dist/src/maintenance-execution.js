import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
/** A fresh host execution, never an inherited model/session's authority.
 * Protected derivatives require the dedicated classification workflow and stay
 * manual in this release; maintenance must not silently declassify them. */
export function maintenanceExecution(auth, access, moderation, refreshPolicy) {
    const authorize = async (accountId) => {
        await refreshPolicy();
        const actor = (await auth.listPrincipals({ fresh: true })).find(row => row.accountId === accountId);
        return actor && auth.hasCapability(actor, 'write')
            && !await moderation.isBanned(actor.accountId, actor.userId, { fresh: true }) ? actor : undefined;
    };
    const runAs = async (principal, operation) => {
        const expected = JSON.stringify(principal);
        const recheck = async () => {
            if (JSON.stringify(await authorize(principal.accountId)) !== expected)
                throw new Error('Maintenance execution authority changed');
        };
        await recheck();
        const assertFresh = access.captureDocumentBoundary(principal);
        return withEnterpriseStorageContext({ access, principal, assertFresh,
            observe: () => { throw new Error('Protected maintenance sources require manual classified repair'); },
            beforeWrite: async () => { await recheck(); assertFresh(); },
        }, operation);
    };
    return { authorize, runAs };
}
