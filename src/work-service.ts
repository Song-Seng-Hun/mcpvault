import { posix } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { isActionableKnowledge } from './organization.js';
import { iterateNotes } from './paged-query.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { FrontmatterHandler } from './frontmatter.js';
import { taskStatus, type AgentTaskService, type AgentTaskWriteContext, type WorkArtifact } from './agent-tasks.js';
import type { NoteWriteParams, ParsedNote } from './types.js';
import {
  coordinate, displayIdentity, fingerprint, finished, integer, listField, page, reviewBasis, started, textField, WORK_KINDS,
  type Properties, type WorkBaseParams, type WorkBoardParams, type WorkClaimParams, type WorkHandoffParams,
  type WorkPacketParams, type WorkProjectParams, type WorkReviewParams,
} from './work-model.js';
export type { WorkBaseParams, WorkBoardParams, WorkClaimParams, WorkHandoffParams, WorkPacketParams, WorkProjectParams, WorkReviewParams } from './work-model.js';

const projectPath = (id: string) => `Community/Projects/${normalizeScopeId(id, 'projectId')}.md`;
const taskPath = (id: string) => `Community/Tasks/${normalizeScopeId(id, 'taskId')}.md`;
const timestamp = () => new Date().toISOString();
const RECEIPTS = 16;
const EVENTS = 16;
const TASK_EXTENSION_FIELDS = ['project_id', 'parent_task_id', 'depends_on', 'completion_criteria', 'artifacts', 'work_kind', 'discussion_slug',
  'verification', 'author_account_id', 'claim_generation', 'started_at', 'last_progress_at', 'assignee_account_id',
  'work_review', 'work_reviews', 'work_handoff', 'work_changes'] as const;
type Guard = { path: string; expectedRevision: string };
type Intent = { kind: 'claim'; params: WorkClaimParams } | { kind: 'handoff'; params: WorkHandoffParams } | { kind: 'review'; params: WorkReviewParams };
export interface WorkServiceOptions { assertActor?: (principal: ScopePrincipal) => Promise<void> }

/** Markdown is the sole durable state, including approvals and retry receipts.
 * No timer, worker token, external executor, or account creation lives here. */
export class WorkService {
  private readonly access = new ScopeAccessPolicy();
  private readonly intents = new WeakMap<object, Intent>();
  constructor(
    private readonly fileSystem: FileSystemService,
    private readonly references: ReferenceService,
    private readonly auth: ScopeAuthService,
    private readonly tasks: AgentTaskService,
    private readonly options: WorkServiceOptions = {},
  ) {
    tasks.attachWorkExtension({ run: (action, params, proceed) => this.runTask(action, params, proceed) });
  }

  private async actor(principal?: ScopePrincipal): Promise<ScopePrincipal> {
    if (!principal) throw new Error('Authenticated account is required for project work');
    const current = (await this.auth.listPrincipals()).find(p => p.accountId === principal.accountId);
    if (!current || current.modelId !== principal.modelId || current.agentId !== principal.agentId || current.role !== principal.role
      || (principal.commandCenterId && principal.commandCenterId !== this.access.getCommandCenterId())
      || (current.commandCenterId && current.commandCenterId !== this.access.getCommandCenterId())) throw new Error('Authenticated account is unavailable in this scope');
    if (!this.auth.hasCapability(current, 'task') || !this.auth.hasCapability(principal, 'task')) throw new Error('Task capability is required');
    await this.options.assertActor?.(current);
    return current;
  }

  private async visible(path: string): Promise<ParsedNote> {
    if (!this.access.canAccessPhysicalPath(path)) throw new Error('Work target is unavailable');
    try {
      const note = await this.fileSystem.readNote(path);
      if (isModerationHidden(note.frontmatter)) throw new Error('hidden');
      return note;
    } catch { throw new Error('Work target is unavailable or not visible'); }
  }

  private async projectNote(id: string): Promise<ParsedNote> {
    id = normalizeScopeId(id, 'projectId');
    const note = await this.visible(projectPath(id));
    if (note.frontmatter.mcpvault_type !== 'work_project' || note.frontmatter.project_id !== id) throw new Error('Project is unavailable');
    return note;
  }

  private async communityTarget(kind: 'room' | 'post', value: string): Promise<{ id: string; path: string; note: ParsedNote }> {
    const id = normalizeScopeId(value, kind === 'room' ? 'roomId' : 'discussionSlug');
    const path = `Community/${kind === 'room' ? 'ChatRooms' : 'Posts'}/${id}.md`;
    const note = await this.visible(path);
    if (note.frontmatter.mcpvault_type !== (kind === 'room' ? 'chat_room' : 'blog_post')
      || note.frontmatter[kind === 'room' ? 'room_id' : 'post_id'] !== id
      || (kind === 'post' && note.frontmatter.status !== 'published')) throw new Error(`Public ${kind} target is unavailable`);
    return { id, path, note };
  }

  private member(project: Properties, actor: ScopePrincipal): void {
    if (!Array.isArray(project.participants) || !project.participants.includes(actor.accountId)) throw new Error('Account must be an explicitly configured project participant');
  }

  private revision(note: ParsedNote, expected?: string): void {
    if (!expected) throw new Error('expectedRevision is required; read current context first');
    if (note.revision !== expected) throw new Error('Revision conflict; read current context first');
  }

  private request(params: WorkBaseParams, action: string, target: string) {
    const requestId = textField(params.requestId, 'requestId', 128, true);
    const fields = ['op', 'projectId', 'taskId', 'title', 'goal', 'allowedWork', 'participants', 'completionCriteria', 'wipLimit', 'personalWipLimit', 'roomId',
      'parentTaskId', 'dependsOn', 'artifacts', 'workKind', 'discussionSlug', 'verification', 'description', 'assignee', 'references', 'status',
      'reason', 'retrospective', 'knowledgeNotes', 'negativeKnowledgeNotes', 'knowledgeApplications', 'noReusableKnowledge', 'knowledgeDispositionReason',
      'toAccountId', 'completed', 'remaining', 'blocker', 'nextAction', 'artifactFingerprint', 'expectedRevision', 'expectedGeneration'];
    const payload = Object.fromEntries(fields.filter(field => (params as Properties)[field] !== undefined).map(field => [field, (params as Properties)[field]]));
    return { requestId, actor: params.principal!.accountId, action, target, payload: fingerprint(payload) };
  }

