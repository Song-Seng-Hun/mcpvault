import { hash, object, unavailable } from './policy.js';
/** Existing witnessed-source/controller/GM validation owns every fiction change. No real-world feedback becomes an event. */
export function fictionEvolutionAdapter(service) {
    const params = (cycle) => {
        const p = object(cycle.candidate, ['generation', 'roomId', 'changes', 'sources', 'reason']);
        if (cycle.target.kind !== 'fiction' || cycle.scope.kind !== 'scene' || cycle.scope.id !== p.roomId || cycle.target.path !== undefined
            || !Array.isArray(p.changes) || p.changes.length !== 1 || !['belief', 'attitude'].includes(p.changes[0]?.kind)
            || p.changes[0].target !== cycle.target.id)
            return unavailable();
        return { ...p, characterId: cycle.target.id, expectedRevision: cycle.baseline.revision,
            requestId: `evo-${hash([cycle.id, cycle.candidate]).slice(0, 40)}`, maxChars: 12000 };
    };
    return {
        read: async (target, principal, feedback) => {
            if (target.kind !== 'fiction' || !feedback || feedback.scope.kind !== 'scene')
                return unavailable();
            const result = await service.execute('context', { characterId: target.id, roomId: feedback.scope.id, maxChars: 12000 }, principal);
            if (!result.revision || result.partial)
                return unavailable();
            return { revision: result.revision, value: result };
        },
        preview: async (cycle, principal, current) => {
            const result = await service.previewEvolution(params(cycle), principal);
            await current();
            if (result.automatic !== true || result.revision !== cycle.baseline.revision)
                return unavailable();
            return { expectedRevision: result.revision, fingerprint: result.fingerprint, data: { proposalId: result.proposalId, outputRevision: result.outputRevision } };
        },
        apply: async (cycle, principal, current) => {
            const p = params(cycle), preview = await service.previewEvolution(p, principal);
            await current();
            if (preview.automatic !== true || preview.fingerprint !== cycle.intent?.fingerprint)
                return unavailable();
            const result = await service.execute('evolution', { ...p, op: 'propose' }, principal);
            await current();
            if (result.revision !== cycle.intent?.data?.outputRevision)
                return unavailable();
            return { revision: result.revision };
        },
        reconcile: async (cycle, principal, current) => {
            const expected = cycle.intent?.data;
            if (!expected)
                return { state: 'unknown' };
            const result = await service.execute('evolution', { op: 'read', proposalId: expected.proposalId, maxChars: 12000 }, principal);
            await current();
            const proposal = result.items?.find((x) => x.kind === 'proposal' && x.id === expected.proposalId);
            const changes = result.items?.filter((x) => x.kind === 'change');
            if (result.partial || proposal?.status !== 'applied' || proposal.needsReview || !changes?.length || changes.some((x) => !x.active))
                return { state: 'unknown' };
            return { state: 'applied', revision: expected.outputRevision };
        },
    };
}
