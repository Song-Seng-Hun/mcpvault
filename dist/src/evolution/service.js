import { compareEvaluation, hash, id, normalizeFeedback, object, repetitionReady, revision, selectPreferences, style, unavailable } from './policy.js';
import { EvolutionRepository } from './repository.js';
import { harnessAdapter, validateHarness } from './harness.js';
const feedbackOps = ['record', 'read', 'withdraw'];
const cycleOps = ['diagnose', 'prepare', 'read', 'list', 'advance', 'check', 'preview', 'apply', 'reconcile', 'effect', 'revert'];
const readOps = new Set(['read', 'list', 'preview', 'diagnose']);
const notice = 'Reference data only. Preferences never grant authority or override safety. Applied is not effect verified.';
export class EvolutionService {
    options;
    tail = Promise.resolve();
    evaluatorBusy = false;
    closed = false;
    evaluationController;
    constructor(options) {
        this.options = options;
    }
    async close() { this.closed = true; this.evaluationController?.abort(); await this.tail; }
    async execute(endpoint, input, principal, assertActor = async () => { }, execution) {
        if (this.closed)
            return unavailable();
        const p = structuredClone(input);
        const op = endpoint === 'context' ? 'read' : p.op ?? (endpoint === 'cycle' ? 'diagnose' : 'read');
        if (!['feedback', 'cycle', 'context'].includes(endpoint) || endpoint !== 'context' && !(endpoint === 'feedback' ? feedbackOps : cycleOps).includes(op))
            return unavailable();
        const max = p.maxChars ?? 4000;
        if (!Number.isSafeInteger(max) || max < 1000 || max > 12000)
            return unavailable();
        if (endpoint === 'cycle' && op === 'diagnose')
            return { status: this.options.storage && this.options.authority ? 'configured' : 'diagnostic_only',
                adapterKinds: Object.keys(this.options.adapters ?? {}).concat('persona', 'harness'), effectVerified: false, notice };
        if (!principal?.accountId)
            return unavailable();
        const write = endpoint !== 'context' && !readOps.has(op);
        if (write && (this.options.readOnly || !principal.capabilities?.includes('write')))
            throw Error('Evolution write denied: read-only or capability missing');
        if (!this.options.storage?.records || !this.options.authority)
            return { status: 'diagnostic_only', reason: 'host_connection_unavailable', notice };
        const run = async () => {
            let writer;
            try {
                await assertActor();
                const lease = await this.options.authority(principal, { ...p, endpoint });
                const current = async () => { if (this.closed)
                    return unavailable(); await assertActor(); await lease.assertCurrent(); if (!(await this.options.storage.refresh()).enabled || this.closed)
                    return unavailable(); await writer?.assertHeld(); };
                await current();
                if (write)
                    writer = await this.options.storage.acquire();
                const repo = new EvolutionRepository(this.options.storage.records, lease.sharedOwner ? `owner:${lease.ownerId}` : `account:${principal.accountId}`, current, principal.accountId);
                const context = { principal, lease, repo, current, automatic: execution?.automatic === true };
                const result = endpoint === 'feedback' ? await this.feedback(op, p, context)
                    : endpoint === 'context' ? await this.context(p, context) : await this.cycle(op, p, context);
                await current();
                if (JSON.stringify(result).length <= max)
                    return result;
                return { status: result.status, partial: true, notice, nextAction: { endpointId: `evolution.${endpoint}`,
                        arguments: { ...(result.cycleId ? { op: 'read', cycleId: result.cycleId } : result.feedback?.id ? { op: 'read', feedbackId: result.feedback.id } :
                                Object.fromEntries(['project', 'computer', 'scene', 'sessionId', 'taskId', 'offset', 'expectedIndexRevision'].filter(k => p[k] !== undefined).map(k => [k, p[k]]))), maxChars: 12000 } } };
            }
            finally {
                await writer?.close();
            }
        };
        // Host/storage exceptions may contain private bytes or absolute paths.
        if (!write)
            return run().catch(() => unavailable());
        const pending = this.tail.then(run, run).catch(() => unavailable());
        this.tail = pending.catch(() => undefined);
        return pending;
    }
    async evidence(feedback, c) {
        const basis = feedback.flatMap(f => f.basis);
        if (basis.length && (!this.options.verifyEvidence || !await this.options.verifyEvidence(basis, c.principal)))
            return unavailable();
        await c.current();
    }
    visible(scope, accountId, c) {
        return scope.kind === 'owner' ? c.lease.sharedOwner && scope.id === c.lease.ownerId : accountId === c.principal.accountId;
    }
    async feedback(op, p, c) {
        const feedbackId = id(op === 'record' ? p.feedback?.id : p.feedbackId);
        const prior = await c.repo.read('feedback', feedbackId);
        if (prior.value && !this.visible(prior.value.feedback.scope, prior.value.accountId, c))
            return unavailable();
        if (op === 'read') {
            if (!prior.value)
                return unavailable();
            await this.evidence([prior.value.feedback], c);
            return { feedback: prior.value.feedback, revision: prior.revision };
        }
        const request = { id: id(p.requestId), fingerprint: hash({ op, feedback: p.feedback, eventToken: p.eventToken, feedbackId }) };
        if (op === 'record' && prior.value) {
            if (prior.value.request.fingerprint !== request.fingerprint || prior.value.request.id !== request.id)
                return unavailable();
            await this.evidence([prior.value.feedback], c);
            await c.repo.add('feedback', feedbackId, prior.value.feedback.scope.kind === 'owner');
            return { feedback: prior.value.feedback, revision: prior.revision };
        }
        if (revision(p.expectedRevision) !== prior.revision)
            throw Error('Evolution feedback revision changed');
        if (op === 'withdraw') {
            if (!prior.value)
                return unavailable();
            prior.value.feedback.withdrawn = true;
            const saved = await c.repo.write('feedback', feedbackId, prior.value, prior.revision);
            return { feedback: prior.value.feedback, revision: saved.revision };
        }
        const proof = typeof p.eventToken === 'string' && p.eventToken.length <= 500 ? await this.options.attest?.(p.eventToken, c.principal, p.feedback) : undefined;
        const f = normalizeFeedback(p.feedback, proof);
        if (f.scope.kind === 'owner' && (!c.lease.sharedOwner || f.scope.id !== c.lease.ownerId)
            || f.scope.kind === 'account' && f.scope.id !== c.principal.accountId
            || f.scope.kind === 'session' && f.scope.id !== f.sessionId)
            return unavailable();
        await this.evidence([f], c);
        if (proof) {
            if (Date.parse(f.observedAt) > (this.options.now?.() ?? Date.now()))
                return unavailable();
            const eventKey = hash([f.origin, f.eventId, f.taskId, f.sessionId]);
            const event = await c.repo.read('event', eventKey);
            const fingerprint = hash(f);
            if (event.value && (event.value.feedbackId !== feedbackId || event.value.fingerprint !== fingerprint))
                return unavailable();
            if (!event.value)
                await c.repo.write('event', eventKey, { version: 1, feedbackId, fingerprint }, event.revision);
        }
        const saved = await c.repo.write('feedback', feedbackId, { version: 1, accountId: c.principal.accountId, feedback: f, request }, prior.revision);
        await c.repo.add('feedback', feedbackId, f.scope.kind === 'owner');
        return { feedback: f, revision: saved.revision };
    }
    async sources(cycle, c, pin = true, allowWithdrawn = false) {
        const out = [];
        for (const ref of cycle.feedback) {
            const r = await c.repo.read('feedback', ref.id);
            if (!r.value || !this.visible(r.value.feedback.scope, r.value.accountId, c) || !allowWithdrawn && r.value.feedback.withdrawn || pin && r.revision !== ref.revision)
                return unavailable();
            out.push(r.value.feedback);
        }
        await this.evidence(out, c);
        return out;
    }
    persona(c) {
        const key = (cycle) => hash([cycle.scope.kind === 'owner' ? c.lease.ownerId : cycle.accountId, cycle.target, cycle.scope, cycle.candidate?.key]);
        return {
            read: async (target, _principal, feedback) => {
                if (!feedback)
                    return unavailable();
                const r = await c.repo.read('persona', hash([feedback.scope.kind === 'owner' ? c.lease.ownerId : c.principal.accountId, target, feedback.scope, feedback.key]));
                return { revision: r.revision, value: r.value?.withdrawn ? null : r.value?.preference ?? null };
            },
            preview: async (cycle) => {
                const candidate = object(cycle.candidate, ['key', 'value']);
                style(candidate.key, candidate.value);
                const feedback = await this.sources(cycle, c);
                if (!feedback.every(f => f.key === candidate.key && f.value === candidate.value))
                    return unavailable();
                const prior = await c.repo.read('persona', key(cycle));
                // A conflicting preference must be withdrawn explicitly, never latest-wins.
                if (prior.revision !== cycle.baseline.revision)
                    return unavailable();
                // Existing active value is either a no-op or a conflict, never a reason to rewrite.
                if (prior.value && !prior.value.withdrawn)
                    return unavailable();
                return { expectedRevision: prior.revision, fingerprint: hash([cycle.id, cycle.candidate, prior.revision]) };
            },
            apply: async (cycle) => {
                const prior = await c.repo.read('persona', key(cycle));
                if (prior.revision !== cycle.intent?.expectedRevision)
                    return unavailable();
                return c.repo.write('persona', key(cycle), { version: 1, cycleId: cycle.id,
                    preference: { ...cycle.candidate, scope: cycle.scope, cycleId: cycle.id } }, prior.revision);
            },
            reconcile: async (cycle) => {
                const r = await c.repo.read('persona', key(cycle));
                return r.value?.cycleId === cycle.id ? { state: 'applied', revision: r.revision } : { state: 'unknown' };
            },
            revert: async (cycle) => {
                const r = await c.repo.read('persona', key(cycle));
                if (r.revision !== cycle.outputRevision || r.value?.cycleId !== cycle.id)
                    return unavailable();
                return c.repo.write('persona', key(cycle), { version: 1, withdrawn: true, withdrawnCycleId: cycle.id }, r.revision);
            },
            reconcileRevert: async (cycle) => {
                const r = await c.repo.read('persona', key(cycle));
                return r.value?.withdrawn && r.value.withdrawnCycleId === cycle.id ? { state: 'withdrawn', revision: r.revision } : { state: 'unknown' };
            },
        };
    }
    adapter(cycle, c) {
        return cycle.target.kind === 'persona' ? this.persona(c)
            : cycle.target.kind === 'harness' ? harnessAdapter(c.repo) : this.options.adapters?.[cycle.target.kind];
    }
    view(cycle, rev) {
        const e = cycle.evaluation;
        return { cycleId: cycle.id, revision: rev, status: cycle.state, target: cycle.target, scope: cycle.scope, attempts: cycle.attempts,
            ...(cycle.reason && { reason: cycle.reason }), ...(cycle.outputRevision && { outputRevision: cycle.outputRevision }),
            evaluation: e ? { method: e.method ?? 'unreported', profileRevision: e.profileRevision, receiptHash: e.receiptHash,
                measurementScope: e.measurementScope ?? 'unreported', adoption: e.adoption ?? 'evaluated',
                samples: e.cases.length, baselinePassed: e.cases.filter(x => x.baseline).length, candidatePassed: e.cases.filter(x => x.candidate).length,
                baselineTokens: e.baselineTokens ?? null, candidateTokens: e.candidateTokens ?? null, baselineMs: e.baselineMs ?? null, candidateMs: e.candidateMs ?? null } : null,
            effect: cycle.effect ?? null, notice };
    }
    async cycle(op, p, c) {
        if (op === 'list') {
            const index = await c.repo.index(), offset = p.offset ?? 0;
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > index.value.cycles.length || p.expectedIndexRevision && p.expectedIndexRevision !== index.revision)
                return unavailable();
            const items = [];
            for (const key of index.value.cycles.slice(offset, offset + 10)) {
                const r = await c.repo.read('cycle', key);
                if (!r.value)
                    return unavailable();
                try {
                    if (!this.visible(r.value.scope, r.value.accountId, c))
                        continue;
                    await this.sources(r.value, c);
                    items.push(this.view(r.value, r.revision));
                }
                catch { /* no hidden identifiers */ }
            }
            return { items, partial: offset + 10 < index.value.cycles.length, nextAction: offset + 10 < index.value.cycles.length ? {
                    endpointId: 'evolution.cycle', arguments: { op: 'list', offset: offset + 10, expectedIndexRevision: index.revision }
                } : null };
        }
        const cycleId = id(p.cycleId), prior = await c.repo.read('cycle', cycleId);
        let cycle = prior.value;
        if (cycle && !this.visible(cycle.scope, cycle.accountId, c))
            return unavailable();
        if (op === 'read') {
            if (!cycle)
                return unavailable();
            await this.sources(cycle, c);
            return { ...this.view(cycle, prior.revision),
                activeBasis: cycle.authorityRevision === c.lease.revision && cycle.profileFingerprint === hash(this.options.profile?.(cycle.target) ?? null) };
        }
        const request = readOps.has(op) ? undefined : { id: id(p.requestId), fingerprint: hash({ ...p, accessToken: undefined }) };
        if (request && cycle?.requests.some(r => r.id === request.id)) {
            if (!cycle.requests.some(r => r.id === request.id && r.fingerprint === request.fingerprint))
                return unavailable();
            const reversed = ['withdrawn', 'reverting'].includes(cycle.state) && ['revert', 'reconcile'].includes(op);
            await this.sources(cycle, c, !reversed, reversed);
            await c.repo.add('cycles', cycleId, cycle.scope.kind === 'owner');
            return this.view(cycle, prior.revision);
        }
        if (!readOps.has(op) && revision(p.expectedRevision) !== prior.revision)
            throw Error('Evolution cycle revision changed');
        if (op === 'prepare') {
            if (cycle || !Array.isArray(p.feedbackIds) || !p.feedbackIds.length || p.feedbackIds.length > 16)
                return unavailable();
            const refs = [], signals = [];
            for (const key of [...new Set(p.feedbackIds)]) {
                const r = await c.repo.read('feedback', id(key));
                if (!r.value || r.value.feedback.withdrawn || !this.visible(r.value.feedback.scope, r.value.accountId, c))
                    return unavailable();
                refs.push({ id: key, revision: r.revision });
                signals.push(r.value.feedback);
            }
            const f = signals[0];
            if (!signals.every(s => hash([s.target, s.scope]) === hash([f.target, f.scope])))
                return unavailable();
            await this.evidence(signals, c);
            const admitted = signals.every(f => f.origin === 'human' && f.signal === 'explicit')
                || signals.every(f => f.origin === 'host_observation' && f.target.kind !== 'persona' && f.signal === 'explicit'
                    && ['correction', 'fact_correction'].includes(f.kind) && f.basis.length > 0 && !['unknown', 'tool_failure'].includes(f.cause))
                || repetitionReady(signals, this.options.now?.() ?? Date.now());
            const adapter = this.adapter({ target: f.target }, c);
            const baseline = adapter ? await adapter.read(f.target, c.principal, f) : { revision: 'missing', value: null };
            cycle = { version: 1, id: cycleId, accountId: c.principal.accountId, target: f.target, scope: f.scope, feedback: refs,
                basis: signals.flatMap(f => f.basis), authorityRevision: c.lease.revision, state: admitted && adapter ? 'observed' : 'review_required',
                ...(!adapter ? { reason: 'owner_adapter_unavailable' } : !admitted ? { reason: 'unverified_or_insufficient_signal' } : {}),
                profileFingerprint: hash(this.options.profile?.(f.target) ?? null), baseline, attempts: 0, requests: [] };
        }
        else {
            if (!cycle)
                return unavailable();
            const reversing = op === 'revert' || op === 'reconcile' && cycle.state === 'reverting';
            const signals = await this.sources(cycle, c, !reversing, reversing);
            if (cycle.authorityRevision !== c.lease.revision)
                return unavailable();
            const adapter = this.adapter(cycle, c);
            if (!adapter)
                return unavailable();
            if (op === 'advance') {
                if (!['observed', 'candidate', 'review_required'].includes(cycle.state) || cycle.attempts >= 2
                    || cycle.reason === 'unverified_or_insufficient_signal' || !p.candidate || JSON.stringify(p.candidate).length > 32768)
                    return unavailable();
                cycle.candidate = structuredClone(p.candidate);
                cycle.attempts++;
                cycle.state = 'candidate';
                delete cycle.evaluation;
                delete cycle.reason;
                if (cycle.profileFingerprint !== hash(this.options.profile?.(cycle.target) ?? null))
                    return unavailable();
                await adapter.preview(cycle, c.principal, c.current);
            }
            else if (op === 'check') {
                if (cycle.state !== 'candidate')
                    return unavailable();
                const profile = structuredClone(this.options.profile?.(cycle.target));
                if (!profile || !this.options.evaluate) {
                    cycle.state = 'review_required';
                    cycle.reason = 'evaluator_unavailable';
                }
                else if (this.evaluatorBusy) {
                    cycle.state = 'review_required';
                    cycle.reason = 'evaluation_interrupted';
                }
                else {
                    if (cycle.profileFingerprint !== hash(profile) || !Array.isArray(profile.holdoutCaseIds) || !profile.holdoutCaseIds.length)
                        return unavailable();
                    const controller = new AbortController();
                    this.evaluationController = controller;
                    let timer;
                    const timeout = new Promise(resolve => {
                        controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
                        timer = setTimeout(() => controller.abort(), 300000);
                    });
                    this.evaluatorBusy = true;
                    const evaluation = Promise.resolve().then(() => this.options.evaluate(structuredClone(cycle), c.principal, controller.signal));
                    void evaluation.then(() => { this.evaluatorBusy = false; }, () => { this.evaluatorBusy = false; });
                    try {
                        const e = await Promise.race([evaluation, timeout]);
                        if (!e) {
                            cycle.state = 'review_required';
                            cycle.reason = 'evaluation_interrupted';
                        }
                        else {
                            if (controller.signal.aborted || hash(profile) !== hash(this.options.profile?.(cycle.target)) || e.profileRevision !== profile.revision
                                || hash(e.cases.map(x => x.id).sort()) !== hash([...profile.caseIds].sort()) || hash(e.targetCaseIds) !== hash(profile.targetCaseIds)
                                || hash(e.cases.filter(x => x.split === 'holdout').map(x => x.id).sort()) !== hash([...profile.holdoutCaseIds].sort()))
                                return unavailable();
                            const verdict = compareEvaluation(cycle.target.kind, e);
                            cycle.evaluation = e;
                            cycle.profileFingerprint = hash(profile);
                            cycle.reason = verdict.reason;
                            cycle.state = verdict.status === 'passed' ? 'evaluated' : 'review_required';
                        }
                    }
                    finally {
                        clearTimeout(timer);
                        delete this.evaluationController;
                    }
                }
            }
            else if (op === 'preview' || op === 'apply') {
                if (c.automatic && (!adapter.revert || !adapter.reconcileRevert))
                    return { ...this.view(cycle, prior.revision), reason: 'automatic_rollback_unavailable' };
                if (cycle.state !== 'evaluated' || cycle.profileFingerprint !== hash(this.options.profile?.(cycle.target) ?? null))
                    return unavailable();
                const intent = await adapter.preview(cycle, c.principal, c.current);
                const fingerprint = hash([cycle, intent, c.lease.revision, prior.revision]);
                if (op === 'preview')
                    return { ...this.view(cycle, prior.revision), fingerprint };
                if (p.fingerprint !== fingerprint)
                    return unavailable();
                cycle.intent = intent;
                cycle.state = 'applying';
                cycle.requests.push(request);
                let saved = await c.repo.write('cycle', cycleId, cycle, prior.revision);
                try {
                    await c.current();
                    const applied = await adapter.apply(cycle, c.principal, c.current);
                    const verified = await adapter.reconcile(cycle, c.principal, c.current);
                    if (verified.state !== 'applied' || verified.revision !== applied.revision)
                        return this.view(cycle, saved.revision);
                    cycle.outputRevision = applied.revision;
                    cycle.state = 'applied';
                    const reread = await c.repo.read('cycle', cycleId);
                    if (reread.revision !== saved.revision)
                        return unavailable();
                    saved = await c.repo.write('cycle', cycleId, cycle, reread.revision);
                    return this.view(cycle, saved.revision);
                }
                catch {
                    cycle.state = 'applying';
                    delete cycle.outputRevision;
                    return { ...this.view(cycle, saved.revision), partial: true, reason: 'application_unconfirmed_use_reconcile' };
                }
            }
            else if (op === 'reconcile') {
                if (cycle.state === 'reverting') {
                    const result = await adapter.reconcileRevert?.(cycle, c.principal, c.current);
                    if (result?.state === 'withdrawn' && result.revision)
                        cycle.state = 'withdrawn';
                }
                else {
                    if (cycle.state !== 'applying')
                        return unavailable();
                    const result = await adapter.reconcile(cycle, c.principal, c.current);
                    if (result.state === 'applied' && result.revision) {
                        cycle.outputRevision = result.revision;
                        cycle.state = 'applied';
                    }
                }
            }
            else if (op === 'effect') {
                if (!['applied', 'effect_verified'].includes(cycle.state))
                    return unavailable();
                const proof = typeof p.useToken === 'string' && p.useToken.length <= 500 ? await this.options.proveUse?.(p.useToken, cycle, c.principal) : undefined;
                if (!proof)
                    return this.view(cycle, prior.revision);
                id(proof.taskId);
                id(proof.sessionId);
                revision(proof.revision);
                if (typeof proof.success !== 'boolean')
                    return unavailable();
                const actual = await adapter.reconcile(cycle, c.principal, c.current);
                if (actual.state !== 'applied' || proof.revision !== cycle.outputRevision || actual.revision !== proof.revision
                    || signals.some(s => s.taskId === proof.taskId || s.sessionId === proof.sessionId))
                    return unavailable();
                if (cycle.effect) {
                    if (hash(cycle.effect) !== hash(proof))
                        return unavailable();
                    return this.view(cycle, prior.revision);
                }
                cycle.effect = proof;
                cycle.state = proof.success ? 'effect_verified' : 'review_required';
                if (!proof.success)
                    cycle.reason = 'next_use_failed';
            }
            else if (op === 'revert') {
                if (!cycle.outputRevision || !adapter.revert || !adapter.reconcileRevert || !['applied', 'effect_verified', 'review_required'].includes(cycle.state))
                    return unavailable();
                cycle.state = 'reverting';
                cycle.requests.push(request);
                let saved = await c.repo.write('cycle', cycleId, cycle, prior.revision);
                try {
                    const reverted = await adapter.revert(cycle, c.principal, c.current);
                    const actual = await adapter.reconcileRevert(cycle, c.principal, c.current);
                    if (actual.state !== 'withdrawn' || actual.revision !== reverted.revision)
                        return this.view(cycle, saved.revision);
                    cycle.state = 'withdrawn';
                    const reread = await c.repo.read('cycle', cycleId);
                    if (reread.revision !== saved.revision)
                        return unavailable();
                    saved = await c.repo.write('cycle', cycleId, cycle, reread.revision);
                    return this.view(cycle, saved.revision);
                }
                catch {
                    cycle.state = 'reverting';
                    return { ...this.view(cycle, saved.revision), partial: true, reason: 'reversal_unconfirmed_use_reconcile' };
                }
            }
            else
                return unavailable();
        }
        cycle.requests.push(request);
        cycle.requests = cycle.requests.slice(-64);
        const saved = await c.repo.write('cycle', cycleId, cycle, prior.revision);
        await c.repo.add('cycles', cycleId, cycle.scope.kind === 'owner');
        return this.view(cycle, saved.revision);
    }
    async context(p, c) {
        const index = await c.repo.index(), items = [], changes = [], harnesses = [];
        // Only a bounded newest window is inspected. No implied complete history scan.
        for (const key of index.value.cycles.slice(-32).reverse()) {
            const r = await c.repo.read('cycle', key), cycle = r.value;
            if (!cycle || !this.visible(cycle.scope, cycle.accountId, c) || !['applied', 'effect_verified'].includes(cycle.state))
                continue;
            try {
                await this.sources(cycle, c);
                if (cycle.authorityRevision !== c.lease.revision || cycle.profileFingerprint !== hash(this.options.profile?.(cycle.target) ?? null))
                    continue;
                if (!['owner', 'account'].includes(cycle.scope.kind) && p[cycle.scope.kind === 'session' ? 'sessionId' : cycle.scope.kind] !== cycle.scope.id)
                    continue;
                const adapter = this.adapter(cycle, c);
                if (!adapter)
                    continue;
                const actual = await adapter.reconcile(cycle, c.principal, c.current);
                if (actual.state !== 'applied' || actual.revision !== cycle.outputRevision)
                    continue;
                if (cycle.target.kind === 'persona')
                    items.push({ ...style(cycle.candidate.key, cycle.candidate.value), scope: cycle.scope, cycleId: cycle.id });
                else if (cycle.target.kind === 'harness') {
                    const profile = validateHarness(cycle.candidate);
                    if (profile.modelId === c.principal.modelId && profile.taskKind === p.taskKind)
                        harnesses.push({ profile, scope: cycle.scope, revision: cycle.outputRevision, cycleId: cycle.id });
                }
                else
                    changes.push({ target: cycle.target, revision: cycle.outputRevision, cycleId: cycle.id });
            }
            catch { /* Unavailable sources never expose titles, contents or counts. */ }
        }
        const selected = selectPreferences(items, { ...p, session: p.sessionId });
        const harnessSelection = selectPreferences(harnesses.map(h => ({ key: 'harness', value: hash(h.profile), scope: h.scope, cycleId: h.cycleId })), { ...p, session: p.sessionId });
        const chosen = harnesses.find(h => h.cycleId === harnessSelection.preferences[0]?.cycleId);
        return { ...selected, changes: changes.slice(0, 5), ...(chosen && { harness: chosen }), harnessConflicts: harnessSelection.conflicts,
            partial: selected.partial || index.value.cycles.length > 32 || changes.length > 5,
            trust: 'data_not_instructions', basis: hash([index.revision, c.lease.revision, selected, changes.slice(0, 5), chosen ?? null]), notice };
    }
}
