import { hash, id } from './policy.js';
import { currentHarness } from './harness.js';
/** No timer schedules new work. This bounds one explicitly supplied existing-session opportunity. */
export class EvolutionOpportunity {
    budget;
    busy = false;
    constructor(budget) {
        this.budget = budget;
    }
    async run(request, session, accountId) {
        if (request.planMode || !request.newEvidence || !session)
            return { status: 'diagnostic_only' };
        id(request.cycleId);
        if (this.busy)
            return { status: 'deferred' };
        if (request.signal?.aborted)
            return { status: 'interrupted', partial: true };
        this.busy = true;
        const controller = new AbortController(), signal = controller.signal;
        let interrupt;
        const stopped = new Promise(resolve => { interrupt = () => { controller.abort(); resolve({ status: 'interrupted', partial: true, cycleId: request.cycleId }); }; });
        const timer = setTimeout(interrupt, 300000);
        request.signal?.addEventListener('abort', interrupt, { once: true });
        const current = async () => { signal.throwIfAborted(); await session.authorize(signal); signal.throwIfAborted(); };
        const work = (async () => {
            let reservation, before;
            try {
                await current();
                let progress = await session.current(request.cycleId, signal);
                await current();
                if (['applying', 'reverting', 'applied', 'effect_verified', 'withdrawn', 'invalid'].includes(progress.status))
                    return progress;
                if (['unverified_or_insufficient_signal', 'owner_adapter_unavailable', 'evaluator_unavailable', 'evaluation_interrupted'].includes(String(progress.reason)))
                    return progress;
                if (!Number.isInteger(progress.attempts) || progress.attempts < 0 || progress.attempts > 2)
                    return { status: 'review_required' };
                const candidateLimit = progress.repairLimit === 0 ? 1 : 2;
                if (progress.attempts >= candidateLimit)
                    return { ...progress, reason: 'repair_budget_exhausted' };
                if (!request.explicit) {
                    if (!this.budget || !accountId || !session.metering || !Number.isSafeInteger(session.metering.maximumTokens)
                        || session.metering.maximumTokens < 1)
                        return { status: 'diagnostic_only', reason: 'automatic_usage_unavailable' };
                    before = await session.metering.totalTokens();
                    await current();
                    if (!Number.isSafeInteger(before) || before < 0)
                        return { status: 'diagnostic_only', reason: 'automatic_usage_unavailable' };
                    const reservationId = hash(['opportunity', request.cycleId, progress.revision, progress.attempts]);
                    await this.budget.reserve(accountId, reservationId, session.metering.maximumTokens);
                    reservation = reservationId;
                }
                for (let attempt = progress.attempts; attempt < candidateLimit; attempt++) {
                    const generated = await session.generate(Object.freeze(structuredClone(progress)), signal);
                    await current();
                    progress = await session.evaluate(request.cycleId, progress, generated.candidate, signal);
                    await current();
                    if (progress.status === 'evaluated')
                        return await session.apply(request.cycleId, progress, signal);
                    if (progress.status !== 'review_required')
                        return progress;
                }
                return progress;
            }
            catch {
                return { status: signal.aborted ? 'interrupted' : 'review_required', partial: true, cycleId: request.cycleId };
            }
            finally {
                try {
                    if (reservation) {
                        let used;
                        try {
                            const after = await session.metering.totalTokens();
                            if (Number.isSafeInteger(after) && after >= before)
                                used = after - before;
                        }
                        catch { /* unknown is charged/frozen, not zero */ }
                        await this.budget.settle(accountId, reservation, used);
                    }
                }
                finally {
                    this.busy = false;
                    clearTimeout(timer);
                    request.signal?.removeEventListener('abort', interrupt);
                }
            }
        })();
        // A non-cooperative generator cannot write through the bridge after cancellation.
        // Its occupied slot remains busy until it settles; no second background task starts.
        return Promise.race([work, stopped]);
    }
}
export function evolutionSessionBridge(service, principal, host) {
    const assert = (signal) => async () => { signal.throwIfAborted(); await host.authorize(signal); signal.throwIfAborted(); };
    const call = (args, signal) => service.execute('cycle', args, principal, assert(signal), { automatic: true });
    return { ...host, current: async (cycleId, signal) => ({ ...await call({ op: 'read', cycleId }, signal), repairLimit: currentHarness(principal)?.profile.repairLimit ?? 1 }),
        evaluate: async (cycleId, progress, candidate, signal) => {
            if (progress.attempts && currentHarness(principal)?.profile.repairLimit === 0)
                return { ...progress, status: 'review_required', reason: 'repair_budget_exhausted' };
            const next = await call({ op: 'advance', cycleId, candidate, expectedRevision: progress.revision, requestId: hash(['generate', cycleId, progress.attempts]) }, signal);
            return call({ op: 'check', cycleId, expectedRevision: next.revision, requestId: hash(['evaluate', cycleId, next.attempts]) }, signal);
        },
        apply: async (cycleId, progress, signal) => {
            const preview = await call({ op: 'preview', cycleId }, signal);
            if (!preview.fingerprint)
                return preview;
            return call({ op: 'apply', cycleId, expectedRevision: progress.revision, fingerprint: preview.fingerprint, requestId: hash(['apply', cycleId]) }, signal);
        } };
}
