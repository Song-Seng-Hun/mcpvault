import { randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
const ROOT = 'Community/Tasks';
export const AGENT_TASK_STATUSES = ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'];
const taskPath = (taskId) => `${ROOT}/${normalizeScopeId(taskId, 'taskId')}.md`;
const identity = (principal) => principal.agentId || principal.modelId;
const now = () => new Date().toISOString();
function shortText(value, field, maximum, required = false) {
    const text = String(value ?? '').trim();
    if (required && !text)
        throw new Error(`${field} is required`);
    if (Array.from(text).length > maximum)
        throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
    return text;
}
function taskStatus(value, fallback = 'proposed') {
    const status = String(value || fallback).trim().toLowerCase();
    if (!AGENT_TASK_STATUSES.includes(status))
        throw new Error(`status must be one of: ${AGENT_TASK_STATUSES.join(', ')}`);
    return status;
}
function requireLogin(principal) {
    if (!principal)
        throw new Error('Login is required for agent tasks');
    return principal;
}
export class AgentTaskService {
    fileSystem;
    references;
    auth;
    constructor(fileSystem, references, auth) {
        this.fileSystem = fileSystem;
        this.references = references;
        this.auth = auth;
    }
    async assignee(value) {
        if (!value)
            return undefined;
        const id = normalizeScopeId(String(value), 'assignee');
        const found = (await this.auth.listPrincipals()).some(principal => (principal.agentId || principal.modelId) === id);
        if (!found)
            throw new Error(`No registered model or agent identity found for assignee: ${id}`);
        return id;
    }
    async create(params) {
        const principal = requireLogin(params.principal);
        const title = shortText(params.title, 'title', 180, true);
        const description = shortText(params.description, 'description', 4000, true);
        const taskId = params.taskId ? normalizeScopeId(params.taskId, 'taskId') : `task-${randomUUID().slice(0, 12)}`;
        const path = taskPath(taskId);
        if (params.expectedRevision && params.expectedRevision !== 'missing')
            throw new Error('A new task must use expectedRevision=missing');
        const assignee = await this.assignee(params.assignee);
        const refs = await this.references.validateAndNormalize(params.references, path, principal, params.description);
        const timestamp = now();
        await this.fileSystem.writeNote({
            path,
            content: `# ${title}\n\n${description}\n`,
            frontmatter: {
                mcpvault_type: 'agent_task', task_id: taskId, title, description,
                requester: identity(principal), requester_role: principal.role,
                ...(assignee && { assignee }), status: 'proposed', references: refs,
                created_at: timestamp, updated_at: timestamp,
            },
            expectedRevision: 'missing',
        });
        const note = await this.fileSystem.readNote(path);
        return { success: true, taskId, path, status: 'proposed', revision: note.revision };
    }
    async read(params) {
        const taskId = normalizeScopeId(params.taskId, 'taskId');
        const path = taskPath(taskId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'agent_task')
            throw new Error(`Not an agent task: ${taskId}`);
        return {
            path, fm: note.frontmatter, revision: note.revision,
            ...(params.includeContent !== false && { content: note.content }),
            resolvedReferences: await this.references.resolve(note.frontmatter.references, undefined, params.includeContent === true, Math.min(Math.max(Number(params.referenceLimit ?? 10), 1), 50), Math.min(Math.max(Number(params.referenceMaxChars ?? 4000), 1), 20000)),
        };
    }
    async list(params) {
        const filters = { mcpvault_type: 'agent_task' };
        if (params.status)
            filters.status = taskStatus(params.status);
        if (params.assignee)
            filters.assignee = normalizeScopeId(params.assignee, 'assignee');
        if (params.requester)
            filters.requester = normalizeScopeId(params.requester, 'requester');
        const result = await this.fileSystem.queryNotes({ pathPrefix: ROOT, filters, sortBy: 'updated_at', sortOrder: 'desc', limit: 500 });
        const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 500);
        return {
            tasks: result.notes.slice(0, limit).map(note => ({
                path: note.path, taskId: note.frontmatter.task_id, title: note.frontmatter.title,
                requester: note.frontmatter.requester, assignee: note.frontmatter.assignee,
                status: taskStatus(note.frontmatter.status), updatedAt: note.frontmatter.updated_at,
                revision: undefined,
            })),
            total: result.total, truncated: result.truncated || result.notes.length > limit,
        };
    }
    async update(params) {
        const principal = requireLogin(params.principal);
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the task first');
        const taskId = normalizeScopeId(params.taskId, 'taskId');
        const path = taskPath(taskId);
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== 'agent_task')
            throw new Error(`Not an agent task: ${taskId}`);
        const actor = identity(principal);
        const requester = String(note.frontmatter.requester || '');
        const currentAssignee = String(note.frontmatter.assignee || '');
        const requestedAssignee = params.assignee === undefined ? currentAssignee : ((await this.assignee(params.assignee)) || '');
        if (actor !== requester && actor !== currentAssignee && !(!currentAssignee && requestedAssignee === actor)) {
            throw new Error('Only the task requester or assignee can update this task');
        }
        const status = taskStatus(params.status, taskStatus(note.frontmatter.status));
        const previousStatus = taskStatus(note.frontmatter.status);
        const reason = shortText(params.reason, 'reason', 500);
        if (status !== previousStatus && !reason)
            throw new Error('reason is required when changing task status');
        const description = params.description === undefined ? String(note.frontmatter.description || note.content).trim() : shortText(params.description, 'description', 4000, true);
        const refs = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, path, principal, params.description);
        const timestamp = now();
        const frontmatter = {
            ...note.frontmatter, description,
            ...(requestedAssignee ? { assignee: requestedAssignee } : {}),
            status, references: refs, updated_at: timestamp,
            ...(status !== previousStatus && { status_reason: reason, status_changed_by: actor, status_changed_at: timestamp }),
        };
        if (!requestedAssignee)
            delete frontmatter.assignee;
        await this.fileSystem.writeNote({
            path,
            content: `# ${String(note.frontmatter.title || taskId)}\n\n${description}\n`,
            frontmatter,
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, taskId, status, assignee: requestedAssignee || undefined, reason: status !== previousStatus ? reason : undefined, revision: updated.revision };
    }
}