  private receiptState(fm: Properties, content: string): string {
    const { work_receipts: _receipts, ...state } = fm;
    // Keep property order as well as values: changing YAML order changes the
    // file revision even when its semantic Properties are equivalent.
    return fingerprint({ state: JSON.stringify(state), content });
  }

  private receiptMatches(note: ParsedNote, receipt: Properties): boolean {
    return receipt.state === this.receiptState(note.frontmatter, note.content)
      && new FrontmatterHandler().stringify(note.frontmatter, note.content) === note.originalContent;
  }

  private retry(note: ParsedNote, request: Properties): Properties | undefined {
    const fm = note.frontmatter;
    const found = (Array.isArray(fm.work_receipts) ? fm.work_receipts : []).find((r: Properties) =>
      r.actor === request.actor && r.action === request.action && r.target === request.target && r.requestId === request.requestId);
    if (!found) return;
    if (found.payload !== request.payload) throw new Error('requestId was already used with a different payload');
    if (!found.result.revision && (found.revision_unavailable || !this.receiptMatches(note, found))) throw new Error('Receipt revision unavailable after an external Markdown edit; read current context, do not replay the mutation');
    return { ...structuredClone(found.result), revision: found.result.revision || note.revision };
  }

  private addReceipt(fm: Properties, content: string, request: Properties, result: Properties, prior?: ParsedNote): void {
    const receipts: Properties[] = structuredClone(Array.isArray(fm.work_receipts) ? fm.work_receipts : []);
    const last = receipts.at(-1);
    if (last && !last.result.revision && prior) {
      if (this.receiptMatches(prior, last)) last.result.revision = prior.revision;
      else last.revision_unavailable = true;
    }
    fm.work_receipts = [...receipts.slice(-(RECEIPTS - 1)), { ...request, state: this.receiptState(fm, content), result }];
  }

  private event(fm: Properties, event: Properties): void {
    fm.work_changes = [...(Array.isArray(fm.work_changes) ? fm.work_changes : []).slice(-(EVENTS - 1)), { ...event, at: timestamp() }];
  }

  private projectProjection(id: string, note: ParsedNote, maxChars?: number): Properties {
    const maximum = integer(maxChars, 4000, 12000, 'maxChars');
    const project: Properties = { project_id: id };
    const result: Properties = { projectId: id, path: projectPath(id), revision: note.revision, project, truncated: false, omittedFields: [] };
    const omit = (key: string) => {
      result.truncated = true;
      if (!result.omittedFields.includes(key)) result.omittedFields.push(key);
      result.nextAction = maximum < 12000
        ? { tool: 'work.project', arguments: { op: 'read', projectId: id, maxChars: 12000 } }
        : { tool: 'notes.read', arguments: { path: projectPath(id), expectedRevision: note.revision, maxChars: 12000 } };
    };
    const freeText = new Set(['title', 'goal']);
    for (const [key, cap] of Object.entries({ title: 180, owner_account_id: 64, goal: 2000, room_id: 64, created_at: 64, updated_at: 64 })) {
      const value = note.frontmatter[key];
      if (typeof value !== 'string') { if (value !== undefined) omit(key); continue; }
      if (value.length > cap) {
        omit(key);
        if (freeText.has(key)) project[key] = value.slice(0, cap);
      } else project[key] = value;
    }
    for (const key of ['wip_limit', 'personal_wip_limit']) {
      const value = note.frontmatter[key];
      if (Number.isSafeInteger(value) && value >= 1 && value <= (key === 'wip_limit' ? 100 : 20)) project[key] = value;
      else if (value !== undefined) omit(key);
    }
    for (const key of ['allowed_work', 'completion_criteria', 'participants']) {
      const value = note.frontmatter[key];
      if (!Array.isArray(value)) { if (value !== undefined) omit(key); continue; }
      const cap = key === 'participants' ? 100 : 20;
      const textCap = key === 'participants' ? 64 : 500;
      project[key] = value.slice(0, cap).filter((v: unknown) => typeof v === 'string' && (key !== 'participants' || v.length <= textCap))
        .map((v: string) => key === 'participants' ? v : v.slice(0, textCap));
      if (value.length > cap || value.some(v => typeof v !== 'string' || v.length > textCap)) omit(key);
    }
    // Shrink only projected values, admitting the complete JSON response.
    // Custom Properties, retry receipts, and arbitrary metadata never enter it.
    while (JSON.stringify(result).length > maximum) {
      const key = Object.keys(project).filter(key => key !== 'project_id')
        .sort((a, b) => JSON.stringify(project[b]).length - JSON.stringify(project[a]).length)[0];
      if (!key) {
        if (result.path) { delete result.path; continue; }
        throw new Error('maxChars is too small for the project response envelope');
      }
      omit(key);
      const value = project[key];
      if (Array.isArray(value) && value.length) value.pop();
      else if (freeText.has(key) && typeof value === 'string' && value.length) project[key] = value.slice(0, Math.max(0, value.length - (JSON.stringify(result).length - maximum) - 1));
      else delete project[key];
    }
    return result;
  }

