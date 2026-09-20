import { EvolutionService } from './service.js';
import { EvolutionEvaluator } from './evaluator.js';
import { EvolutionRuntimeEvidence } from './runtime-evidence.js';
import { hash, id, unavailable } from './policy.js';
import { withHarness } from './harness.js';
import { EvolutionBudget } from './budget.js';
import { EvolutionOperations } from './operations.js';
import { builtinEvolutionProfiles } from './builtin-profiles.js';
import { EvolutionDirectReview } from './direct-review.js';
import { CurationService } from '../curation/service.js';
/** Concrete existing-account connection. No registration, certificate binding or owner inference. */
export function connectEvolutionRuntime(config, services) {
    let closed = false;
    const { auth, access, fs, moderation } = services;
    const evaluator = new EvolutionEvaluator(config.profiles ?? builtinEvolutionProfiles(services.retrieval, access));
    const sessionChecks = new WeakMap();
    const identity = (p) => [p.accountId, p.modelId, p.agentId, p.userId, p.commandCenterId, p.role, [...p.capabilities ?? []].sort()];
    const authorize = async (p) => {
        if (closed)
            return unavailable();
        sessionChecks.get(p)?.();
        await services.refreshPolicy();
        const current = (await auth.listPrincipals({ fresh: true })).find(a => a.accountId === p.accountId);
        if (!current || hash(identity(current)) !== hash(identity(p)) || await moderation.isBanned(p.accountId, p.userId, { fresh: true }))
            return unavailable();
        sessionChecks.get(p)?.();
        return hash([identity(current), p.enterprise ?? null, access.documentPolicyFingerprint()]);
    };
    const evidence = new EvolutionRuntimeEvidence({ storage: config.storage, authorize });
    const budget = new EvolutionBudget(config.storage, async (accountId) => {
        if (services.readOnly)
            return unavailable();
        const principal = (await auth.listPrincipals({ fresh: true })).find(p => p.accountId === accountId);
        if (!principal || !auth.hasCapability(principal, 'write'))
            return unavailable();
        await authorize(principal);
    });
    const options = { storage: config.storage, readOnly: services.readOnly,
        curation: new CurationService({ fs, access, config: () => config.storage.refresh(),
            managedProof: (path, revision, principal) => services.compilation?.managedOutputProof(path, revision, principal) ?? Promise.resolve(undefined) }),
        authority: async (p) => {
            const revision = await authorize(p);
            return { ownerId: p.accountId, sharedOwner: false, revision, assertCurrent: async () => { if (await authorize(p) !== revision)
                    return unavailable(); } };
        },
        attest: (token, p, raw) => evidence.attest(token, p, raw),
        proveUse: (token, cycle, p) => evidence.proveUse(token, cycle, p),
        profile: target => evaluator.profile(target),
        evaluate: async (cycle, p, signal) => {
            const before = await authorize(p);
            const result = await evaluator.evaluate(cycle, signal, p);
            if (await authorize(p) !== before)
                return unavailable();
            return result;
        },
        verifyEvidence: async (items, p) => {
            const before = await authorize(p);
            for (const item of items) {
                const path = access.resolveExternalPath(item.path, p);
                if (!access.canAccessPhysicalPath(path, p) || !access.canReadProtectedDocument(path, p))
                    return false;
                const note = await fs.readNote(path, 256 * 1024);
                if (note.revision !== item.revision || !access.canAccessPhysicalPath(path, p))
                    return false;
            }
            return await authorize(p) === before;
        },
        ...(services.adapters && { adapters: services.adapters }),
    };
    const service = new EvolutionService(options);
    const actor = async (token, write = false) => {
        const p = auth.authenticate(token);
        if (!p || write && (services.readOnly || !auth.hasCapability(p, 'write')))
            return unavailable();
        const fingerprint = hash(p);
        sessionChecks.set(p, () => { const now = auth.authenticate(token); if (!now || hash(now) !== fingerprint)
            return unavailable(); });
        await authorize(p);
        const assert = async () => { const now = auth.authenticate(token); if (!now || hash(now) !== fingerprint)
            return unavailable(); await authorize(now); };
        await assert();
        return { principal: p, assert };
    };
    const host = Object.freeze({
        /** Only the host transport may attest a verified human message. Not an MCP endpoint. */
        captureFeedback: async (token, raw, origin, eventId) => {
            const a = await actor(token, true);
            const receipt = await evidence.captureFeedback(a.principal, raw, origin, eventId);
            await a.assert();
            return receipt;
        },
        deliverContext: async (token, args) => {
            const a = await actor(token, true);
            id(args.taskId);
            id(args.sessionId);
            const packet = await service.execute('context', args, a.principal, a.assert);
            const receipts = [];
            // Only record items actually included in this bounded packet, never omitted items.
            for (const entry of [...packet.preferences ?? [], ...packet.changes ?? [], ...packet.harness ? [packet.harness] : []]) {
                const cycle = await service.execute('cycle', { op: 'read', cycleId: entry.cycleId }, a.principal, a.assert);
                if (!['applied', 'effect_verified'].includes(cycle.status) || !cycle.outputRevision)
                    return unavailable();
                const receipt = await evidence.captureDelivery(a.principal, { taskId: args.taskId, sessionId: args.sessionId,
                    cycleId: entry.cycleId, revision: cycle.outputRevision, representationHash: hash(entry), basis: packet.basis });
                receipts.push({ cycleId: entry.cycleId, token: receipt });
            }
            await a.assert();
            return { packet, receipts, retention: 'unknown' };
        },
        verifyUse: async (token, receipt, check) => {
            const a = await actor(token, true);
            const verified = await evidence.verifyUse(receipt, a.principal, { ...check, evaluate: async (observation) => {
                    await a.assert();
                    const result = await check.evaluate(observation);
                    await a.assert();
                    return result;
                } });
            await a.assert();
            return verified;
        },
        recordForegroundUsage: async (token, eventId, tokens) => {
            const a = await actor(token, true);
            await budget.recordForeground(a.principal.accountId, eventId, tokens);
            await a.assert();
        },
        runTask: async (token, args, operation, observe) => {
            const a = await actor(token, true);
            id(args.taskId);
            id(args.sessionId);
            id(args.taskKind);
            const packet = await service.execute('context', args, a.principal, a.assert);
            const pinned = await evidence.pinHarness(a.principal, args, packet.harness);
            observe?.(pinned ? { cycleId: pinned.cycleId, revision: pinned.revision } : undefined);
            const assertPinned = async () => {
                await a.assert();
                if (pinned) {
                    const cycle = await service.execute('cycle', { op: 'read', cycleId: pinned.cycleId }, a.principal, a.assert);
                    if (!cycle.activeBasis || !['applied', 'effect_verified'].includes(cycle.status))
                        return unavailable();
                }
            };
            await assertPinned();
            const result = pinned ? await withHarness({ accountId: a.principal.accountId, taskId: args.taskId,
                sessionId: args.sessionId, revision: pinned.revision, profile: pinned.profile, assertCurrent: assertPinned }, operation) : await operation();
            await assertPinned();
            return result;
        },
    });
    const operationActor = async (token, write) => {
        const a = await actor(token, write), authority = await authorize(a.principal);
        return { accountId: a.principal.accountId, modelId: a.principal.modelId, authority, assert: async () => {
                await a.assert();
                if (await authorize(a.principal) !== authority)
                    return unavailable();
            } };
    };
    const operations = new EvolutionOperations(config.storage, host, operationActor);
    const review = new EvolutionDirectReview(config.storage, {
        actor: operationActor,
        login: async (accountId, password) => {
            if (services.readOnly)
                return unavailable();
            const result = await auth.login({ accountId, password });
            try {
                await actor(result.accessToken, true);
                return result.accessToken;
            }
            catch {
                await auth.endSession(result.accessToken);
                return unavailable();
            }
        },
        logout: token => auth.endSession(token),
        record: async (token, request) => {
            const a = await actor(token, true), eventToken = await host.captureFeedback(token, request.feedback, 'human', request.id);
            return service.execute('feedback', { op: 'record', feedback: request.feedback, eventToken, requestId: request.id, expectedRevision: 'missing' }, a.principal, a.assert);
        },
        inspectEffect: async (token, args) => {
            const a = await actor(token, true), delivery = await evidence.inspectDelivery(String(args.deliveryToken), a.principal);
            const cycle = await service.execute('cycle', { op: 'read', cycleId: args.cycleId }, a.principal, a.assert);
            if (cycle.target.kind !== 'persona' || cycle.status !== 'applied' || cycle.revision !== args.expectedRevision || !cycle.activeBasis
                || delivery.cycleId !== cycle.cycleId || delivery.revision !== cycle.outputRevision)
                return unavailable();
            const packet = await service.execute('context', { [cycle.scope.kind]: cycle.scope.id,
                taskId: delivery.taskId, sessionId: delivery.sessionId }, a.principal, a.assert);
            const preference = packet.preferences?.find((p) => p.cycleId === cycle.cycleId);
            if (!preference)
                return unavailable();
            return { scope: cycle.scope, key: preference.key, value: preference.value, cycleId: cycle.cycleId, taskId: delivery.taskId, sessionId: delivery.sessionId,
                summary: 'Confirm actual use and successful expression correction in a distinct later task and session. Source: agent report, direct user review.' };
        },
        recordEffect: async (token, request) => {
            const a = await actor(token, true), effect = request.effect;
            const current = await service.execute('cycle', { op: 'read', cycleId: effect.cycleId }, a.principal, a.assert);
            if (current.revision !== effect.expectedRevision || current.status !== 'applied' || !current.activeBasis)
                return unavailable();
            const useToken = await host.verifyUse(token, effect.deliveryToken, { method: 'operational', checkId: 'direct-user-review-v1', source: 'direct_user_review',
                evaluate: async (d) => {
                    if (d.cycleId !== effect.cycleId || d.revision !== current.outputRevision)
                        return unavailable();
                    return { used: true, success: true, resultHash: hash([request.id, effect.responseHash, 'agent-report-directly-confirmed']) };
                },
            });
            return service.execute('cycle', { op: 'effect', cycleId: effect.cycleId, requestId: request.id,
                expectedRevision: effect.expectedRevision, useToken }, a.principal, a.assert);
        },
    });
    const close = async () => { closed = true; await Promise.all([service.close(), operations.close(), review.close()]); };
    return { service, options, host, budget, operations, review, close };
}
