import { hash, object, id, unavailable } from './policy.js';
/** Exact currently reviewed procedure read, never legacy resolve's original fallback. */
export function reviewedDeliveryReader(service, credentials) {
    return async (skillId, principal) => {
        let content = '', offset = 0, releaseRevision;
        for (let page = 0; page < 16; page++) {
            const result = await service.resolve({ ...await credentials(principal), principal, skillId, offset, maxChars: 12000,
                ...(releaseRevision && { expectedRelease: releaseRevision }) });
            if (result.executionAuthorized !== false || typeof result.content !== 'string' || result.offset !== offset)
                return unavailable();
            releaseRevision = result.releaseRevision;
            content += result.content;
            if (content.length > 32768)
                return unavailable();
            if (!result.partial)
                return { releaseRevision: releaseRevision, contentHash: hash(content) };
            const next = result.nextAction?.arguments?.offset;
            if (!Number.isSafeInteger(next) || next <= offset)
                return unavailable();
            offset = next;
        }
        return unavailable();
    };
}
export function skillEvolutionAdapter(service, credentials, delivery) {
    const auth = async (principal) => ({ ...await credentials(principal), principal, maxChars: 12000 });
    const candidate = (cycle) => {
        if (cycle.target.kind !== 'skill' || cycle.target.path !== undefined)
            return unavailable();
        const p = object(cycle.candidate, ['candidateId', 'evaluationId', 'candidateRevision']);
        id(p.candidateId);
        id(p.evaluationId);
        return p;
    };
    const reconcile = async (cycle, principal, current) => {
        const prepared = cycle.intent?.data?.delivery;
        if (!prepared)
            return { state: 'unknown' };
        const active = await service.resolve({ ...await auth(principal), skillId: cycle.target.id });
        const actual = await delivery.read(cycle.target.id, principal);
        await current();
        if (active.status !== 'active' || active.partial || typeof active.content !== 'string'
            || hash(active.content) !== prepared.contentHash || actual.contentHash !== prepared.contentHash
            || actual.releaseRevision !== prepared.releaseRevision)
            return { state: 'unknown' };
        return { state: 'applied', revision: actual.releaseRevision };
    };
    return {
        read: async (target, principal) => {
            if (target.kind !== 'skill' || target.path !== undefined)
                return unavailable();
            const actual = await delivery.read(target.id, principal);
            const native = await service.resolve({ ...await auth(principal), skillId: target.id });
            if (native.partial || !['active', 'original'].includes(native.status))
                return unavailable();
            return { revision: actual.releaseRevision, value: { ...actual, currentRevision: native.currentRevision, versionRevision: native.revision } };
        },
        preview: async (cycle, principal, current) => {
            const p = candidate(cycle), basis = cycle.baseline.value, a = await auth(principal);
            const actual = await delivery.read(cycle.target.id, principal);
            if (actual.releaseRevision !== cycle.baseline.revision || actual.contentHash !== basis.contentHash)
                return unavailable();
            const data = await service.candidate({ ...a, op: 'read', skillId: cycle.target.id, candidateId: p.candidateId });
            if (data.revision !== p.candidateRevision || data.partial || typeof data.content !== 'string')
                return unavailable();
            const promote = await service.promote({ ...a, op: 'preview', mode: 'auto', skillId: cycle.target.id,
                candidateId: p.candidateId, evaluationId: p.evaluationId, expectedRevision: basis.currentRevision });
            const prepared = await delivery.prepare(cycle, hash(data.content), principal);
            await current();
            if (prepared.contentHash !== hash(data.content) || !prepared.bindingHash || !prepared.releaseRevision || promote.partial)
                return unavailable();
            return { expectedRevision: cycle.baseline.revision, fingerprint: hash([promote.fingerprint, prepared, p.candidateRevision]),
                data: { delivery: prepared, promoteFingerprint: promote.fingerprint, candidateRevision: p.candidateRevision } };
        },
        apply: async (cycle, principal, current) => {
            const p = candidate(cycle), intent = cycle.intent?.data;
            if (!intent?.delivery || intent.candidateRevision !== p.candidateRevision)
                return unavailable();
            const a = await auth(principal);
            await current();
            await service.promote({ ...a, op: 'apply', mode: 'auto', skillId: cycle.target.id, candidateId: p.candidateId, evaluationId: p.evaluationId,
                expectedRevision: cycle.baseline.value.currentRevision, fingerprint: intent.promoteFingerprint,
                requestId: `evo-${hash([cycle.id, cycle.candidate]).slice(0, 40)}` });
            await current();
            await delivery.apply(intent.delivery, cycle, principal);
            await current();
            const result = await reconcile(cycle, principal, current);
            if (result.state !== 'applied' || !result.revision)
                return unavailable();
            return { revision: result.revision };
        },
        reconcile,
    };
}
