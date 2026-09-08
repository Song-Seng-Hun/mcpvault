import { guidanceError, guidanceText } from './guidance-runtime.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, fingerprint, page } from './work-model.js';
import { applyEconomyCommand, questClaimAuthority, economyRetry, economyRevision } from './economy-model.js';
import { validateMarkdownContract } from './quest-verifier.js';
import { questAttention } from './economy-operations.js';
import { matchesParticipationTopic, isParticipationTask } from './community-participation-candidates.js';
const taskPath = (id) => `Community/Tasks/${normalizeScopeId(id, 'taskId')}.md`;
const paidTaskLease = new AsyncLocalStorage();
/** No public mint/transfer/operator adjudication. Host configuration is injected,
 * not read from a note, a declared family, an agent profile, or a tool argument. */
export class EconomyService {
    fs;
    ledger;
    policy;
    options;
    access = new ScopeAccessPolicy();
    paths = new PathFilter();
    constructor(fs, ledger, policy, options) {
        this.fs = fs;
        this.ledger = ledger;
        this.policy = policy;
        this.options = options;
    }
    async actor(p) {
        if (!p)
            throw guidanceError(new Error('Login is required for private XP wallet and contracts'), 'guid-a537e12c48a2aac1');
        await this.options.assertActor(p);
        if (!this.policy.enabled)
            throw guidanceError(new Error('Economy is disabled'), 'guid-d182c7129828d67a');
        if (!Object.hasOwn(this.policy.owners, p.accountId))
            throw guidanceError(new Error('Host-approved economic owner is required'), 'guid-1e74aaa7d6649083');
        return p;
    }
    async visible(path, p) {
        const physical = this.access.resolveExternalPath(path, p);
        // Paid pilot contracts are command-center public. Private sources are not
        // copied into contract receipts even when the caller can personally read them.
        if (!this.paths.isAllowed(physical) || !this.access.canAccessPhysicalPath(physical, p) || !this.access.canAccessPhysicalPath(physical))
            throw guidanceError(new Error('Quest source unavailable'), 'guid-d3910f6b53c95fd4');
        try {
            const note = await this.fs.readNote(physical);
            if (isModerationHidden(note.frontmatter))
                throw new Error();
            return note;
        }
        catch {
            throw guidanceError(new Error('Quest source unavailable'), 'guid-d3910f6b53c95fd4');
        }
    }
    async task(c, p, member = true) {
        const note = await this.visible(taskPath(c.terms.taskId), p);
        if (note.frontmatter.mcpvault_type !== 'agent_task' || note.frontmatter.task_id !== c.terms.taskId || !note.frontmatter.project_id)
            throw guidanceError(new Error('Quest requires an existing project-backed task'), 'guid-75fe077722c5d193');
        const projectId = normalizeScopeId(String(note.frontmatter.project_id), 'projectId');
        const project = await this.visible(`Community/Projects/${projectId}.md`, p);
        if (project.frontmatter.mcpvault_type !== 'work_project' || project.frontmatter.project_id !== projectId)
            throw guidanceError(new Error('Quest project unavailable'), 'guid-60530027273785c6');
        if (member && (!Array.isArray(project.frontmatter.participants) || !project.frontmatter.participants.includes(p.accountId)))
            throw guidanceError(new Error('Explicit project membership is required'), 'guid-0d647ce478f52819');
        return note;
    }
    async fixedArtifacts(items, p, contract) {
        if (!Array.isArray(items) || !items.length || items.length > 8)
            throw guidanceError(new Error('One to eight fixed artifacts required'), 'guid-970c09b1781711d3');
        for (const item of items) {
            if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.revision))
                throw guidanceError(new Error('Exact artifact revision is required'), 'guid-aaeff44439b998c1');
            const note = await this.visible(item.path, p);
            if (note.revision !== item.revision)
                throw guidanceError(new Error('Artifact revision changed; read current context'), 'guid-e62bce26e1976898');
            if (note.frontmatter.fiction_domain || note.frontmatter.roleplay_committed) {
                if (!note.frontmatter.roleplay_committed || !this.options.validateRoleplayArtifact || !contract)
                    throw guidanceError(new Error('Fiction is not real-work evidence; explicit approved game quest review is required'), 'guid-b125f4e1ec400a7d');
                await this.options.validateRoleplayArtifact(item, contract);
            }
        }
    }
    /** Called by EVERY free task mutation, not merely work.claim. A private lease
     * is only entered by this service when bridging a paid exclusive claim. */
    async assertFreeTaskMutation(taskId) {
        const lease = paidTaskLease.getStore();
        if (lease?.active && lease.ledger === this.ledger && lease.taskId === taskId)
            return;
        const state = await this.ledger.snapshot();
        if (Object.values(state.contracts).some(c => c.terms.taskId === taskId && !['draft', 'settled', 'cancelled'].includes(c.status)))
            throw guidanceError(new Error('Paid task is controlled by quest.contract; free mutation would bypass escrow/claim rules'), 'guid-68f852f2b6594af5');
    }
    async workProjection(principal, taskIds) {
        if (!principal || !Object.hasOwn(this.policy.owners, principal.accountId))
            return {};
        const actor = await this.actor(principal), ids = new Set(taskIds), state = await this.ledger.snapshot(), result = {};
        for (const c of Object.values(state.contracts)) {
            if (!ids.has(c.terms.taskId) || ['draft', 'cancelled'].includes(c.status))
                continue;
            let current;
            try {
                current = await this.task(c, actor, false);
            }
            catch {
                continue;
            }
            const old = result[c.terms.taskId];
            if (old && old.status !== 'settled')
                continue;
            const divergence = c.workBinding && current.revision !== c.workBinding.revision;
            result[c.terms.taskId] = { kind: 'paidContract', contractId: c.id, status: c.status, reward: c.terms.reward, revision: economyRevision(c), generation: c.generation,
                ...(divergence && c.status !== 'settled' ? { warning: guidanceText('guid-3088de795374c765', 'paid_work_divergence'), paymentHeld: true } : {}),
                attention: questAttention(c, new Date().toISOString()), freeMutationBlocked: !['settled', 'cancelled'].includes(c.status),
                nextAction: { endpointId: 'quest.market', arguments: { contractId: c.id, maxChars: 4000 } }, authority: 'Budget is not external execution authority' };
        }
        await this.actor(actor);
        return result;
    }
    /** Read-only host projection for the opt-in participation pulse. Contracts
     * remain ledger-private: this emits only a visible task, its current activity
     * fingerprint, role-local reason, and the normal read-only market action. */
    participationOptions() {
        return {
            economyCandidates: (principal, context) => !this.policy.enabled || !Object.hasOwn(this.policy.owners, principal.accountId) ? Promise.resolve([]) : this.participationCandidates(principal, context),
            economyTargetSnapshot: (principal, path, context) => this.participationTargetSnapshot(principal, path, context),
        };
    }
    async participationCandidates(principal, context) {
        const rows = await this.participationRows(principal, context);
        return rows.slice(0, 3).map(row => row.candidate);
    }
    async participationTargetSnapshot(principal, path, context) {
        if (!/^Community\/Tasks\/[a-z0-9][a-z0-9._-]*\.md$/.test(path))
            throw guidanceError(new Error('Quest target unavailable'), 'guid-b50aaf0165ff150d');
        const rows = await this.participationRows(principal, { ...context, seen: [] }, path);
        if (rows.length !== 1)
            throw guidanceError(new Error('Quest target unavailable; reread participation pulse'), 'guid-ea37cc0c2a34a1bf');
        const { candidate, frontmatter } = rows[0];
        return { revision: candidate.revision, activityRevision: candidate.activityRevision, frontmatter };
    }
    async participationRows(principal, context, targetPath) {
        const actor = await this.actor(principal), state = await this.ledger.snapshot(), output = [];
        const busy = Object.values(state.contracts).some(c => c.workerOwner === this.policy.owners[actor.accountId] && ['claimed', 'submitted', 'changes_requested', 'disputed'].includes(c.status));
        const words = (value) => new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
        const matchingGoal = (contract, path) => context.goals.find(goal => {
            if (goal.links?.includes(path))
                return true;
            const goalWords = words(goal.question), contractWords = words(`${contract.terms.title} ${contract.terms.criteria.join(' ')}`);
            return [...goalWords].some(word => contractWords.has(word));
        });
        const contracts = Object.values(state.contracts).sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled') || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const currentTasks = new Set();
        for (const contract of contracts) {
            if (['draft', 'cancelled'].includes(contract.status) || (targetPath && taskPath(contract.terms.taskId) !== targetPath))
                continue;
            if (currentTasks.has(contract.terms.taskId))
                continue;
            currentTasks.add(contract.terms.taskId);
            let task;
            try {
                task = await this.task(contract, actor);
            }
            catch {
                continue;
            }
            if (task.frontmatter.content_status === 'deleted' || !isParticipationTask(taskPath(contract.terms.taskId), task.frontmatter))
                continue;
            const frontmatter = { title: contract.terms.title, tags: Array.isArray(task.frontmatter.tags) ? task.frontmatter.tags.filter((tag) => typeof tag === 'string') : [] };
            if (!context.topics.some(topic => matchesParticipationTopic(frontmatter, topic)))
                continue;
            const path = taskPath(contract.terms.taskId), activityRevision = fingerprint({ contract: economyRevision(contract), task: task.revision });
            const seen = context.seen.find(item => item.path === path);
            const due = Boolean(seen?.deferUntil && Date.parse(seen.deferUntil) <= context.now);
            if (seen && (seen.activityRevision || seen.revision) === (seen.activityRevision ? activityRevision : task.revision) && !due)
                continue;
            const ownRequester = contract.requester === actor.accountId, ownWorker = contract.worker === actor.accountId, ownReviewer = contract.reviewer === actor.accountId;
            const goal = matchingGoal(contract, path);
            let reason, lane = 'follow_up';
            if (contract.status === 'settled' && (ownRequester || ownWorker))
                reason = 'Your quest result is settled; confirm the result and plan any follow-up. No further work or payment is automatic.';
            else if (ownRequester)
                reason = contract.status === 'funded' ? 'Your commissioned quest is funded and awaiting an explicit acceptance.' : 'Your commissioned quest has a current work or review follow-up.';
            else if (ownWorker)
                reason = contract.status === 'submitted' ? 'Your submitted result is awaiting its assigned review.' : 'Your accepted quest has a current result follow-up.';
            else if (ownReviewer)
                reason = contract.status === 'submitted' ? 'Your assigned quest review is ready for an explicit review decision.' : 'Your assigned quest has a current review follow-up.';
            else if (contract.status === 'funded' && goal) {
                if (actor.capabilities && !actor.capabilities.includes('task'))
                    continue;
                if (task.revision !== contract.terms.taskRevision || task.frontmatter.assignee_account_id || !['proposed', 'accepted'].includes(String(task.frontmatter.status)))
                    continue;
                try {
                    questClaimAuthority(contract, actor.accountId, this.policy, new Date(context.now).toISOString(), busy);
                }
                catch {
                    continue;
                }
                reason = `A funded quest matches your goal: ${goal.id}. Acceptance is manual and never starts work automatically.`;
                lane = 'interest';
            }
            if (!reason)
                continue;
            output.push({ frontmatter, candidate: { path, revision: task.revision, activityRevision, lane, title: contract.terms.title, reason, changedAt: contract.updatedAt,
                    changes: [], nextAction: { endpointId: 'quest.market', arguments: { contractId: contract.id, maxChars: 2000 } } } });
        }
        output.sort(({ candidate: a }, { candidate: b }) => Number(a.lane === 'interest') - Number(b.lane === 'interest') || b.changedAt.localeCompare(a.changedAt) || a.path.localeCompare(b.path));
        await this.actor(actor);
        return output;
    }
    async wallet(principal, params) {
        const actor = await this.actor(principal), { state: s, transactions, historyLimited } = await this.ledger.walletSnapshot(actor.accountId);
        const own = Object.values(s.contracts).filter(c => c.requester === actor.accountId);
        const escrowXp = own.reduce((sum, c) => sum + c.escrow, 0), availableXp = s.balances[actor.accountId] || 0;
        const items = [...transactions, ...own.map(c => ({ kind: 'escrow', contractId: c.id, status: c.status, escrowXp: c.escrow, revision: economyRevision(c) }))];
        await this.actor(actor);
        return page(items, { availableXp, escrowXp, historyLimited, reputation: 'separate_nontransferable_signal', dataOnly: true }, fingerprint({ account: actor.accountId, sequence: s.sequence }), params, 'economy.wallet');
    }
    async market(principal, params) {
        const actor = await this.actor(principal), s = await this.ledger.snapshot(), items = [];
        for (const c of Object.values(s.contracts)) {
            if (params.contractId && c.id !== params.contractId)
                continue;
            if (c.status === 'draft' && c.requester !== actor.accountId)
                continue;
            try {
                await this.task(c, actor, false);
            }
            catch {
                continue;
            }
            const role = c.worker === actor.accountId ? 'worker' : c.requester === actor.accountId ? 'requester' : c.reviewer === actor.accountId ? 'reviewer' : 'reader';
            const attention = questAttention(c, new Date().toISOString());
            const warning = attention === 'none' ? undefined : attention;
            items.push({ contractId: c.id, title: c.terms.title, status: c.status, reward: c.terms.reward, deadline: c.terms.deadline,
                task: taskPath(c.terms.taskId), revision: economyRevision(c), generation: c.generation, role,
                ...(warning && { warning }),
                ...(params.contractId && { criteria: c.terms.criteria, exclusions: c.terms.exclusions, verifier: c.terms.verifier, reviewFee: c.reviewFee, postingFee: c.postingFee,
                    ...(c.submission && { submissionBasis: c.submission.basis }) }) });
        }
        // Never sort by wealth/reputation; current ready work precedes closed records.
        items.sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled') || String(a.contractId).localeCompare(String(b.contractId)));
        await this.actor(actor);
        return page(items, { dataOnly: true, budgetIsNotExecutionAuthority: true }, fingerprint({ account: actor.accountId, items }), { ...params, limit: Math.min(params.limit ?? 3, 3) }, 'quest.market');
    }
    async contract(principal, params) {
        if (!['draft', 'fund', 'claim', 'submit', 'cancel', 'dispute'].includes(params.op))
            throw guidanceError(new Error('Operation requires a separate host approval path'), 'guid-606ffc92b50e6636');
        return this.mutate(principal, params);
    }
    async review(principal, params) {
        if (params.op !== 'review')
            throw guidanceError(new Error('Only assigned review is available; host adjudication is separate'), 'guid-022a51d58cec2204');
        return this.mutate(principal, params);
    }
    async mutate(principal, params) {
        params = structuredClone(params);
        delete params.workBinding; // Host-only receipt cannot be caller supplied.
        const actor = await this.actor(principal);
        return coordinate(async () => {
            const snapshot = await this.ledger.snapshot();
            const c = params.contractId ? snapshot.contracts[params.contractId] : undefined;
            let target = c;
            if (params.op === 'draft') {
                if (!params.terms)
                    throw guidanceError(new Error('Terms required'), 'guid-a801d93a160ff0b5');
                target = { terms: params.terms, requester: actor.accountId };
            }
            if (!target)
                throw guidanceError(new Error('Contract unavailable'), 'guid-5173cd783894e32a');
            if (params.op === 'claim' && c?.workBinding)
                params.workBinding = structuredClone(c.workBinding);
            const retry = economyRetry(snapshot, { ...params, actor: actor.accountId });
            const validateBinding = async (binding, worker) => {
                const current = await this.task(target, actor);
                if (!binding || current.revision !== binding.revision || current.frontmatter.assignee_account_id !== worker || Number(current.frontmatter.claim_generation) !== binding.generation || current.frontmatter.status !== 'in_progress')
                    throw guidanceError(new Error('Work binding/generation changed; settlement suspended for host reconciliation'), 'guid-32733e0a75c48b44');
            };
            const validate = async () => {
                await this.actor(actor);
                const task = await this.task(target, actor);
                if (retry)
                    return; // replay authorization/visibility, not obsolete execution prerequisites
                if (params.op === 'cancel' && target.status === 'funded' && (task.revision !== target.terms.taskRevision || task.frontmatter.assignee_account_id))
                    throw guidanceError(new Error('Work claim may have committed; refund suspended for host reconciliation'), 'guid-5d7ff3154bc514b9');
                if (params.op === 'submit' || params.op === 'review')
                    await validateBinding(target.workBinding, target.worker);
                if (params.op === 'claim' && params.workBinding)
                    await validateBinding(params.workBinding, actor.accountId);
                if (params.op === 'draft' || params.op === 'fund') {
                    if (task.revision !== target.terms.taskRevision || task.frontmatter.requester_account_id !== actor.accountId || task.frontmatter.assignee_account_id)
                        throw guidanceError(new Error('Task revision/ownership/assignment changed'), 'guid-3b16b06812dd205d');
                    if (!['proposed', 'accepted'].includes(String(task.frontmatter.status)))
                        throw guidanceError(new Error('Task is not ready to advertise'), 'guid-4b30b9f04cf92a1a');
                    if (target.terms.kind === 'mechanical' && task.frontmatter.work_kind && task.frontmatter.work_kind !== 'general')
                        throw guidanceError(new Error('High-risk work cannot use automatic mechanical payment'), 'guid-b20827703930ef73');
                    if (target.terms.kind === 'mechanical' && !this.options.verify)
                        throw guidanceError(new Error('No trusted versioned verifier configured'), 'guid-c9276caa5cccd5d5');
                    if (target.terms.kind === 'mechanical')
                        validateMarkdownContract(target.terms.verifier, target.terms.criteria);
                }
                if (params.op === 'submit')
                    await this.fixedArtifacts(params.artifacts, actor, target);
                if (params.op === 'review') {
                    await this.fixedArtifacts(target.submission?.artifacts, actor, target);
                    await this.fixedArtifacts(params.reviewArtifact ? [params.reviewArtifact] : undefined, actor, target);
                }
            };
            await validate();
            // Validate money/owner/WIP/state before touching the existing Work record.
            applyEconomyCommand(snapshot, { ...params, actor: actor.accountId }, this.policy, new Date().toISOString());
            if (params.op === 'claim') {
                if (!this.options.claimTask)
                    throw guidanceError(new Error('Paid Work bridge is unavailable'), 'guid-b122520f6d0b698a');
                // Preserve old receipts on exact retry; avoid starting a second task.
                if (!retry) {
                    const lease = { ledger: this.ledger, taskId: target.terms.taskId, active: true };
                    try {
                        params.workBinding = await paidTaskLease.run(lease, () => this.options.claimTask(actor, target, params.requestId));
                    }
                    finally {
                        lease.active = false;
                    }
                    await validateBinding(params.workBinding, actor.accountId);
                }
            }
            const receipt = await this.ledger.transact({ ...params, actor: actor.accountId }, validate);
            if (params.op === 'submit' && target.terms.kind === 'mechanical') {
                const updated = (await this.ledger.snapshot()).contracts[target.id];
                if (updated.status === 'submitted' && this.options.verify && await this.options.verify(updated, updated.submission.artifacts)) {
                    // This private adapter action uses a fixed host-approved verifier,
                    // not a user-submitted successful receipt or a Work completion flag.
                    await this.ledger.transact({ op: 'resolve', actor: this.policy.operators[0], requestId: `verify-${fingerprint({ actor: actor.accountId, requestId: params.requestId })}`, contractId: updated.id,
                        expectedRevision: economyRevision(updated), expectedGeneration: updated.generation, amount: updated.terms.reward, reason: guidanceText('guid-992947c3a5312363', `Trusted verifier ${updated.terms.verifier} passed exact contracted literals; not truth or quality approval`) }, async () => {
                        await validate();
                        await validateBinding(updated.workBinding, updated.worker);
                        await this.fixedArtifacts(updated.submission.artifacts, actor, updated);
                        if (!await this.options.verify(updated, updated.submission.artifacts))
                            throw guidanceError(new Error('Verifier no longer passes; payout held'), 'guid-8c73acae929ddffe');
                    });
                }
            }
            return receipt;
        });
    }
}
