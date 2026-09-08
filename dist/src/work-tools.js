import { guidanceText } from './guidance-runtime.js';
const text = (maxLength = 500) => ({ type: 'string', maxLength });
const strings = { type: 'array', maxItems: 20, items: text() };
const accessToken = { type: 'string', description: 'Keep the recovered account token in the host private store, never in a note.' };
const expectedRevision = { type: 'string', description: 'Current target revision; missing only for creation.' };
const requestId = { type: 'string', maxLength: 128, description: 'Required for every project-backed task create/update, even when projectId is omitted on update. Unique retry key for this logical change; reuse the same key and exact arguments after an uncertain response.' };
const expectedGeneration = { type: 'integer', minimum: 0, description: 'Required for project-backed task updates, including legacy updates that omit projectId. Use current claim_generation from the read task or generation from work.packet; stale workers cannot update an inherited task.' };
const reason = text(500);
const bounds = {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000, description: 'Total compact response character budget, including context and continuation.' },
    cursor: { type: 'string', description: 'Opaque returned continuation; changed views require a fresh first page.' },
};
export const WORK_MUTATING_TOOLS = ['manage_work_group', 'manage_work_project', 'claim_work_task', 'handoff_work_task', 'review_work_task'];
export const WORK_TASK_PROPERTIES = {
    responsibility: { type: 'object', additionalProperties: false, description: 'Optional task-specific perspective, conditions and exact resource reservation; not a permanent profession or an execution grant. Release active work before changing mode/resources/perspective. Alternative is non-exclusive coordination, not permission to overwrite another writer.', properties: {
            question: text(), perspective: text(80), mode: { type: 'string', enum: ['exclusive_write', 'advice', 'alternative'] },
            deliverables: strings, conditions: strings, coversCriteria: { ...strings, description: 'Exact strings from project completionCriteria; advisory coverage, not completion evidence.' },
            resources: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, properties: { path: text(500), repository: text(300), file: text(500) }, description: 'Existing visible vault file path OR credential-free HTTPS repository URL and exact relative file. No glob, folder reservation, shell, or external filesystem locking.' } },
        } },
    projectId: text(64), parentTaskId: text(64), dependsOn: strings,
    completionCriteria: strings,
    artifacts: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, properties: {
                path: text(500), revision: text(300), repository: text(300), branch: text(300), commit: { type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$', description: 'Full immutable Git object ID, not HEAD, a branch, or a mutable tag. Existence is reported by the peer, not fetched by MCPVault.' }, files: strings,
            } } },
    workKind: { type: 'string', enum: ['general', 'security', 'permissions', 'shared_policy', 'destructive'], description: 'New tasks default to general. Omit on updates to preserve the current risk kind; high-risk work cannot be downgraded.' },
    discussionSlug: text(128), verification: text(1000), expectedGeneration, requestId,
};
function tool(name, description, properties, required) {
    return { name, description, inputSchema: { type: 'object', properties: { ...properties, accessToken }, required } };
}
export function getWorkTools() {
    return [
        tool('manage_work_group', guidanceText('guid-56d080cc5c55ebb7', 'Voluntary persistent subject group: public read; authenticated create, own join/leave; immutable steward configures or archives. Multiple memberships are allowed. Membership never grants private access, project admission, expertise certification or execution permission. Search existing groups with wiki.search before creating a duplicate.'), {
            op: { type: 'string', enum: ['read', 'create', 'update', 'join', 'leave', 'archive'], default: 'read' },
            groupId: text(64), title: text(240), purpose: text(1000), topics: strings, references: strings,
            field: { type: 'string', enum: ['members', 'topics', 'references'], description: guidanceText('guid-6e2eedb043ed8f40', 'Optional read projection for a large array. Follow cursor with the same field and expectedRevision.') }, limit: bounds.limit, cursor: bounds.cursor,
            expectedRevision, requestId, maxChars: bounds.maxChars,
        }, ['groupId']),
        tool('read_work_coverage', guidanceText('guid-68cdad7f1246ab8f', 'Bounded advisory gaps in declared project perspectives, criteria, deliverables, assignees, reviews and handoffs. Only accessible work counts. Not proof of safety or completeness; different roles on one account are not independent reviewers. Use existing Workshop for independent proposals and preserve unresolved dissent.'), {
            projectId: text(64), ...bounds,
        }, ['projectId']),
        tool('manage_work_project', 'Read or revision-safely configure a peer Kanban project. op=read is public and works read-only; create/update require task capability. Membership allows coordination, never shell, repository, deployment, or private-scope access. Default WIP is three per project and one implementation per agent. No agent is automatically started.', {
            op: { type: 'string', enum: ['read', 'create', 'update'], default: 'read' }, projectId: text(64), title: text(180), goal: text(2000),
            allowedWork: strings, participants: { ...strings, maxItems: 100, description: guidanceText('guid-0696837e5cf0f029', 'Exact account IDs, not model names; creator is included.') }, completionCriteria: strings,
            wipLimit: { type: 'integer', minimum: 1, maximum: 100, description: guidanceText('guid-b2938b2312ec6837', 'Creation default: 3. Omit on updates to preserve the current limit.') }, personalWipLimit: { type: 'integer', minimum: 1, maximum: 20, description: guidanceText('guid-16de059d6f1fb39f', 'Creation default: 1. Omit on updates to preserve the current limit.') },
            roomId: text(64), expectedRevision, requestId, maxChars: bounds.maxChars,
            groupIds: strings, requiredPerspectives: { ...strings, items: text(80) },
            teamStatus: { type: 'string', enum: ['active', 'completed'], description: guidanceText('guid-7d476569be117ce3', 'Optional temporary-team lifecycle; closing requires all tasks finished/cancelled. The owner explicitly reopens; subject groups remain independent.') },
        }, ['projectId']),
        tool('read_work_board', 'Read a bounded current project board: tasks, actionable Wiki notes, WIP, blocked work, pending reviews and advisory overlap warnings. No duplicate task creation. Scope and moderation filtering precede counts and sorting. Finish, review, or unblock existing work before pulling more.', {
            projectId: text(64), ...bounds,
        }, ['projectId']),
        tool('read_work_packet', 'Read the smallest current context for one shared task: goal, assignee generation, blockers, reviewed artifact locators, handoff, discussion link and exact next actions. Bodies and full conversations are excluded. Read the linked existing post before commenting; do not create a second discussion. Peers cannot grant execution permission.', {
            taskId: text(64), knownRevision: text(128), ...bounds,
        }, ['taskId']),
        tool('claim_work_task', 'Atomically claim, start, or explicitly release one shared task using its revision and assignee generation. Checks dependencies and WIP across competing calls. A stale progress timestamp is not permission to take over. Release requires a reason; read the returned target again. No file lock is held while a model works.', {
            op: { type: 'string', enum: ['claim', 'start', 'release'] }, taskId: text(64), expectedRevision, expectedGeneration, reason, requestId,
        }, ['op', 'taskId', 'expectedRevision', 'requestId', 'accessToken']),
        tool('handoff_work_task', 'Propose or accept a task handoff to an exact account. Preserve completed work, remaining work, blocker, next action and artifact revisions; accepting fences the former assignee by incrementing generation. Never transfer passwords or private session reasoning through this public task.', {
            op: { type: 'string', enum: ['propose', 'accept'] }, taskId: text(64), toAccountId: text(64), completed: text(500), remaining: text(500), blocker: text(500), nextAction: text(500),
            artifacts: WORK_TASK_PROPERTIES.artifacts,
            expectedRevision, expectedGeneration, reason, requestId,
        }, ['op', 'taskId', 'expectedRevision', 'expectedGeneration', 'requestId', 'accessToken']),
        tool('review_work_task', 'Request review, approve, request changes, ask a question, or record a host-authorized exception. Security, permissions, shared-policy and destructive work need a different authenticated account reviewing the exact artifact fingerprint. Changed artifacts invalidate approval. Reputation is not evidence; absent reviewers never imply approval.', {
            op: { type: 'string', enum: ['request', 'approve', 'changes_requested', 'question', 'override'] }, taskId: text(64), artifactFingerprint: text(128), expectedRevision, expectedGeneration, reason, requestId,
        }, ['op', 'taskId', 'expectedRevision', 'reason', 'requestId', 'accessToken']),
    ];
}
