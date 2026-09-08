import { guidanceError } from './guidance-runtime.js';
import { randomUUID } from 'node:crypto';
import { KnowledgeApplicationService } from './knowledge-applications.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { iterateNotes } from './paged-query.js';
import { isModerationHidden } from './moderation-policy.js';
import { COMPLETION_DISPOSITION_REQUIRED_MESSAGE, normalizeKnowledgeDisposition } from './organization.js';
import type { NoteWriteParams } from './types.js';

export interface WorkArtifact { path?: string; revision?: string; repository?: string; branch?: string; commit?: string; files?: string[] }
export interface AgentTaskWorkFields {
  projectId?: string; parentTaskId?: string; dependsOn?: string[]; completionCriteria?: string[];
  artifacts?: WorkArtifact[]; workKind?: 'general' | 'security' | 'permissions' | 'shared_policy' | 'destructive';
  discussionSlug?: string; verification?: string; expectedGeneration?: number; requestId?: string;
}
export interface AgentTaskWriteContext {
  frontmatter: Record<string, any>;
  removeFields?: string[];
  authorize: boolean;
  write(params: NoteWriteParams, guards?: Array<{ path: string; expectedRevision: string }>): Promise<{ revision: string }>;
}
export interface AgentTaskExtension {
  run(action: 'create' | 'update', params: any, proceed: (context?: AgentTaskWriteContext, parameters?: any) => Promise<any>): Promise<any>;
}

const ROOT = 'Community/Tasks';
export const AGENT_TASK_STATUSES = ['proposed', 'accepted', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'] as const;
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];

const taskPath = (taskId: string) => `${ROOT}/${normalizeScopeId(taskId, 'taskId')}.md`;
const identity = (principal: ScopePrincipal) => principal.agentId || principal.modelId;
const now = () => new Date().toISOString();
const ASSIGNED_OPEN_STATUS_ORDER = ['in_progress', 'accepted', 'proposed', 'blocked', 'in_review'] as const;

function shortText(value: unknown, field: string, maximum: number, required = false): string {
  const text = String(value ?? '').trim();
  if (required && !text) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  if (Array.from(text).length > maximum) throw guidanceError(new Error(`${field} must be ${maximum} Unicode characters or fewer`), 'guid-ece47846ed48d00b');
  return text;
}

export function taskStatus(value: unknown, fallback: AgentTaskStatus = 'proposed'): AgentTaskStatus {
  const status = String(value || fallback).trim().toLowerCase() as AgentTaskStatus;
  if (!(AGENT_TASK_STATUSES as readonly string[]).includes(status)) throw guidanceError(new Error(`status must be one of: ${AGENT_TASK_STATUSES.join(', ')}`), 'guid-1db866eb6c05257d');
  return status;
}

function requireLogin(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw guidanceError(new Error('Login is required for agent tasks'), 'guid-85ae8df66c1ceb2b');
  return principal;
}

