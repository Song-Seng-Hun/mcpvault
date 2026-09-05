import { randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { iterateNotes, queryWindow } from './paged-query.js';
import { isModerationHidden } from './moderation-policy.js';
import { COMPLETION_DISPOSITION_REQUIRED_MESSAGE, hasExplicitKnowledgeDisposition, normalizeKnowledgeDisposition } from './organization.js';

const ROOT = 'Community/Tasks';
export const AGENT_TASK_STATUSES = ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];

const taskPath = (taskId: string) => `${ROOT}/${normalizeScopeId(taskId, 'taskId')}.md`;
const identity = (principal: ScopePrincipal) => principal.agentId || principal.modelId;
const now = () => new Date().toISOString();
const ASSIGNED_OPEN_STATUS_ORDER = ['in_progress', 'accepted', 'proposed', 'blocked'] as const;

function shortText(value: unknown, field: string, maximum: number, required = false): string {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${field} is required`);
  if (Array.from(text).length > maximum) throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
  return text;
}

function taskStatus(value: unknown, fallback: AgentTaskStatus = 'proposed'): AgentTaskStatus {
  const status = String(value || fallback).trim().toLowerCase() as AgentTaskStatus;
  if (!(AGENT_TASK_STATUSES as readonly string[]).includes(status)) throw new Error(`status must be one of: ${AGENT_TASK_STATUSES.join(', ')}`);
  return status;
}

function requireLogin(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw new Error('Login is required for agent tasks');
  return principal;
}

export class AgentTaskService {
  constructor(private readonly fileSystem: FileSystemService, private readonly references: ReferenceService, private readonly auth: ScopeAuthService) {}

  private async validatedKnowledgeNotes(
    value: unknown,
    containerPath: string,
    principal: ScopePrincipal,
    expected: 'durable' | 'negative',
  ): Promise<string[] | undefined> {
    if (value === undefined) return undefined;
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
    } catch {
      const label = expected === 'negative' ? 'negativeKnowledgeNotes' : 'knowledgeNotes';
      throw new Error(`All ${label} must identify visible public ${expected === 'negative' ? 'negative ' : ''}knowledge notes`);
    }
  }

  private async assignee(value: unknown): Promise<string | undefined> {
    if (!value) return undefined;
    const id = normalizeScopeId(String(value), 'assignee');
    const found = (await this.auth.listPrincipals()).some(principal => (principal.agentId || principal.modelId) === id);
    if (!found) throw new Error(`No registered model or agent identity found for assignee: ${id}`);
    return id;
  }

  async create(params: { principal?: ScopePrincipal; taskId?: string; title: string; description: string; assignee?: string; references?: unknown; expectedRevision?: string }) {
    const principal = requireLogin(params.principal);
    const title = shortText(params.title, 'title', 180, true);
    const description = shortText(params.description, 'description', 4000, true);
    const taskId = params.taskId ? normalizeScopeId(params.taskId, 'taskId') : `task-${randomUUID().slice(0, 12)}`;
    const path = taskPath(taskId);
    if (params.expectedRevision && params.expectedRevision !== 'missing') throw new Error('A new task must use expectedRevision=missing');
    const assignee = await this.assignee(params.assignee);
    const refs = await this.references.validateAndNormalize(params.references, path, principal, params.description);
    const timestamp = now();
    const receipt = await this.fileSystem.writeNoteWithReceipt({
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
    return { success: true, taskId, path, status: 'proposed', revision: receipt.revision };
  }

  async read(params: { taskId: string; includeContent?: boolean; referenceLimit?: number; referenceMaxChars?: number }) {
    const taskId = normalizeScopeId(params.taskId, 'taskId');
    const path = taskPath(taskId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'agent_task') throw new Error(`Not an agent task: ${taskId}`);
    return {
      path, fm: note.frontmatter, revision: note.revision,
      ...(params.includeContent !== false && { content: note.content }),
      resolvedReferences: await this.references.resolve(note.frontmatter.references, undefined, params.includeContent === true, Math.min(Math.max(Number(params.referenceLimit ?? 10), 1), 50), Math.min(Math.max(Number(params.referenceMaxChars ?? 4000), 1), 20000)),
    };
  }

  async list(params: { status?: string; assignee?: string; requester?: string; limit?: number; maxChars?: number }) {
    const filters: Record<string, unknown> = { mcpvault_type: 'agent_task' };
    if (params.status) filters.status = taskStatus(params.status);
    if (params.assignee) filters.assignee = normalizeScopeId(params.assignee, 'assignee');
    if (params.requester) filters.requester = normalizeScopeId(params.requester, 'requester');
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

  async listAssignedOpen(params: { assignee: string; limit?: number; maxChars?: number }) {
    const assignee = normalizeScopeId(params.assignee, 'assignee');
    const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 20);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 20000);
    const statusCounts: Record<typeof ASSIGNED_OPEN_STATUS_ORDER[number], number> = {
      in_progress: 0,
      accepted: 0,
      proposed: 0,
      blocked: 0,
    };
    const rank = new Map<string, number>(ASSIGNED_OPEN_STATUS_ORDER.map((status, index) => [status, index]));
    const compare = (left: { taskId: string; status: string; updatedAt: string }, right: { taskId: string; status: string; updatedAt: string }) => {
      const statusDifference = (rank.get(String(left.status)) ?? rank.size) - (rank.get(String(right.status)) ?? rank.size);
      if (statusDifference !== 0) return statusDifference;
      const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
      return updatedDifference || left.taskId.localeCompare(right.taskId);
    };
    const selected: Array<{ taskId: string; status: typeof ASSIGNED_OPEN_STATUS_ORDER[number]; updatedAt: string }> = [];
    let total = 0;
    for await (const note of iterateNotes(this.fileSystem, {
      pathPrefix: ROOT,
      filters: { mcpvault_type: 'agent_task', assignee },
      sortBy: 'path',
      sortOrder: 'asc',
      includeContent: false,
    })) {
      const rawStatus = String(note.frontmatter.status || '').trim().toLowerCase();
      if (!(ASSIGNED_OPEN_STATUS_ORDER as readonly string[]).includes(rawStatus)) continue;
      let taskId: string;
      try {
        taskId = normalizeScopeId(String(note.frontmatter.task_id || ''), 'taskId');
      } catch {
        continue;
      }
      const status = rawStatus as typeof ASSIGNED_OPEN_STATUS_ORDER[number];
      statusCounts[status] += 1;
      total += 1;
      selected.push({ taskId, status, updatedAt: String(note.frontmatter.updated_at || '') });
      selected.sort(compare);
      if (selected.length > limit) selected.pop();
    }
    const bounded = boundItems(selected.map(task => ({ taskId: task.taskId, status: task.status })), maxChars);
    return {
      tasks: bounded.items,
      statusCounts,
      total,
      truncated: total > bounded.items.length || bounded.truncated,
    };
  }

  async update(params: {
    principal?: ScopePrincipal;
    taskId: string;
    status?: string;
    assignee?: string;
    description?: string;
    references?: unknown;
    reason?: string;
    retrospective?: string;
    knowledgeNotes?: unknown;
    negativeKnowledgeNotes?: unknown;
    noReusableKnowledge?: boolean;
    knowledgeDispositionReason?: string;
    expectedRevision: string;
  }) {
    const principal = requireLogin(params.principal);
    if (!params.expectedRevision) throw new Error('expectedRevision is required; read the task first');
    const taskId = normalizeScopeId(params.taskId, 'taskId');
    const path = taskPath(taskId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'agent_task') throw new Error(`Not an agent task: ${taskId}`);
    const actor = identity(principal);
    const requester = String(note.frontmatter.requester || '');
    const currentAssignee = String(note.frontmatter.assignee || '');
    const requestedAssignee = params.assignee === undefined ? currentAssignee : ((await this.assignee(params.assignee)) || '');
    if (actor !== requester && actor !== currentAssignee && !( !currentAssignee && requestedAssignee === actor)) {
      throw new Error('Only the task requester or assignee can update this task');
    }
    const status = taskStatus(params.status, taskStatus(note.frontmatter.status));
    const previousStatus = taskStatus(note.frontmatter.status);
    const reason = shortText(params.reason, 'reason', 500);
    if (status !== previousStatus && !reason) throw new Error('reason is required when changing task status');
    const description = params.description === undefined ? String(note.frontmatter.description || note.content).trim() : shortText(params.description, 'description', 4000, true);
    const refs = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, path, principal, params.description);
    const knowledgeNotes = await this.validatedKnowledgeNotes(
      params.knowledgeNotes === undefined ? note.frontmatter.knowledge_notes : params.knowledgeNotes,
      path,
      principal,
      'durable',
    );
    const negativeKnowledgeNotes = await this.validatedKnowledgeNotes(
      params.negativeKnowledgeNotes === undefined ? note.frontmatter.negative_knowledge_notes : params.negativeKnowledgeNotes,
      path,
      principal,
      'negative',
    );
    const disposition = normalizeKnowledgeDisposition({
      ...(params.retrospective !== undefined && { retrospective: params.retrospective }),
      ...(knowledgeNotes !== undefined && { knowledgeNotes }),
      ...(negativeKnowledgeNotes !== undefined && { negativeKnowledgeNotes }),
      ...(params.noReusableKnowledge !== undefined && { noReusableKnowledge: params.noReusableKnowledge }),
      ...(params.knowledgeDispositionReason !== undefined && { knowledgeDispositionReason: params.knowledgeDispositionReason }),
    }, note.frontmatter);
    const completionDispositionRequired = status === 'completed'
      && (previousStatus !== 'completed' || hasExplicitKnowledgeDisposition(params));
    if (completionDispositionRequired && disposition.knowledgeDispositions.length === 0) throw new Error(COMPLETION_DISPOSITION_REQUIRED_MESSAGE);
    const timestamp = now();
    const frontmatter: Record<string, any> = {
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
    if (!requestedAssignee) delete frontmatter.assignee;
    if (!disposition.retrospective) delete frontmatter.retrospective;
    if (!disposition.noReusableKnowledge) delete frontmatter.knowledge_disposition_reason;
    const receipt = await this.fileSystem.writeNoteWithReceipt({
      path,
      content: `# ${String(note.frontmatter.title || taskId)}\n\n${description}\n`,
      frontmatter,
      expectedRevision: params.expectedRevision,
    });
    // These normalized disposition values belong to this write. A later read
    // could combine another editor's lesson with our completion status.
    return {
      success: true,
      taskId,
      status,
      assignee: requestedAssignee || undefined,
      reason: status !== previousStatus ? reason : undefined,
      ...(frontmatter.retrospective && { retrospective: frontmatter.retrospective }),
      ...(frontmatter.knowledge_notes && { knowledgeNotes: frontmatter.knowledge_notes }),
      ...(frontmatter.negative_knowledge_notes && { negativeKnowledgeNotes: frontmatter.negative_knowledge_notes }),
      ...(frontmatter.knowledge_dispositions && { knowledgeDispositions: frontmatter.knowledge_dispositions }),
      ...(frontmatter.knowledge_disposition_reason && { knowledgeDispositionReason: frontmatter.knowledge_disposition_reason }),
      revision: receipt.revision,
    };
  }
}
