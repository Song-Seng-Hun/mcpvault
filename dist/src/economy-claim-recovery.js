import { economyRevision } from './economy-model.js';
import { fingerprint } from './work-model.js';
import { isModerationHidden } from './moderation-policy.js';
/** Non-monetary host repair of a Work claim already committed before a crash.
 * Neither worker equality nor a forged marker is sufficient: the existing
 * Work receipt binds the entire current body/Properties and generation. */
export async function validatePaidClaimRecovery(state, c, fs) {
    if (c.op !== 'recover_claim')
        throw new Error('Host claim recovery command required');
    const contract = c.contractId ? state.contracts[c.contractId] : undefined, b = c.workBinding;
    if (!contract || contract.status !== 'funded' || !b || economyRevision(contract) !== c.expectedRevision || c.expectedGeneration !== contract.generation)
        throw new Error('Paid claim recovery revision/state conflict');
    const task = await fs.readNote(`Community/Tasks/${contract.terms.taskId}.md`);
    const fm = task.frontmatter;
    if (isModerationHidden(fm) || fm.mcpvault_type !== 'agent_task' || fm.task_id !== contract.terms.taskId || task.revision !== b.revision
        || fm.assignee_account_id !== c.account || fm.status !== 'in_progress' || fm.claim_generation !== b.generation
        || fm.economy_claim_generation !== b.generation || fm.economy_contract_id !== contract.id || fm.economy_claim_request_id !== b.requestId)
        throw new Error('Paid Work divergence: exact original claim markers required');
    const { work_receipts: receipts, ...properties } = fm;
    const receipt = Array.isArray(receipts) && receipts.find((r) => r.actor === c.account && r.action === 'claim.start' && r.target === contract.terms.taskId && r.requestId === b.requestId);
    if (!receipt || receipt.result?.generation !== b.generation || receipt.state !== fingerprint({ state: JSON.stringify(properties), content: task.content }))
        throw new Error('Paid Work divergence: original claim receipt no longer matches');
    if (typeof fm.started_at !== 'string' || !Number.isFinite(Date.parse(fm.started_at)) || Date.parse(fm.started_at) > Date.parse(contract.terms.deadline))
        throw new Error('Claim must have actually started before the original deadline');
    const project = await fs.readNote(`Community/Projects/${String(fm.project_id)}.md`);
    if (isModerationHidden(project.frontmatter) || project.frontmatter.mcpvault_type !== 'work_project' || !project.frontmatter.participants?.includes(c.account))
        throw new Error('Recovery project membership unavailable');
}