  async project(params: WorkProjectParams): Promise<Properties> {
    const id = normalizeScopeId(params.projectId, 'projectId');
    const op = params.op || 'read';
    if (op === 'read') {
      const n = await this.projectNote(id);
      let projected = n;
      if (n.frontmatter.room_id) {
        try { await this.communityTarget('room', n.frontmatter.room_id); }
        catch { const { room_id: _room, ...frontmatter } = n.frontmatter; projected = { ...n, frontmatter }; }
      }
      return this.projectProjection(id, projected, params.maxChars);
    }
    if (!['create', 'update'].includes(op)) throw new Error('Invalid project operation');
    return coordinate(async () => {
      const actor = await this.actor(params.principal);
      const path = projectPath(id);
      const prior = await this.fileSystem.noteExists(path) ? await this.projectNote(id) : undefined;
      const request = this.request(params, `project.${op}`, id);
      if (prior) {
        // A former owner is never allowed to use retry as an access bypass.
        if (prior.frontmatter.owner_account_id !== actor.accountId) throw new Error('Only the immutable project owner can configure the project');
        const retry = this.retry(prior, request); if (retry) return retry;
      }
      if (op === 'create' && prior) throw new Error('Project already exists');
      if (op === 'update' && !prior) throw new Error('Project is unavailable');
      if (prior) this.revision(prior, params.expectedRevision);
      else if (params.expectedRevision && params.expectedRevision !== 'missing') throw new Error('New project requires expectedRevision=missing');
      const fm: Properties = { ...prior?.frontmatter, mcpvault_type: 'work_project', project_id: id, owner_account_id: actor.accountId };
      fm.title = textField(params.title ?? fm.title, 'title', 180, true);
      fm.goal = textField(params.goal ?? fm.goal, 'goal', 2000, true);
      fm.allowed_work = listField(params.allowedWork ?? fm.allowed_work, 'allowedWork', 20, true);
      fm.completion_criteria = listField(params.completionCriteria ?? fm.completion_criteria, 'completionCriteria', 20, true);
      fm.participants = [actor.accountId, ...listField(params.participants ?? fm.participants ?? [], 'participants', 100)
        .map(id => normalizeScopeId(id, 'participant')).filter(id => id !== actor.accountId)];
      const accounts = new Set((await this.auth.listPrincipals()).map(p => p.accountId));
      if (fm.participants.some((id: string) => !accounts.has(id))) throw new Error('Every participant must identify a registered account');
      fm.wip_limit = integer(params.wipLimit ?? fm.wip_limit, 3, 100, 'wipLimit');
      fm.personal_wip_limit = integer(params.personalWipLimit ?? fm.personal_wip_limit, 1, 20, 'personalWipLimit');
      if (params.roomId !== undefined) fm.room_id = params.roomId ? normalizeScopeId(params.roomId, 'roomId') : '';
      const room = fm.room_id ? await this.communityTarget('room', fm.room_id) : undefined;
      fm.created_at ||= timestamp(); fm.updated_at = timestamp();
      const result = { success: true, projectId: id, path, requestId: request.requestId,
        nextAction: { endpoint: 'work.project', args: { op: 'read', projectId: id } } };
      const content = prior?.content ?? `# ${fm.title}\n\n${fm.goal}\n`;
      this.addReceipt(fm, content, request, result, prior);
      await this.actor(params.principal);
      const write = { path, content, frontmatter: fm, expectedRevision: prior?.revision || 'missing' };
      const receipt = room
        ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, [{ path: room.path, expectedRevision: room.note.revision }])
        : await this.fileSystem.writeNoteWithReceipt(write);
      await this.fileSystem.readNote(path);
      return { ...result, revision: receipt.revision };
    });
  }

  private async inventory(projectId?: string): Promise<Array<{ path: string; fm: Properties; revision?: string }>> {
    const result: Array<{ path: string; fm: Properties; revision?: string }> = [];
    for await (const n of iterateNotes(this.fileSystem, {
      ...(projectId ? { filters: { project_id: projectId } } : { pathPrefix: 'Community/Tasks', filters: { mcpvault_type: 'agent_task' } }),
      includeContent: false, sortBy: 'path', sortOrder: 'asc',
    }, path => this.access.canAccessPhysicalPath(path))) {
      if (isModerationHidden(n.frontmatter)) continue;
      const fm = n.frontmatter;
      if (fm.mcpvault_type === 'agent_task' || (projectId && isActionableKnowledge(fm) && fm.mcpvault_type !== 'work_project')) result.push({ path: n.path, fm, ...(n.revision && { revision: n.revision }) });
    }
    return result;
  }

  private async accountForAssignee(value: string, project: Properties): Promise<ScopePrincipal> {
    const id = normalizeScopeId(value, 'assignee');
    const all = await this.auth.listPrincipals();
    const direct = all.find(p => p.accountId === id);
    const candidates = direct ? [direct] : all.filter(p => displayIdentity(p) === id);
    if (candidates.length !== 1) throw new Error('Assignee must resolve to exactly one registered account');
    this.member(project, candidates[0]!);
    return candidates[0]!;
  }

  private publicPath(value: string): string {
    const resolved = this.access.resolveExternalPath(value);
    const path = resolved.replace(/\\/g, '/');
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0') || path.split('/').some(s => s === '..' || /[. ]$/.test(s))) throw new Error('Artifact path must be a canonical public vault path');
    const normalized = posix.normalize(path);
    if (!this.access.canAccessPhysicalPath(normalized)) throw new Error('Artifact path must be visible public');
    return normalized;
  }

  private async artifacts(value: unknown, principal: ScopePrincipal, guards: Guard[], requireRevision = false): Promise<WorkArtifact[]> {
    if (!Array.isArray(value) || value.length > 20) throw new Error('artifacts must be an array of at most 20 locators');
    const artifacts: WorkArtifact[] = [];
    for (const input of value) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Artifact must be a locator');
      const item: WorkArtifact = {};
      for (const field of ['repository', 'branch', 'commit', 'revision'] as const) if (input[field] !== undefined) item[field] = textField(input[field], `artifact.${field}`, 300, true);
      if (item.repository && /^[a-z][a-z0-9+.-]*:\/\//i.test(item.repository)) {
        const url = new URL(item.repository);
        if (url.username || url.password || url.search) throw new Error('Repository locators must not contain credentials or query tokens');
      }
      if (item.commit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.commit)) throw new Error('Artifact commit must be an immutable full 40- or 64-character hexadecimal Git object ID (advisory, not fetched)');
      if (input.files !== undefined) item.files = listField(input.files, 'artifact.files', 20).map(p => {
        if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.replace(/\\/g, '/').split('/').includes('..')) throw new Error('Artifact files must be repository-relative locators');
        return p.replace(/\\/g, '/');
      });
      if (input.path !== undefined) {
        item.path = this.publicPath(textField(input.path, 'artifact.path', 500, true));
        await this.references.validateAndNormalize([item.path], 'Community/Tasks/artifacts.md', principal);
        const note = await this.visible(item.path);
        if (requireRevision && (!item.revision || item.revision !== note.revision)) throw new Error('Artifact revision is missing or stale; update artifacts before approval/completion');
        if (item.revision && item.revision !== note.revision) throw new Error('Artifact revision is stale');
        guards.push({ path: item.path, expectedRevision: note.revision });
      } else if (!item.repository || !item.commit) throw new Error('External artifacts require repository and commit locators (advisory only)');
      artifacts.push(item);
    }
    return artifacts;
  }

  private async dependencies(fm: Properties, taskId: string, guards: Guard[]): Promise<void> {
    const active = new Set([taskId]); const checked = new Set<string>();
    const visit = async (id: string) => {
      if (active.has(id)) throw new Error('Dependency or parent cycle detected');
      if (checked.has(id)) return;
      if (active.size + checked.size >= 100) throw new Error('Dependency graph exceeds the bounded validation window');
      active.add(id);
      const note = await this.visible(taskPath(id));
      if (note.frontmatter.mcpvault_type !== 'agent_task' || note.frontmatter.project_id !== fm.project_id) throw new Error('Dependency must be a visible task in the same project');
      guards.push({ path: taskPath(id), expectedRevision: note.revision });
      for (const dependency of [...(note.frontmatter.depends_on || []), ...(note.frontmatter.parent_task_id ? [note.frontmatter.parent_task_id] : [])]) await visit(normalizeScopeId(dependency, 'dependency'));
      active.delete(id); checked.add(id);
    };
    for (const id of [...(fm.depends_on || []), ...(fm.parent_task_id ? [fm.parent_task_id] : [])]) await visit(id);
  }

  private async ready(fm: Properties): Promise<void> {
    for (const id of fm.depends_on || []) {
      const n = await this.visible(taskPath(id));
      if (n.frontmatter.project_id !== fm.project_id || n.frontmatter.status !== 'completed') throw new Error('Dependencies must be completed before starting or claiming work');
    }
  }

  private async wip(fm: Properties, project: Properties, taskId: string, prior: Properties = {}): Promise<void> {
    if (!started(fm)) return;
    const addsProjectWip = !started(prior);
    const addsPersonalWip = fm.assignee_account_id && (!started(prior) || prior.assignee_account_id !== fm.assignee_account_id);
    if (!addsProjectWip && !addsPersonalWip) return;
    let projectCount = 0; let personalCount = 0;
    const projectLimit = integer(project.wip_limit, 3, 100, 'project wip_limit');
    let personalLimit = integer(project.personal_wip_limit, 1, 20, 'project personal_wip_limit');
    for (const item of await this.inventory()) {
      if (item.fm.task_id === taskId || !started(item.fm) || !item.fm.project_id) continue;
      if (item.fm.project_id === fm.project_id) projectCount++;
      if (fm.assignee_account_id && item.fm.assignee_account_id === fm.assignee_account_id) {
        personalCount++;
        const other = await this.projectNote(item.fm.project_id);
        personalLimit = Math.min(personalLimit, integer(other.frontmatter.personal_wip_limit, 1, 20, 'active project personal_wip_limit'));
      }
    }
    if (addsProjectWip && projectCount >= projectLimit) throw new Error('Project WIP limit reached');
    if (addsPersonalWip && personalCount >= personalLimit) throw new Error('Personal WIP limit reached across projects');
  }

  private async runTask(action: 'create' | 'update', params: any, proceed: (context?: AgentTaskWriteContext, parameters?: any) => Promise<any>): Promise<any> {
    const intent = this.intents.get(params); this.intents.delete(params);
    params = { ...params };
    return coordinate(async () => {
      const prior = action === 'update' ? await this.visible(taskPath(params.taskId)) : undefined;
      const requestedProject = prior?.frontmatter.project_id || params.projectId;
      if (!requestedProject) {
        if (intent) throw new Error('Work actions require a project-backed task');
        return proceed();
      }
      const projectId = normalizeScopeId(requestedProject, 'projectId');
      if (prior && (!prior.frontmatter.project_id || (params.projectId !== undefined && normalizeScopeId(params.projectId, 'projectId') !== projectId))) throw new Error('Task project ownership is immutable; existing unprojected tasks are not migrated');
      const actor = await this.actor(params.principal);
      const project = await this.projectNote(normalizeScopeId(projectId, 'projectId'));
      const moderate = this.auth.hasCapability(actor, 'moderate');
      if (!(moderate && ((intent?.kind === 'claim' && intent.params.op === 'release') || (intent?.kind === 'review' && intent.params.op === 'override')))) this.member(project.frontmatter, actor);
      const original = intent?.params || { ...params };
      const actionId = intent ? `${intent.kind}.${intent.params.op}` : `task.${action}`;
      const id = params.taskId ? normalizeScopeId(params.taskId, 'taskId') : `task-${fingerprint({ actor: actor.accountId, requestId: params.requestId }).slice(0, 24)}`;
      const request = this.request(original, actionId, id);
      params.taskId = id;
      const current = prior || (await this.fileSystem.noteExists(taskPath(id)) ? await this.visible(taskPath(id)) : undefined);
      if (current) { const retry = this.retry(current, request); if (retry) return retry; }
      if (action === 'create' && current) throw new Error('Task already exists');
      if (prior) this.revision(prior, params.expectedRevision);
      const fm: Properties = { ...prior?.frontmatter, project_id: projectId, status: taskStatus(prior?.frontmatter.status) };
      const generation = Number(fm.claim_generation || 0);
      const reviewer = intent?.kind === 'review' && intent.params.op !== 'request';
      const privilegedRelease = intent?.kind === 'claim' && intent.params.op === 'release';
      if (prior && !reviewer && !privilegedRelease && params.expectedGeneration !== generation) throw new Error('expectedGeneration must match the current claim generation');
      if (prior && params.expectedGeneration !== undefined && params.expectedGeneration !== generation) throw new Error('Revoked claim generation');
      if (!prior) {
        fm.requester_account_id = actor.accountId; fm.author_account_id = actor.accountId; fm.claim_generation = 0;
        fm.status = 'proposed'; fm.work_kind = 'general'; fm.depends_on = []; fm.completion_criteria = []; fm.artifacts = [];
      }
      const isRequester = fm.requester_account_id === actor.accountId;
      const isAssignee = fm.assignee_account_id === actor.accountId;
      const accepting = intent?.kind === 'handoff' && intent.params.op === 'accept';
      const claiming = intent?.kind === 'claim' && intent.params.op !== 'release';
      const selfClaim = !fm.assignee_account_id && [actor.accountId, displayIdentity(actor)].includes(params.assignee);
      if (prior && !isRequester && !isAssignee && !reviewer && !accepting && !claiming && !selfClaim && !privilegedRelease) throw new Error('Only task requester or assignee account can update work');
      if (params.description !== undefined) fm.description = textField(params.description, 'description', 4000, true);
      if (params.completionCriteria !== undefined) fm.completion_criteria = listField(params.completionCriteria, 'completionCriteria');
      if (params.dependsOn !== undefined) fm.depends_on = listField(params.dependsOn, 'dependsOn', 20).map(id => normalizeScopeId(id, 'dependency'));
      if (params.parentTaskId !== undefined) fm.parent_task_id = params.parentTaskId ? normalizeScopeId(params.parentTaskId, 'parentTaskId') : '';
      if (params.workKind !== undefined) {
        if (!(WORK_KINDS as readonly string[]).includes(params.workKind)) throw new Error('Invalid workKind');
        if (fm.work_kind !== 'general' && fm.work_kind !== params.workKind) throw new Error('Risk workKind cannot be lowered or relabeled to evade review');
        fm.work_kind = params.workKind;
      }
      if (params.discussionSlug !== undefined) fm.discussion_slug = params.discussionSlug ? normalizeScopeId(params.discussionSlug, 'discussionSlug') : '';
      if (params.verification !== undefined) fm.verification = textField(params.verification, 'verification', 1000);
      // Match AgentTaskService's canonical value before ANY readiness, WIP or
      // completion check. Validating a raw value then persisting a normalized
      // one would let alternate casing bypass those checks.
      if (params.status !== undefined) fm.status = taskStatus(params.status, taskStatus(fm.status));
      const guards: Guard[] = [{ path: projectPath(projectId), expectedRevision: project.revision }];
      if (params.discussionSlug !== undefined && fm.discussion_slug) {
        const discussion = await this.communityTarget('post', fm.discussion_slug);
        guards.push({ path: discussion.path, expectedRevision: discussion.note.revision });
      }
      fm.artifacts = await this.artifacts(params.artifacts ?? fm.artifacts ?? [], actor, guards);
      await this.dependencies(fm, id, guards);
      if (params.assignee !== undefined) {
        const account = params.assignee ? await this.accountForAssignee(params.assignee, project.frontmatter) : undefined;
        if (!account || account.accountId !== actor.accountId || (prior && fm.assignee_account_id && fm.assignee_account_id !== actor.accountId)) throw new Error('Assignee changes require self-claim or exact-account handoff; use release to clear');
        if (account.accountId !== fm.assignee_account_id) fm.claim_generation = generation + 1;
        fm.assignee_account_id = account.accountId; fm.assignee = displayIdentity(account); params.assignee = displayIdentity(account);
      }
      if (intent) await this.applyIntent(intent, params, fm, project.frontmatter, actor);
      // Legacy status/assignee updates get exactly the same readiness and WIP gate.
      if (['accepted', 'in_progress', 'blocked', 'in_review'].includes(fm.status) && !fm.assignee_account_id) throw new Error('Claim an assignee account before starting work');
      if (['in_progress', 'blocked', 'in_review'].includes(fm.status)) fm.started_at ||= timestamp();
      const newlyClaimed = fm.assignee_account_id && fm.assignee_account_id !== prior?.frontmatter.assignee_account_id;
      if (prior && fm.claim_generation !== generation) delete fm.work_review;
      if (newlyClaimed || (started(fm) && (!started(prior?.frontmatter || {}) || params.dependsOn !== undefined)) || fm.status === 'completed') await this.ready(fm);
      await this.wip(fm, project.frontmatter, id, prior?.frontmatter);
      if (prior && reviewBasis(fm) !== reviewBasis(prior.frontmatter)) delete fm.work_review;
      if (fm.status === 'completed') {
        if (!fm.completion_criteria?.length || !fm.verification) throw new Error('Completion requires completionCriteria and verification');
        await this.artifacts(fm.artifacts, actor, guards, true);
        if (fm.work_kind !== 'general') {
          const approval = fm.work_review;
          if (!approval || !['approve', 'override'].includes(approval.decision) || approval.fingerprint !== reviewBasis(fm)) throw new Error('High-risk completion requires current independent approval');
        }
      }
      params.status = fm.status;
      if (fm.status !== prior?.frontmatter.status && !params.reason) params.reason = intent ? textField(intent.params.reason || `${intent.kind} ${intent.params.op}`, 'reason', 500) : params.reason;
      fm.last_progress_at = timestamp();
      this.event(fm, { action: actionId, actor: actor.accountId, reason: textField(params.reason, 'reason', 500), status: fm.status, generation: fm.claim_generation,
        ...(privilegedRelease && prior?.frontmatter.started_at && { releasedStartedAt: prior.frontmatter.started_at, releasedGeneration: generation }) });
      let result: Properties = {};
      const context: AgentTaskWriteContext = {
        // AgentTaskService owns its normalized disposition, status metadata,
        // description, and timestamps; never overlay stale copies of those.
        authorize: true, frontmatter: Object.fromEntries(TASK_EXTENSION_FIELDS.filter(key => key in fm).map(key => [key, fm[key]])),
        removeFields: Object.keys(prior?.frontmatter || {}).filter(key => !(key in fm)),
        write: async (write: NoteWriteParams, applicationGuards = []) => {
          await this.actor(params.principal);
          const currentProject = await this.projectNote(projectId);
          if (currentProject.revision !== project.revision) throw new Error('Project revision changed during work mutation');
          if (!moderate || (!privilegedRelease && !(intent?.kind === 'review' && intent.params.op === 'override'))) this.member(currentProject.frontmatter, actor);
          await this.wip(fm, currentProject.frontmatter, id, prior?.frontmatter);
          const combined = [...guards, ...applicationGuards].filter(g => g.path !== write.path);
          const unique = [...new Map(combined.map(g => [g.path.toLowerCase(), g])).values()];
          if (combined.some(g => unique.find(u => u.path.toLowerCase() === g.path.toLowerCase())?.expectedRevision !== g.expectedRevision)) throw new Error('Related revision changed during work mutation');
          // The existing filesystem supports nine locked related revisions.
          // Fail closed rather than drop guards from a larger mutation.
          if (unique.length > 9) throw new Error('Work mutation exceeds nine related revision guards; split the dependency/artifact change');
          result = { success: true, taskId: id, path: write.path, status: fm.status, generation: fm.claim_generation,
            claimGeneration: fm.claim_generation, ...(fm.assignee_account_id && { assigneeAccountId: fm.assignee_account_id }),
            artifactFingerprint: reviewBasis(fm), requestId: request.requestId,
            nextAction: { endpoint: 'work.packet', args: { taskId: id } } };
          this.addReceipt(write.frontmatter!, write.content, request, result, prior);
          const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, unique);
          result = { ...result, revision: receipt.revision };
          await this.fileSystem.readNote(write.path);
          return receipt;
        },
      };
      await proceed(context, params);
      return result;
    });
  }

  private async applyIntent(intent: Intent, params: any, fm: Properties, project: Properties, actor: ScopePrincipal): Promise<void> {
    const generation = Number(fm.claim_generation || 0);
    const own = fm.assignee_account_id === actor.accountId;
    if (intent.kind === 'claim') {
      if (intent.params.op === 'release') {
        if (!own && fm.requester_account_id !== actor.accountId && project.owner_account_id !== actor.accountId && !this.auth.hasCapability(actor, 'moderate')) throw new Error('Only owner, requester, assignee or host moderator may release work');
        textField(intent.params.reason, 'release reason', 500, true);
        delete fm.assignee_account_id; delete fm.assignee; delete fm.work_handoff; delete fm.started_at;
        fm.claim_generation = generation + 1; fm.status = 'proposed'; params.assignee = '';
      } else {
        if (finished(fm)) throw new Error('Finished work cannot be claimed');
        if (fm.assignee_account_id && !own) throw new Error('Task already has another assignee; use handoff');
        if (!own) fm.claim_generation = generation + 1;
        fm.assignee_account_id = actor.accountId; fm.assignee = displayIdentity(actor); params.assignee = displayIdentity(actor);
        fm.status = intent.params.op === 'start' ? 'in_progress' : 'accepted';
        // Claim reserves implementation capacity even before the first start.
        fm.started_at ||= timestamp();
      }
      return;
    }
    if (intent.kind === 'handoff') {
      if (finished(fm)) throw new Error('Finished work cannot be handed off');
      if (intent.params.op === 'propose') {
        if (!own) throw new Error('Only current assignee may propose a handoff');
        const to = normalizeScopeId(textField(intent.params.toAccountId, 'toAccountId', 64, true), 'toAccountId');
        const target = (await this.auth.listPrincipals()).find(p => p.accountId === to);
        if (!target || to === actor.accountId) throw new Error('Handoff requires another exact registered account');
        this.member(project, target);
        fm.work_handoff = { state: 'proposed', from_account_id: actor.accountId, to_account_id: to, generation,
          completed: textField(intent.params.completed, 'completed', 500), remaining: textField(intent.params.remaining, 'remaining', 500),
          blocker: textField(intent.params.blocker, 'blocker', 500), next_action: textField(intent.params.nextAction, 'nextAction', 500, true),
          artifacts: fm.artifacts, proposed_at: timestamp() };
      } else {
        const offer = fm.work_handoff;
        if (!offer || offer.state !== 'proposed' || offer.to_account_id !== actor.accountId || offer.generation !== generation) throw new Error('Only the exact handoff recipient can accept the current proposal');
        fm.assignee_account_id = actor.accountId; fm.assignee = displayIdentity(actor); params.assignee = displayIdentity(actor);
        fm.claim_generation = generation + 1; fm.work_handoff = { ...offer, state: 'accepted', accepted_at: timestamp() };
        delete fm.work_review;
      }
      return;
    }
    const op = intent.params.op;
    if (op === 'request') {
      if (!own) throw new Error('Only current assignee may request review');
      if (!fm.completion_criteria?.length || !fm.verification) throw new Error('Review request requires completionCriteria and verification');
      if (finished(fm)) throw new Error('Finished work cannot request review');
      fm.status = 'in_review';
      fm.work_review = { decision: 'request', fingerprint: reviewBasis(fm), account_id: actor.accountId, at: timestamp() };
    } else {
      if (op === 'override') {
        if (!this.auth.hasCapability(actor, 'moderate')) throw new Error('Only a host moderator can explicitly override review');
      } else {
        this.member(project, actor);
        if ([fm.author_account_id, fm.requester_account_id, fm.assignee_account_id].includes(actor.accountId)) throw new Error('Review requires an independent authenticated account, not author or assignee');
      }
      const reason = textField(intent.params.reason, 'review reason', 500, true);
      if (fm.status !== 'in_review' || !fm.work_review) throw new Error('Review must first be explicitly requested');
      if (!intent.params.artifactFingerprint || intent.params.artifactFingerprint !== reviewBasis(fm)) throw new Error('Review artifactFingerprint does not match the current basis');
      await this.artifacts(fm.artifacts || [], actor, [], true);
      fm.work_review = { decision: op, fingerprint: reviewBasis(fm), account_id: actor.accountId, reason, at: timestamp() };
      if (op === 'changes_requested' || op === 'question') fm.status = 'in_progress';
    }
    fm.work_reviews = [...(fm.work_reviews || []).slice(-(EVENTS - 1)), fm.work_review];
  }

  private mutate(intent: Intent): Promise<Properties> {
    const p = intent.params;
    const update = { taskId: p.taskId, expectedRevision: p.expectedRevision || '',
      ...(p.principal !== undefined && { principal: p.principal }),
      ...(p.expectedGeneration !== undefined && { expectedGeneration: p.expectedGeneration }),
      ...(p.requestId !== undefined && { requestId: p.requestId }),
      ...(p.reason !== undefined && { reason: p.reason }),
      ...(intent.kind === 'handoff' && intent.params.artifacts !== undefined ? { artifacts: intent.params.artifacts } : {}) };
    this.intents.set(update, intent);
    return this.tasks.update(update);
  }
  async claim(params: WorkClaimParams): Promise<Properties> {
    if (!['claim', 'start', 'release'].includes(params.op)) throw new Error('Invalid claim operation');
    return this.mutate({ kind: 'claim', params });
  }
  async handoff(params: WorkHandoffParams): Promise<Properties> {
    if (!['propose', 'accept'].includes(params.op)) throw new Error('Invalid handoff operation');
    return this.mutate({ kind: 'handoff', params });
  }
  async review(params: WorkReviewParams): Promise<Properties> {
    if (!['request', 'approve', 'changes_requested', 'question', 'override'].includes(params.op)) throw new Error('Invalid review operation');
    return this.mutate({ kind: 'review', params });
  }

  private blocker(fm: Properties): string {
    const value = fm.blocker || fm.work_handoff?.blocker || fm.waiting_for
      || ((fm.status === 'blocked' || fm.task_status === 'blocked') ? fm.status_reason : '');
    return typeof value === 'string' ? value.slice(0, 500) : '';
  }

  private async boardWip(project: Properties, tasks: Array<{ fm: Properties }>, principal?: ScopePrincipal): Promise<Properties | undefined> {
    if (!principal) return;
    let actor: ScopePrincipal;
    try { actor = await this.actor(principal); this.member(project, actor); } catch { return; }
    let used = 0;
    let limit = integer(project.personal_wip_limit, 1, 20, 'project personal_wip_limit');
    for (const task of await this.inventory()) {
      if (!task.fm.project_id || !started(task.fm) || task.fm.assignee_account_id !== actor.accountId) continue;
      let other: ParsedNote;
      try { other = await this.projectNote(task.fm.project_id); }
      catch { continue; /* Hidden projects cannot contribute disclosed counts. */ }
      used++;
      limit = Math.min(limit, integer(other.frontmatter.personal_wip_limit, 1, 20, 'active project personal_wip_limit'));
    }
    return { project: { used: tasks.filter(t => started(t.fm)).length, limit: integer(project.wip_limit, 3, 100, 'project wip_limit') }, personal: { used, limit } };
  }

  private resourceKeys(fm: Properties): Set<string> {
    const keys = new Set<string>();
    for (const artifact of Array.isArray(fm.artifacts) ? fm.artifacts : []) {
      if (!artifact || typeof artifact !== 'object') continue;
      if (typeof artifact.path === 'string' && artifact.path) keys.add(JSON.stringify(['path', artifact.path]));
      if (typeof artifact.repository === 'string' && artifact.repository && Array.isArray(artifact.files)) {
        for (const file of artifact.files) if (typeof file === 'string') keys.add(JSON.stringify(['repository', artifact.repository, file]));
      }
    }
    return keys;
  }

  async board(params: WorkBoardParams) {
    const id = normalizeScopeId(params.projectId, 'projectId');
    const project = await this.projectNote(id);
    const inventory = await this.inventory(id);
    const tasks = inventory.filter(n => n.fm.mcpvault_type === 'agent_task');
    const occurrences = new Map<string, Set<string>>();
    const resources = new Map(inventory.map(n => [n.path, this.resourceKeys(n.fm)]));
    for (const task of tasks) for (const resource of resources.get(task.path)!) {
      const owners = occurrences.get(resource) || new Set<string>();
      owners.add(task.path); occurrences.set(resource, owners);
    }
    const linked = new Set(tasks.flatMap(n => (n.fm.references || []).filter((p: unknown) => typeof p === 'string')));
    const taskIds = new Set(tasks.map(n => n.fm.task_id));
    const selected = inventory.filter(n => n.fm.mcpvault_type === 'agent_task' || (!linked.has(n.path) && !taskIds.has(n.fm.task_id)));
    const rows = selected.map(n => ({ path: n.path, taskId: n.fm.task_id, title: String(n.fm.title || posix.basename(n.path)).slice(0, 180),
      status: n.fm.status || n.fm.task_status || 'open', kind: n.fm.mcpvault_type === 'agent_task' ? 'task' : 'knowledge',
      assigneeAccountId: n.fm.assignee_account_id, generation: n.fm.claim_generation,
      ...(this.blocker(n.fm) && { blockedReason: this.blocker(n.fm) }),
      ...(n.fm.work_review && { review: { decision: String(n.fm.work_review.decision || '').slice(0, 32),
        accountId: String(n.fm.work_review.account_id || '').slice(0, 64), reason: String(n.fm.work_review.reason || '').slice(0, 200),
        current: n.fm.work_review.fingerprint === reviewBasis(n.fm) } }),
      stale: started(n.fm) && Date.now() - Date.parse(n.fm.last_progress_at || n.fm.updated_at || '') > 86400000,
      ...(n.fm.next_action && { nextAction: String(n.fm.next_action).slice(0, 200) }),
      ...([...resources.get(n.path)!].some(resource => {
        const owners = occurrences.get(resource);
        return owners && (owners.size > 1 || !owners.has(n.path));
      }) && { warning: 'Artifact/file overlap is advisory; coordinate with peers' }),
    }));
    const wip = await this.boardWip(project.frontmatter, tasks, params.principal);
    const sig = fingerprint({ project: project.revision, inventory: selected, wip, ...(wip && { accountId: params.principal?.accountId }) });
    return page(rows, { projectId: id, projectRevision: project.revision, fingerprint: sig, ...(wip && { wip }) }, sig, params, `board:${id}`);
  }

  async packet(params: WorkPacketParams) {
    const id = normalizeScopeId(params.taskId, 'taskId');
    const n = await this.visible(taskPath(id));
    if (n.frontmatter.mcpvault_type !== 'agent_task' || !n.frontmatter.project_id) throw new Error('Packet requires a project-backed task');
    const project = await this.projectNote(n.frontmatter.project_id);
    const fm = n.frontmatter;
    const artifactFingerprint = reviewBasis(fm);
    const locators: Properties[] = [];
    if (fm.discussion_slug) {
      try {
        const discussion = await this.communityTarget('post', fm.discussion_slug);
        locators.push({ kind: 'discussion', slug: discussion.id, revision: discussion.note.revision,
          tool: 'community.post_read', arguments: { slug: discussion.id, includeComments: true, commentLimit: 5 } });
      } catch { /* Draft, private, hidden, and missing discussions are omitted. */ }
    }
    if (fm.parent_task_id) {
      try {
        const parent = await this.visible(taskPath(fm.parent_task_id));
        if (parent.frontmatter.project_id === fm.project_id) locators.push({ kind: 'parent', taskId: fm.parent_task_id, revision: parent.revision });
      } catch { /* Parent visibility is checked independently of task visibility. */ }
    }
    for (const taskId of fm.depends_on || []) {
      try {
        const dependency = await this.visible(taskPath(taskId));
        if (dependency.frontmatter.project_id === fm.project_id) locators.push({ kind: 'dependency', taskId, revision: dependency.revision });
      } catch { /* Hidden and missing targets are not part of this projection. */ }
    }
    for (const locator of fm.artifacts || []) {
      try {
        if (locator.path) {
          const path = this.publicPath(locator.path);
          const artifact = await this.visible(path);
          locators.push({ kind: 'artifact', ...locator, path, currentRevision: artifact.revision, stale: locator.revision !== artifact.revision });
        } else locators.push({ kind: 'artifact', ...locator });
      } catch { /* Do not expose a now-private or moderated artifact locator. */ }
    }
    const nextActions = await this.packetActions(id, n, project.frontmatter, params.principal);
    const items: Properties[] = [
      { kind: 'task', title: String(fm.title || id).slice(0, 180), status: fm.status, assigneeAccountId: fm.assignee_account_id,
        requesterAccountId: fm.requester_account_id, generation: fm.claim_generation, workKind: fm.work_kind },
      ...(this.blocker(fm) ? [{ kind: 'blocker', text: this.blocker(fm) }] : []),
      ...nextActions,
      ...String(project.frontmatter.goal || '').match(/.{1,400}/gs)?.map(text => ({ kind: 'goal', text })) || [],
      ...(project.frontmatter.allowed_work || []).map((text: string) => ({ kind: 'allowedWork', text })),
      { kind: 'authority', text: 'Task participation grants no external execution authority.' },
      ...String(fm.description || '').match(/.{1,400}/gs)?.map(text => ({ kind: 'description', text })) || [],
      ...(fm.completion_criteria || []).map((text: string) => ({ kind: 'criterion', text })),
      ...locators,
      ...(fm.verification ? [{ kind: 'verification', text: fm.verification }] : []),
      ...(fm.work_review ? [{ kind: 'review', ...fm.work_review }] : []),
      ...(fm.work_handoff ? Object.entries(fm.work_handoff).filter(([k]) => k !== 'artifacts').map(([key, value]) => ({ kind: 'handoff', key, value })) : []),
      ...(fm.work_changes || []).slice(-5).reverse().map((change: Properties) => ({ kind: 'change', ...change })),
    ];
    const signature = fingerprint({ revision: n.revision, project: project.revision, artifactFingerprint, locators, nextActions });
    return page(items, { taskId: id, revision: n.revision, artifactFingerprint, generation: fm.claim_generation,
      ...(params.knownRevision && { changed: params.knownRevision !== n.revision }) }, signature, params, `packet:${id}`);
  }

  private async packetActions(id: string, note: ParsedNote, project: Properties, principal?: ScopePrincipal): Promise<Properties[]> {
    if (!principal || finished(note.frontmatter)) return [];
    let actor: ScopePrincipal;
    try { actor = await this.actor(principal); this.member(project, actor); } catch { return []; }
    const fm = note.frontmatter;
    const action = (tool: string, op: string, requiredInput: string[] = []) => ({ kind: 'nextAction', tool,
      arguments: { op, taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
        requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision, tool, op }).slice(0, 24)}`,
        ...(tool === 'work.review' && op !== 'request' && { artifactFingerprint: reviewBasis(fm) }) },
      ...(requiredInput.length && { requiredInput }), advisory: true });
    if (fm.work_handoff?.state === 'proposed' && fm.work_handoff.to_account_id === actor.accountId) return [action('work.handoff', 'accept')];
    if (fm.status === 'in_review' && fm.work_review?.decision === 'request' && ![fm.requester_account_id, fm.assignee_account_id, fm.author_account_id].includes(actor.accountId)) {
      return [action('work.review', 'approve', ['reason']), action('work.review', 'changes_requested', ['reason']), action('work.review', 'question', ['reason'])];
    }
    if (!fm.assignee_account_id) {
      try { await this.ready(fm); } catch { return [{ kind: 'nextAction', tool: 'work.board', arguments: { projectId: fm.project_id }, reason: 'Dependencies are not ready' }]; }
      return [action('work.claim', 'claim')];
    }
    if (fm.assignee_account_id === actor.accountId) {
      if (fm.work_review?.decision === 'question' && fm.work_review.fingerprint === reviewBasis(fm)) {
        return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'),
          arguments: { taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
            requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision }).slice(0, 24)}` },
          requiredInput: ['verification'], question: String(fm.work_review.reason || '').slice(0, 500),
          reason: 'Answer or clarify the review question in updated verification before requesting review again. Use the existing discussion locator if discussion is needed.', advisory: true }];
      }
      if (['accepted', 'proposed'].includes(fm.status)) return [action('work.claim', 'start')];
      if (fm.verification && fm.completion_criteria?.length) {
        const approval = fm.work_review;
        if (fm.work_kind === 'general' || (approval && ['approve', 'override'].includes(approval.decision) && approval.fingerprint === reviewBasis(fm))) {
          return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'),
            arguments: { taskId: id, status: 'completed', expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
              requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision, status: 'completed' }).slice(0, 24)}` },
            requiredInput: ['reason', 'knowledge disposition if not already recorded'],
            reason: 'Complete with a reason and auditable knowledge disposition: retrospective, knowledgeNotes, negativeKnowledgeNotes, or noReusableKnowledge with knowledgeDispositionReason. Current dependencies and artifact revisions are rechecked on write.', advisory: true }];
        }
        if (fm.status !== 'in_review') return [action('work.review', 'request')];
      }
      return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'), arguments: { taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
        requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision }).slice(0, 24)}` }, requiredInput: ['verification or progress fields'], advisory: true }];
    }
    return [];
  }

  async pulse(principal?: ScopePrincipal, limit = 20, maxChars = 4000): Promise<{ nextAction?: { tool: string; arguments: Properties }; reason?: string; summary?: Properties }> {
    integer(limit, 20, 100, 'limit'); integer(maxChars, 4000, 12000, 'maxChars');
    if (!principal) return {};
    let actor: ScopePrincipal;
    try { actor = await this.actor(principal); } catch { return {}; }
    const candidates: Array<{ rank: number; taskId: string; reason: string }> = [];
    const projects = new Map<string, Properties>();
    for (const n of await this.inventory()) {
      const fm = n.fm;
      if (!fm.project_id || finished(fm)) continue;
      let project = projects.get(fm.project_id);
      if (!project) { try { project = (await this.projectNote(fm.project_id)).frontmatter; projects.set(fm.project_id, project); } catch { continue; } }
      if (!project.participants?.includes(actor.accountId)) continue;
      let rank = 9; let reason = '';
      if (fm.work_handoff?.state === 'proposed' && fm.work_handoff.to_account_id === actor.accountId) { rank = 0; reason = 'Pending handoff for your account'; }
      else if (fm.status === 'in_review' && fm.work_review?.decision === 'request' && ![fm.requester_account_id, fm.assignee_account_id].includes(actor.accountId)) { rank = 1; reason = 'Independent review requested'; }
      else if (fm.assignee_account_id === actor.accountId) { rank = 2; reason = 'Continue your current work'; }
      else if (!fm.assignee_account_id && fm.status === 'proposed') { try { await this.ready(fm); rank = 3; reason = 'Ready unclaimed project work'; } catch { continue; } }
      if (rank < 9) candidates.push({ rank, taskId: fm.task_id, reason });
    }
    candidates.sort((a, b) => a.rank - b.rank || a.taskId.localeCompare(b.taskId));
    const first = candidates[0];
    if (!first) return {};
    const result = { nextAction: { tool: 'work.packet', arguments: { taskId: first.taskId } }, reason: first.reason,
      summary: { actionable: Math.min(candidates.length, limit), truncated: candidates.length > limit } };
    if (JSON.stringify(result).length > maxChars) return {};
    return result;
  }
}
