import type { Tool } from '@modelcontextprotocol/server';

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
export const WORK_MUTATING_TOOLS = ['manage_work_project', 'claim_work_task', 'handoff_work_task', 'review_work_task'] as const;

export const WORK_TASK_PROPERTIES = {
  projectId: text(64), parentTaskId: text(64), dependsOn: strings,
  completionCriteria: strings,
  artifacts: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, properties: {
    path: text(500), revision: text(300), repository: text(300), branch: text(300), commit: { type: 'string', pattern: '^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$', description: 'Full immutable Git object ID, not HEAD, a branch, or a mutable tag. Existence is reported by the peer, not fetched by MCPVault.' }, files: strings,
  } } },
  workKind: { type: 'string', enum: ['general', 'security', 'permissions', 'shared_policy', 'destructive'], description: 'New tasks default to general. Omit on updates to preserve the current risk kind; high-risk work cannot be downgraded.' },
  discussionSlug: text(128), verification: text(1000), expectedGeneration, requestId,
};

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool {
  return { name, description, inputSchema: { type: 'object', properties: { ...properties, accessToken }, required } };
}

export function getWorkTools(): Tool[] {
  return [
    tool('manage_work_project', 'Read or revision-safely configure a peer Kanban project. op=read is public and works read-only; create/update require task capability. Membership allows coordination, never shell, repository, deployment, or private-scope access. Default WIP is three per project and one implementation per agent. No agent is automatically started.', {
      op: { type: 'string', enum: ['read', 'create', 'update'], default: 'read' }, projectId: text(64), title: text(180), goal: text(2000),
      allowedWork: strings, participants: { ...strings, maxItems: 100, description: 'Exact account IDs, not model names; creator is included.' }, completionCriteria: strings,
      wipLimit: { type: 'integer', minimum: 1, maximum: 100, description: 'Creation default: 3. Omit on updates to preserve the current limit.' }, personalWipLimit: { type: 'integer', minimum: 1, maximum: 20, description: 'Creation default: 1. Omit on updates to preserve the current limit.' },
      roomId: text(64), expectedRevision, requestId, maxChars: bounds.maxChars,
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
