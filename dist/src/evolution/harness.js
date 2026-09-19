import { AsyncLocalStorage } from 'node:async_hooks';
import { hash, id, object, revision, unavailable } from './policy.js';
export function validateHarness(input) {
    const p = object(input, ['modelId', 'taskKind', 'route', 'optionalSkillBundles', 'maxChars', 'expansionLimit', 'repairLimit', 'optionalReview']);
    id(p.modelId);
    id(p.taskKind);
    if (!['auto', 'keyword', 'hybrid'].includes(p.route) || ![0, 1].includes(p.optionalSkillBundles)
        || !Number.isSafeInteger(p.maxChars) || p.maxChars < 1000 || p.maxChars > 4000 || ![0, 1, 2].includes(p.expansionLimit)
        || ![0, 1].includes(p.repairLimit) || typeof p.optionalReview !== 'boolean')
        return unavailable();
    return Object.freeze({ ...p });
}
const execution = new AsyncLocalStorage();
/** Only trusted in-process task execution calls this. Never accept a profile from MCP arguments. */
export function withHarness(input, work) {
    for (const k of ['accountId', 'taskId', 'sessionId'])
        id(input[k]);
    if (revision(input.revision) === 'missing')
        return unavailable();
    return execution.run(Object.freeze({ ...input, profile: validateHarness(input.profile) }), work);
}
export function currentHarness(p) {
    const current = execution.getStore();
    return current?.accountId === p?.accountId && current?.profile.modelId === p?.modelId ? current : undefined;
}
export function harnessAdapter(repo) {
    const key = (cycle) => hash([cycle.accountId, cycle.target, cycle.scope]);
    const validated = (cycle, principal) => {
        if (cycle.target.kind !== 'harness' || cycle.target.path !== undefined || cycle.scope.kind === 'owner')
            return unavailable();
        const p = validateHarness(cycle.candidate);
        if (p.modelId !== principal.modelId)
            return unavailable();
        return p;
    };
    return {
        read: async (target, principal, feedback) => {
            if (!feedback)
                return unavailable();
            const r = await repo.read('harness', key({ target, scope: feedback.scope, accountId: principal.accountId }));
            return { revision: r.revision, value: r.value ?? null };
        },
        preview: async (cycle, p, current) => {
            const profile = validated(cycle, p), r = await repo.read('harness', key(cycle));
            await current();
            if (r.revision !== cycle.baseline.revision || hash(r.value ?? null) !== hash(cycle.baseline.value)
                || r.value?.profile && hash(r.value.profile) === hash(profile))
                return unavailable();
            return { expectedRevision: r.revision, fingerprint: hash([key(cycle), profile, r.revision]) };
        },
        apply: async (cycle, p, current) => {
            const profile = validated(cycle, p);
            await current();
            return repo.write('harness', key(cycle), { version: 1, cycleId: cycle.id, profile }, cycle.intent.expectedRevision);
        },
        reconcile: async (cycle, _p, current) => {
            const r = await repo.read('harness', key(cycle));
            await current();
            return r.value?.cycleId === cycle.id && r.value.profile && hash(r.value.profile) === hash(cycle.candidate)
                ? { state: 'applied', revision: r.revision } : { state: 'unknown' };
        },
        revert: async (cycle, _p, current) => {
            const r = await repo.read('harness', key(cycle));
            await current();
            if (r.revision !== cycle.outputRevision || r.value?.cycleId !== cycle.id)
                return unavailable();
            return repo.write('harness', key(cycle), cycle.baseline.value ?? { version: 1, cycleId: cycle.id, withdrawnCycleId: cycle.id }, r.revision);
        },
        reconcileRevert: async (cycle, _p, current) => {
            const r = await repo.read('harness', key(cycle));
            await current();
            return hash(r.value) === hash(cycle.baseline.value) || !cycle.baseline.value && r.value?.withdrawnCycleId === cycle.id
                ? { state: 'withdrawn', revision: r.revision } : { state: 'unknown' };
        },
    };
}
