import { AsyncLocalStorage } from 'node:async_hooks';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, fingerprint, page } from './work-model.js';
import { applyEconomyCommand, economyRetry, economyRevision } from './economy-model.js';
import { validateMarkdownContract } from './quest-verifier.js';
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
            throw new Error('Login is required for private XP wallet and contracts');
        await this.options.assertActor(p);
        if (!this.policy.enabled)
            throw new Error('Economy is disabled');
        if (!Object.hasOwn(this.policy.owners, p.accountId))
            throw new Error('Host-approved economic owner is required');
        return p;
    }
    async visible(path, p) {
        const physical = this.access.resolveExternalPath(path, p);
        // Paid pilot contracts are command-center public. Private sources are not
        // copied into contract receipts even when the caller can personally read them.
        if (!this.paths.isAllowed(physical) || !this.access.canAccessPhysicalPath(physical, p) || !this.access.canAccessPhysicalPath(physical))
            throw new Error('Quest source unavailable');
        try {
            const note = await this.fs.readNote(physical);
            if (isModerationHidden(note.frontmatter))
                throw new Error();
            return note;
        }
        catch {
            throw new Error('Quest source unavailable');
        }
    }
    async task(c, p, member = true) {
        const note = await this.visible(taskPath(c.terms.taskId), p);
        if (note.frontmatter.mcpvault_type !== 'agent_task' || note.frontmatter.task_id !== c.terms.taskId || !note.frontmatter.project_id)
            throw new Error('Quest requires an existing project-backed task');
        const projectId = normalizeScopeId(String(note.frontmatter.project_id), 'projectId');
        const project = await this.visible(`Community/Projects/${projectId}.md`, p);
        if (project.frontmatter.mcpvault_type !== 'work_project' || project.frontmatter.project_id !== projectId)
            throw new Error('Quest project unavailable');
        if (member && (!Array.isArray(project.frontmatter.participants) || !project.frontmatter.participants.includes(p.accountId)))
            throw new Error('Explicit project membership is required');
        return note;
    }
    async fixedArtifacts(items, p) {
        if (!Array.isArray(items) || !items.length || items.length > 8)
            throw new Error('One to eight fixed artifacts required');
        for (const item of items) {
            if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.revision))
                throw new Error('Exact artifact revision is required');
            const note = await this.visible(item.path, p);
            if (note.revision !== item.revision)
                throw new Error('Artifact revision changed; read current context');
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
            throw new Error('Paid task is controlled by quest.contract; free mutation would bypass escrow/claim rules');
    }
    async wallet(principal, params) {
        const actor = await this.actor(principal), s = await this.ledger.snapshot();
        const own = Object.values(s.contracts).filter(c => c.requester === actor.accountId);
        const escrowXp = own.reduce((sum, c) => sum + c.escrow, 0), availableXp = s.balances[actor.accountId] || 0;
        const items = own.map(c => ({ contractId: c.id, status: c.status, escrowXp: c.escrow, revision: economyRevision(c) }));
        await this.actor(actor);
        return page(items, { availableXp, escrowXp, reputation: 'separate_nontransferable_signal', dataOnly: true }, fingerprint({ account: actor.accountId, sequence: s.sequence }), params, 'economy.wallet');
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
            const warning = c.submission && Date.now() > Date.parse(c.submission.at) + 48 * 3600000 && !['settled', 'cancelled'].includes(c.status) ? 'review_overdue_operator_attention' : undefined;
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
            throw new Error('Operation requires a separate host approval path');
        return this.mutate(principal, params);
    }
    async review(principal, params) {
        if (params.op !== 'review')
            throw new Error('Only assigned review is available; host adjudication is separate');
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
                    throw new Error('Terms required');
                target = { terms: params.terms, requester: actor.accountId };
            }
            if (!target)
                throw new Error('Contract unavailable');
            if (params.op === 'claim' && c?.workBinding)
                params.workBinding = structuredClone(c.workBinding);
            const retry = economyRetry(snapshot, { ...params, actor: actor.accountId });
            const validateBinding = async (binding, worker) => {
                const current = await this.task(target, actor);
                if (!binding || current.revision !== binding.revision || current.frontmatter.assignee_account_id !== worker || Number(current.frontmatter.claim_generation) !== binding.generation || current.frontmatter.status !== 'in_progress')
                    throw new Error('Work binding/generation changed; settlement suspended for host reconciliation');
            };
            const validate = async () => {
                await this.actor(actor);
                const task = await this.task(target, actor);
                if (retry)
                    return; // replay authorization/visibility, not obsolete execution prerequisites
                if (params.op === 'cancel' && target.status === 'funded' && (task.revision !== target.terms.taskRevision || task.frontmatter.assignee_account_id))
                    throw new Error('Work claim may have committed; refund suspended for host reconciliation');
                if (params.op === 'submit' || params.op === 'review')
                    await validateBinding(target.workBinding, target.worker);
                if (params.op === 'claim' && params.workBinding)
                    await validateBinding(params.workBinding, actor.accountId);
                if (params.op === 'draft' || params.op === 'fund') {
                    if (task.revision !== target.terms.taskRevision || task.frontmatter.requester_account_id !== actor.accountId || task.frontmatter.assignee_account_id)
                        throw new Error('Task revision/ownership/assignment changed');
                    if (!['proposed', 'accepted'].includes(String(task.frontmatter.status)))
                        throw new Error('Task is not ready to advertise');
                    if (target.terms.kind === 'mechanical' && task.frontmatter.work_kind && task.frontmatter.work_kind !== 'general')
                        throw new Error('High-risk work cannot use automatic mechanical payment');
                    if (target.terms.kind === 'mechanical' && !this.options.verify)
                        throw new Error('No trusted versioned verifier configured');
                    if (target.terms.kind === 'mechanical')
                        validateMarkdownContract(target.terms.verifier, target.terms.criteria);
                }
                if (params.op === 'submit')
                    await this.fixedArtifacts(params.artifacts, actor);
                if (params.op === 'review') {
                    await this.fixedArtifacts(target.submission?.artifacts, actor);
                    await this.fixedArtifacts(params.reviewArtifact ? [params.reviewArtifact] : undefined, actor);
                }
            };
            await validate();
            // Validate money/owner/WIP/state before touching the existing Work record.
            applyEconomyCommand(snapshot, { ...params, actor: actor.accountId }, this.policy, new Date().toISOString());
            if (params.op === 'claim') {
                if (!this.options.claimTask)
                    throw new Error('Paid Work bridge is unavailable');
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
                        expectedRevision: economyRevision(updated), expectedGeneration: updated.generation, amount: updated.terms.reward, reason: `Trusted verifier ${updated.terms.verifier} passed exact contracted literals; not truth or quality approval` }, async () => {
                        await validate();
                        await validateBinding(updated.workBinding, updated.worker);
                        await this.fixedArtifacts(updated.submission.artifacts, actor);
                        if (!await this.options.verify(updated, updated.submission.artifacts))
                            throw new Error('Verifier no longer passes; payout held');
                    });
                }
            }
            return receipt;
        });
    }
}