export class AgentTaskService {
  private workExtension?: AgentTaskExtension;
  attachWorkExtension(extension: AgentTaskExtension): void { this.workExtension = extension; }
  constructor(private readonly fileSystem: FileSystemService, private readonly references: ReferenceService, private readonly auth: ScopeAuthService, private readonly access = new ScopeAccessPolicy()) {}

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
          throw guidanceError(new Error('wrong knowledge role'), 'guid-ba8286bb47c4a293');
        }
      }
      return paths;
    } catch {
      const label = expected === 'negative' ? 'negativeKnowledgeNotes' : 'knowledgeNotes';
      throw guidanceError(new Error(`All ${label} must identify visible public ${expected === 'negative' ? 'negative ' : ''}knowledge notes`), 'guid-b8b3bf794bab8f42');
    }
  }

  private async assignee(value: unknown): Promise<string | undefined> {
    if (!value) return undefined;
    const id = normalizeScopeId(String(value), 'assignee');
    const found = (await this.auth.listPrincipals()).some(principal => (principal.agentId || principal.modelId) === id);
    if (!found) throw guidanceError(new Error(`No registered model or agent identity found for assignee: ${id}`), 'guid-ac79dc79359982bf');
    return id;
  }

  private async assigneeAccount(assignee?: string): Promise<string | undefined> {
    if (!assignee) return undefined;
    const matches = (await this.auth.listPrincipals()).filter(p => identity(p) === assignee);
    if (matches.length !== 1) throw guidanceError(new Error('Assignee must resolve to exactly one registered account'), 'guid-5e48eef7d2ff7f31');
    return matches[0]!.accountId;
  }

  async create(params: AgentTaskWorkFields & { principal?: ScopePrincipal; taskId?: string; title: string; description: string; assignee?: string; references?: unknown; expectedRevision?: string }): Promise<any> {
    if (this.workExtension) return this.workExtension.run('create', params, (context, parameters) => this.createCore(parameters || params, context));
    return this.createCore(params);
  }

  private async createCore(params: AgentTaskWorkFields & { principal?: ScopePrincipal; taskId?: string; title: string; description: string; assignee?: string; references?: unknown; expectedRevision?: string }, context?: AgentTaskWriteContext) {
    if (params.projectId && !context) throw guidanceError(new Error('Project guard requires WorkService'), 'guid-27a23b6c2e345129');
    const principal = requireLogin(params.principal);
    const title = shortText(params.title, 'title', 180, true);
    const description = shortText(params.description, 'description', 4000, true);
    const taskId = params.taskId ? normalizeScopeId(params.taskId, 'taskId') : `task-${randomUUID().slice(0, 12)}`;
    const path = taskPath(taskId);
    if (params.expectedRevision && params.expectedRevision !== 'missing') throw guidanceError(new Error('A new task must use expectedRevision=missing'), 'guid-b2965916398ac861');
    const assignee = await this.assignee(params.assignee);
    const assigneeAccount = await this.assigneeAccount(assignee);
    const refs = await this.references.validateAndNormalize(params.references, path, principal, params.description);
    const timestamp = now();
    const receipt = await (context ? context.write.bind(context) : this.fileSystem.writeNoteWithReceipt.bind(this.fileSystem))({
      path,
      content: `# ${title}\n\n${description}\n`,
      frontmatter: {
        mcpvault_type: 'agent_task', task_id: taskId, title, description,
        requester: identity(principal), requester_role: principal.role,
        requester_account_id: principal.accountId,
        ...(assigneeAccount && { assignee_account_id: assigneeAccount }),
        ...(assignee && { assignee }), status: 'proposed', references: refs,
        created_at: timestamp, updated_at: timestamp,
        ...context?.frontmatter,
      },
      expectedRevision: 'missing',
    });
    return { success: true, taskId, path, status: 'proposed', revision: receipt.revision };
  }

  async read(params: { taskId: string; includeContent?: boolean; referenceLimit?: number; referenceMaxChars?: number }) {
    const taskId = normalizeScopeId(params.taskId, 'taskId');
    const path = taskPath(taskId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'agent_task') throw guidanceError(new Error(`Not an agent task: ${taskId}`), 'guid-9ad8c35d257ae412');
    if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error('Task is unavailable because moderation has hidden it'), 'guid-0869b6b64a63118b');
    return {
      path, fm: note.frontmatter, revision: note.revision,
      ...(typeof note.frontmatter.project_id === 'string' && note.frontmatter.project_id.length <= 64 && {
        workContext: {
          projectId: note.frontmatter.project_id,
          ...(Number.isSafeInteger(note.frontmatter.claim_generation) && note.frontmatter.claim_generation >= 0 && { expectedGeneration: note.frontmatter.claim_generation }),
          mutationRequires: ['requestId', 'expectedGeneration'],
        },
        nextAction: { tool: 'work.packet', arguments: { taskId } },
      }),
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
    const window = await this.fileSystem.queryNotes(
      { pathPrefix: ROOT, filters, sortBy: 'updated_at', sortOrder: 'desc', limit, includeContent: false, includeTotal: true },
      () => true, note => !isModerationHidden(note.frontmatter),
    );
    const total = window.total;
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
      in_review: 0,
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
      if (isModerationHidden(note.frontmatter)) continue;
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
    const { in_review, ...legacyCounts } = statusCounts;
    return {
      tasks: bounded.items,
      statusCounts: in_review ? statusCounts : legacyCounts,
      total,
      truncated: total > bounded.items.length || bounded.truncated,
    };
  }

  async update(params: AgentTaskWorkFields & {
    knowledgeApplications?: unknown;
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
  }): Promise<any> {
    if (this.workExtension) return this.workExtension.run('update', params, (context, parameters) => this.updateCore(parameters || params, context));
    return this.updateCore(params);
  }

  private async updateCore(params: Parameters<AgentTaskService['update']>[0], context?: AgentTaskWriteContext) {
    const principal = requireLogin(params.principal);
    if (!params.expectedRevision) throw guidanceError(new Error('expectedRevision is required; read the task first'), 'guid-eaca62caf85d0a39');
    const taskId = normalizeScopeId(params.taskId, 'taskId');
    const path = taskPath(taskId);
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== 'agent_task') throw guidanceError(new Error(`Not an agent task: ${taskId}`), 'guid-9ad8c35d257ae412');
    if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error('Task is unavailable because moderation has hidden it'), 'guid-0869b6b64a63118b');
    if ((note.frontmatter.project_id || params.projectId) && !context) throw guidanceError(new Error('Project guard requires WorkService'), 'guid-27a23b6c2e345129');
    const actor = identity(principal);
    const requester = String(note.frontmatter.requester || '');
    const currentAssignee = String(note.frontmatter.assignee || '');
    const requestedAssignee = params.assignee === undefined ? currentAssignee : ((await this.assignee(params.assignee)) || '');
    const accountOwnership = Boolean(note.frontmatter.requester_account_id);
    const requestedAccount = params.assignee === undefined ? note.frontmatter.assignee_account_id : await this.assigneeAccount(requestedAssignee);
    const authorized = accountOwnership
      ? principal.accountId === note.frontmatter.requester_account_id || principal.accountId === note.frontmatter.assignee_account_id
        || (!currentAssignee && requestedAccount === principal.accountId)
      : actor === requester || actor === currentAssignee || (!currentAssignee && requestedAssignee === actor);
    if (!context?.authorize && !authorized) {
      throw guidanceError(new Error('Only the task requester or assignee can update this task'), 'guid-f0e19158b99e5645');
    }
    const status = taskStatus(params.status, taskStatus(note.frontmatter.status));
    const previousStatus = taskStatus(note.frontmatter.status);
    const reason = shortText(params.reason, 'reason', 500);
    if (status !== previousStatus && !reason) throw guidanceError(new Error('reason is required when changing task status'), 'guid-b73002c9786be949');
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
    const completionDispositionRequired = status === 'completed';
    if (completionDispositionRequired && disposition.knowledgeDispositions.length === 0) throw new Error(COMPLETION_DISPOSITION_REQUIRED_MESSAGE);
    const applications = params.knowledgeApplications === undefined ? undefined
      : await new KnowledgeApplicationService(this.fileSystem, this.access).prepare(params.knowledgeApplications, path, principal);
    if (applications?.records.length && disposition.noReusableKnowledge) throw guidanceError(new Error('An application experience cannot be combined with noReusableKnowledge'), 'guid-59fe623d4c051bc7');
    const timestamp = now();
    const frontmatter: Record<string, any> = {
      ...note.frontmatter, description,
      ...(requestedAssignee ? { assignee: requestedAssignee } : {}),
      ...(accountOwnership && requestedAccount && { assignee_account_id: requestedAccount }),
      status, references: refs, updated_at: timestamp,
      ...(status !== previousStatus && { status_reason: reason, status_changed_by: actor, status_changed_at: timestamp }),
      ...(disposition.retrospective && { retrospective: disposition.retrospective }),
      ...(disposition.knowledgeNotes !== undefined && { knowledge_notes: disposition.knowledgeNotes }),
      ...(disposition.negativeKnowledgeNotes !== undefined && { negative_knowledge_notes: disposition.negativeKnowledgeNotes }),
      knowledge_dispositions: disposition.knowledgeDispositions,
      ...(applications && { knowledge_applications: applications.records }),
      ...(disposition.knowledgeDispositionReason && { knowledge_disposition_reason: disposition.knowledgeDispositionReason }),
      ...context?.frontmatter,
    };
    if (!requestedAssignee) delete frontmatter.assignee;
    if (accountOwnership && !requestedAssignee) delete frontmatter.assignee_account_id;
    if (!disposition.retrospective) delete frontmatter.retrospective;
    if (!disposition.noReusableKnowledge) delete frontmatter.knowledge_disposition_reason;
    for (const field of context?.removeFields || []) delete frontmatter[field];
    const write = {
      path,
      content: params.description === undefined ? note.content : `# ${String(note.frontmatter.title || taskId)}\n\n${description}\n`,
      frontmatter,
      expectedRevision: params.expectedRevision,
    };
    const receipt = context ? await context.write(write, applications?.guards)
      : applications?.guards.length ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, applications.guards)
        : await this.fileSystem.writeNoteWithReceipt(write);
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
