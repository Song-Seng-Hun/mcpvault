const denied = () => new Error('Owner activity consent or trusted execution authority is unavailable');
const changed = () => new Error('Owner activity authority changed; retry with current consent');
/** Additional consent boundary for optional activities. This runtime accepts
 * authority only through trusted host construction options. Request fields,
 * principal labels, feature selection and document ACLs cannot create it. */
export class OwnerActivityRuntime {
    options;
    constructor(options) {
        this.options = options;
    }
    async begin(activity, action, paths, principal) {
        const options = this.options;
        if (!options)
            throw denied();
        await options.refresh?.();
        const execution = options.execution(principal);
        if (!execution)
            throw denied();
        const policy = options.policy();
        const decision = policy.decision({ ...execution, activity, action, ...(paths !== undefined && { paths }), now: Date.now() });
        if (!decision.allowed || !decision.grantId)
            throw denied();
        const grantId = decision.grantId;
        const fingerprint = policy.fingerprint;
        const initialPaths = paths === undefined ? undefined : Object.freeze([...paths]);
        const currentPolicyFor = (candidatePaths) => {
            const currentExecution = options.execution(principal);
            if (!currentExecution || currentExecution.accountId !== execution.accountId
                || currentExecution.executionTarget !== execution.executionTarget)
                return undefined;
            const currentPolicy = options.policy();
            if (currentPolicy.fingerprint !== fingerprint)
                return undefined;
            const current = currentPolicy.decision({ ...execution, activity, action,
                ...(candidatePaths !== undefined && { paths: candidatePaths }), now: Date.now() });
            return current.allowed && current.grantId === grantId ? currentPolicy : undefined;
        };
        const decide = (candidatePaths) => currentPolicyFor(candidatePaths) !== undefined;
        const assertFresh = () => { if (!decide(initialPaths))
            throw changed(); };
        const revalidate = async () => { await options.refresh?.(); assertFresh(); };
        return Object.freeze({
            grantId,
            canAccessPath: (path) => decide([path]),
            canTraversePath: (path) => currentPolicyFor(initialPaths)?.canTraverse(grantId, path) === true,
            assertFresh,
            revalidate,
            beforeWrite: async (path) => {
                await options.refresh?.();
                assertFresh();
                if (!decide([path]))
                    throw changed();
            },
        });
    }
}
