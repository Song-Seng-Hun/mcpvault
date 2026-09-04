import { randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { iterateNotes, queryWindow } from './paged-query.js';
import { isModerationHidden } from './moderation-policy.js';
import { COMPLETION_DISPOSITION_REQUIRED_MESSAGE, hasExplicitKnowledgeDisposition, normalizeKnowledgeDisposition } from './organization.js';
const ROOT = 'Community/Tasks';
export const AGENT_TASK_STATUSES = ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'];
const taskPath = (taskId) => `${ROOT}/${normalizeScopeId(taskId, 'taskId')}.md`;
const identity = (principal) => principal.agentId || principal.modelId;
const now = () => new Date().toISOString();
const ASSIGNED_OPEN_STATUS_ORDER = ['in_progress', 'accepted', 'proposed', 'blocked'];
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
    async validatedKnowledgeNotes(value, containerPath, principal, expected) {
        if (value === undefined)
            return undefined;
        try {
            const paths = (await this.references.validateAndNormalize(value, containerPath, principal)).slice(0, 20);
            for (const path of paths) {
                const note = await this.fileSystem.readNote(path);
                const isKnowledge = String(note.frontmatter.llm_wiki_type || '').trim().toLowerCase() === 'knowledge';
                const isNegative = String(note.frontmatter.knowledge_polarity || '').trim().toLowerCase() === 'negative';
                if (!isKnowledge || isModerationHidden(note.frontmatter) || (expected === 'negative' ? !isNegative : isNegative)) {
                    throw new Error('wrong knowledge role');
                }
            }
            return paths;
        }
        catch {
            const label = expected === 'negative' ? 'negativeKnowledgeNotes' : 'knowledgeNotes';
            throw new Error(`All ${label} must identify visible public ${expected === 'negative' ? 'negative ' : ''}knowledge notes`);
        }
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
        const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 500);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000);
        const [window, total] = await Promise.all([
            queryWindow(this.fileSystem, { pathPrefix: ROOT, filters, sortBy: 'updated_at', sortOrder: 'desc', limit }),
            this.fileSystem.countNotes({ pathPrefix: ROOT, filters }),
        ]);
        const bounded = boundItems(window.notes.map(note => ({
            path: note.path, taskId: note.frontmatter.task_id, title: note.frontmatter.title,
            requester: note.frontmatter.requester, assignee: note.frontmatter.assignee,
            status: taskStatus(note.frontmatter.status), updatedAt: note.frontmatter.updated_at,
            revision: undefined,
        })), maxChars);
        return { tasks: bounded.items, total, truncated: window.truncated || total > window.notes.length || bounded.truncated };
    }
    async listAssignedOpen(params) {
        const assignee = normalizeScopeId(params.assignee, 'assignee');
        const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 20);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000);
        const statusCounts = {
            in_progress: 0,
            accepted: 0,
            proposed: 0,
            blocked: 0,
        };
        const rank = new Map(ASSIGNED_OPEN_STATUS_ORDER.map((status, index) => [status, index]));
        const compare = (left, right) => {
            const statusDifference = (rank.get(String(left.status)) ?? rank.size) - (rank.get(String(right.status)) ?? rank.size);
            if (statusDifference !== 0)
                return statusDifference;
            const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
            return updatedDifference || left.taskId.localeCompare(right.taskId);
        };
        const selected = [];
        let total = 0;
        for await (const note of iterateNotes(this.fileSystem, {
            pathPrefix: ROOT,
            filters: { mcpvault_type: 'agent_task', assignee },
            sortBy: 'path',
            sortOrder: 'asc',
            includeContent: false,
        })) {
            const rawStatus = String(note.frontmatter.status || '').trim().toLowerCase();
            if (!ASSIGNED_OPEN_STATUS_ORDER.includes(rawStatus))
                continue;
            let taskId;
            try {
                taskId = normalizeScopeId(String(note.frontmatter.task_id || ''), 'taskId');
            }
            catch {
                continue;
            }
            const status = rawStatus;
            statusCounts[status] += 1;
            total += 1;
            selected.push({ taskId, status, updatedAt: String(note.frontmatter.updated_at || '') });
            selected.sort(compare);
            if (selected.length > limit)
                selected.pop();
        }
        const bounded = boundItems(selected.map(task => ({ taskId: task.taskId, status: task.status })), maxChars);
        return {
            tasks: bounded.items,
            statusCounts,
            total,
            truncated: total > bounded.items.length || bounded.truncated,
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
        const knowledgeNotes = await this.validatedKnowledgeNotes(params.knowledgeNotes === undefined ? note.frontmatter.knowledge_notes : params.knowledgeNotes, path, principal, 'durable');
        const negativeKnowledgeNotes = await this.validatedKnowledgeNotes(params.negativeKnowledgeNotes === undefined ? note.frontmatter.negative_knowledge_notes : params.negativeKnowledgeNotes, path, principal, 'negative');
        const disposition = normalizeKnowledgeDisposition({
            ...(params.retrospective !== undefined && { retrospective: params.retrospective }),
            ...(knowledgeNotes !== undefined && { knowledgeNotes }),
            ...(negativeKnowledgeNotes !== undefined && { negativeKnowledgeNotes }),
            ...(params.noReusableKnowledge !== undefined && { noReusableKnowledge: params.noReusableKnowledge }),
            ...(params.knowledgeDispositionReason !== undefined && { knowledgeDispositionReason: params.knowledgeDispositionReason }),
        }, note.frontmatter);
        const completionDispositionRequired = status === 'completed'
            && (previousStatus !== 'completed' || hasExplicitKnowledgeDisposition(params));
        if (completionDispositionRequired && disposition.knowledgeDispositions.length === 0)
            throw new Error(COMPLETION_DISPOSITION_REQUIRED_MESSAGE);
        const timestamp = now();
        const frontmatter = {
            ...note.frontmatter, description,
            ...(requestedAssignee ? { assignee: requestedAssignee } : {}),
            status, references: refs, updated_at: timestamp,
            ...(status !== previousStatus && { status_reason: reason, status_changed_by: actor, status_changed_at: timestamp }),
            ...(disposition.retrospective && { retrospective: disposition.retrospective }),
            ...(disposition.knowledgeNotes !== undefined && { knowledge_notes: disposition.knowledgeNotes }),
            ...(disposition.negativeKnowledgeNotes !== undefined && { negative_knowledge_notes: disposition.negativeKnowledgeNotes }),
            knowledge_dispositions: disposition.knowledgeDispositions,
            ...(disposition.knowledgeDispositionReason && { knowledge_disposition_reason: disposition.knowledgeDispositionReason }),
        };
        if (!requestedAssignee)
            delete frontmatter.assignee;
        if (!disposition.retrospective)
            delete frontmatter.retrospective;
        if (!disposition.noReusableKnowledge)
            delete frontmatter.knowledge_disposition_reason;
        await this.fileSystem.writeNote({
            path,
            content: `# ${String(note.frontmatter.title || taskId)}\n\n${description}\n`,
            frontmatter,
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return {
            success: true,
            taskId,
            status,
            assignee: requestedAssignee || undefined,
            reason: status !== previousStatus ? reason : undefined,
            ...(updated.frontmatter.retrospective && { retrospective: updated.frontmatter.retrospective }),
            ...(updated.frontmatter.knowledge_notes && { knowledgeNotes: updated.frontmatter.knowledge_notes }),
            ...(updated.frontmatter.negative_knowledge_notes && { negativeKnowledgeNotes: updated.frontmatter.negative_knowledge_notes }),
            ...(updated.frontmatter.knowledge_dispositions && { knowledgeDispositions: updated.frontmatter.knowledge_dispositions }),
            ...(updated.frontmatter.knowledge_disposition_reason && { knowledgeDispositionReason: updated.frontmatter.knowledge_disposition_reason }),
            revision: updated.revision,
        };
    }
}
