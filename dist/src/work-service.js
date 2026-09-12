import { guidanceError, guidanceText } from './guidance-runtime.js';
import { storyWorkResults } from './story-session.js';
import { WorkReviewEngine, ReviewBudgetError, changeContext, reviewPolicy, effectiveReviewPolicy, reviewPacketItems } from './work-review.js';
import { recommendStaffing } from './work-staffing.js';
import { responsibility, resourceKeys as declaredResourceKeys, assignmentShape } from './work-responsibility.js';
import { posix } from 'node:path';
import { MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { SourceReadLimitError } from './bounded-source-read.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { isActionableKnowledge } from './organization.js';
import { iterateNotes } from './paged-query.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { FrontmatterHandler } from './frontmatter.js';
import { taskStatus } from './agent-tasks.js';
import { coordinate, displayIdentity, fingerprint, finished, integer, listField, page, reviewBasis, started, textField, WORK_KINDS, } from './work-model.js';
const projectPath = (id) => `Community/Projects/${normalizeScopeId(id, 'projectId')}.md`;
const taskPath = (id) => `Community/Tasks/${normalizeScopeId(id, 'taskId')}.md`;
const timestamp = () => new Date().toISOString();
const RECEIPTS = 16;
const EVENTS = 16;
const TASK_EXTENSION_FIELDS = ['responsibility', 'project_id', 'parent_task_id', 'depends_on', 'completion_criteria', 'artifacts', 'work_kind', 'discussion_slug',
    'verification', 'author_account_id', 'claim_generation', 'started_at', 'last_progress_at', 'assignee_account_id',
    'work_review', 'work_reviews', 'work_handoff', 'work_changes', 'work_review_contract', 'work_review_policy', 'change_context', 'work_context_fingerprint'];
/** Markdown is the sole durable state, including approvals and retry receipts.
 * No timer, worker token, external executor, or account creation lives here. */
export class WorkService {
    fileSystem;
    references;
    auth;
    tasks;
    options;
    reviewEngine;
    access = new ScopeAccessPolicy();
    intents = new WeakMap();
    workshopCreates = new WeakMap();
    constructor(fileSystem, references, auth, tasks, options = {}) {
        this.fileSystem = fileSystem;
        this.references = references;
        this.auth = auth;
        this.tasks = tasks;
        this.options = options;
        this.reviewEngine = new WorkReviewEngine(async (locator) => {
            if (!locator.path) {
                if (!this.options.readReviewGitSource)
                    throw guidanceError(new Error('Host Git context reader unavailable'), 'guid-b24617ad501213cf');
                const source = await this.options.readReviewGitSource(locator);
                if (Buffer.byteLength(source.content, 'utf8') > MAX_NOTE_CONTENT_BYTES)
                    throw new ReviewBudgetError('Review Git source exceeds byte budget');
                return source;
            }
            const path = this.publicPath(locator.path);
            const note = await this.visible(path, MAX_NOTE_CONTENT_BYTES);
            return { content: note.originalContent, revision: note.revision, guard: { path, expectedRevision: note.revision },
                ...(typeof (note.frontmatter.source_work_id ?? note.frontmatter.source_family) === 'string' && { sourceWorkId: note.frontmatter.source_work_id ?? note.frontmatter.source_family }),
                ...(note.frontmatter.mcpvault_type === 'agent_task' && { projectId: note.frontmatter.project_id,
                    relatedTaskIds: [note.frontmatter.parent_task_id, ...(note.frontmatter.depends_on || [])].filter(Boolean) }) };
        }, options.verifyReviewExecution);
        tasks.attachWorkExtension({ run: (action, params, proceed) => this.runTask(action, params, proceed) });
    }
    async actor(principal) {
        if (!principal)
            throw guidanceError(new Error('Authenticated account is required for project work'), 'guid-ff97f71bf9e19e2b');
        const current = (await this.auth.listPrincipals()).find(p => p.accountId === principal.accountId);
        if (!current || current.modelId !== principal.modelId || current.agentId !== principal.agentId || current.role !== principal.role
            || (principal.commandCenterId && principal.commandCenterId !== this.access.getCommandCenterId())
            || (current.commandCenterId && current.commandCenterId !== this.access.getCommandCenterId()))
            throw guidanceError(new Error('Authenticated account is unavailable in this scope'), 'guid-20a48e6c5f1ac92e');
        if (!this.auth.hasCapability(current, 'task') || !this.auth.hasCapability(principal, 'task'))
            throw guidanceError(new Error('Task capability is required'), 'guid-008719aaf7771662');
        await this.options.assertActor?.(current);
        return current;
    }
    /** Server-owned adapter, not an agent-supplied authority or task field. */
    async authorizeWorkshopProject(principal, projectId, owner, delegate, grantor) {
        const actor = await this.actor(principal), project = await this.projectNote(projectId);
        this.member(project.frontmatter, actor);
        if (owner && project.frontmatter.owner_account_id !== actor.accountId)
            throw guidanceError(new Error('Only project owner may delegate workshop outputs'), 'guid-f1578dffb82a0681');
        if (grantor && project.frontmatter.owner_account_id !== grantor)
            throw guidanceError(new Error('Project delegation owner changed'), 'guid-be9a21cff63aaffb');
        if (delegate && (!project.frontmatter.participants.includes(delegate) || (await this.auth.listPrincipals()).every(p => p.accountId !== delegate)))
            throw guidanceError(new Error('Delegate must be an existing project participant'), 'guid-e13d406715358578');
        return { path: projectPath(projectId), expectedRevision: project.revision };
    }
    async createWorkshopTask(params, guards, receipt, assertAccess) {
        this.workshopCreates.set(params, { guards: structuredClone(guards), receipt: structuredClone(receipt), assertAccess });
        return this.tasks.create(params);
    }
    verifyWorkshopTaskOrigin(note, input, origin) {
        const id = input.path.split('/').at(-1).replace(/\.md$/, '');
        const receipt = (Array.isArray(note.frontmatter.work_receipts) ? note.frontmatter.work_receipts : []).find((r) => r.action === 'task.create' && r.target === id && r.actor === origin.actor && r.requestId === `output-${origin.payloadFingerprint}`);
        if (note.frontmatter.mcpvault_type !== 'agent_task' || note.frontmatter.task_id !== id || !receipt || !this.receiptMatches(note, receipt))
            throw guidanceError(Error('Output creation receipt integrity unavailable or changed'), 'guid-292508792e33ca97');
    }
    async visible(path, maxBytes = MAX_NOTE_CONTENT_BYTES) {
        if (!this.access.canAccessPhysicalPath(path))
            throw guidanceError(new Error('Work target is unavailable'), 'guid-b4cd42400f6ea6f0');
        try {
            const note = await this.fileSystem.readNote(path, maxBytes);
            if (isModerationHidden(note.frontmatter))
                throw guidanceError(new Error('hidden'), 'guid-6b6e4d767b4d2ef8');
            return note;
        }
        catch (error) {
            if (maxBytes !== undefined && (error instanceof SourceReadLimitError || error instanceof Error && error.cause instanceof SourceReadLimitError))
                throw new ReviewBudgetError('Review source exceeds byte budget');
            throw guidanceError(new Error('Work target is unavailable or not visible'), 'guid-0b05d8e6027e0780');
        }
    }
    async projectNote(id) {
        id = normalizeScopeId(id, 'projectId');
        const note = await this.visible(projectPath(id));
        if (note.frontmatter.mcpvault_type !== 'work_project' || note.frontmatter.project_id !== id)
            throw guidanceError(new Error('Project is unavailable'), 'guid-d04b26b416aecdda');
        return note;
    }
    async communityTarget(kind, value) {
        const id = normalizeScopeId(value, kind === 'room' ? 'roomId' : 'discussionSlug');
        const path = `Community/${kind === 'room' ? 'ChatRooms' : 'Posts'}/${id}.md`;
        const note = await this.visible(path);
        if (note.frontmatter.mcpvault_type !== (kind === 'room' ? 'chat_room' : 'blog_post')
            || note.frontmatter[kind === 'room' ? 'room_id' : 'post_id'] !== id
            || (kind === 'post' && note.frontmatter.status !== 'published'))
            throw guidanceError(new Error(`Public ${kind} target is unavailable`), 'guid-23351b8041a02d03');
        return { id, path, note };
    }
    member(project, actor) {
        if (!Array.isArray(project.participants) || !project.participants.includes(actor.accountId))
            throw guidanceError(new Error('Account must be an explicitly configured project participant'), 'guid-00f830f5c7c47901');
    }
    revision(note, expected) {
        if (!expected)
            throw guidanceError(new Error('expectedRevision is required; read current context first'), 'guid-1d5c0599a4862f86');
        if (note.revision !== expected)
            throw guidanceError(new Error('Revision conflict; read current context first'), 'guid-c88e2d326dcccacd');
    }
    request(params, action, target) {
        const requestId = textField(params.requestId, 'requestId', 128, true);
        const fields = ['staffingPolicy', 'reviewPolicy', 'changeContext', 'migrateReviewContract', 'contextReceipts', 'checks', 'responsibility', 'groupIds', 'requiredPerspectives', 'teamStatus', 'op', 'projectId', 'taskId', 'title', 'goal', 'allowedWork', 'participants', 'completionCriteria', 'wipLimit', 'personalWipLimit', 'roomId',
            'parentTaskId', 'dependsOn', 'artifacts', 'workKind', 'discussionSlug', 'verification', 'description', 'assignee', 'references', 'status',
            'reason', 'retrospective', 'knowledgeNotes', 'negativeKnowledgeNotes', 'knowledgeApplications', 'noReusableKnowledge', 'knowledgeDispositionReason',
            'toAccountId', 'completed', 'remaining', 'blocker', 'nextAction', 'artifactFingerprint', 'expectedRevision', 'expectedGeneration'];
        const payload = Object.fromEntries(fields.filter(field => params[field] !== undefined).map(field => [field, params[field]]));
        return { requestId, actor: params.principal.accountId, action, target, payload: fingerprint(payload) };
    }
    receiptState(fm, content) {
        const { work_receipts: _receipts, ...state } = fm;
        // Keep property order as well as values: changing YAML order changes the
        // file revision even when its semantic Properties are equivalent.
        return fingerprint({ state: JSON.stringify(state), content });
    }
    receiptMatches(note, receipt) {
        return receipt.state === this.receiptState(note.frontmatter, note.content)
            && new FrontmatterHandler().stringify(note.frontmatter, note.content) === note.originalContent;
    }
    retry(note, request) {
        const fm = note.frontmatter;
        const found = (Array.isArray(fm.work_receipts) ? fm.work_receipts : []).find((r) => r.actor === request.actor && r.action === request.action && r.target === request.target && r.requestId === request.requestId);
        if (!found)
            return;
        if (found.payload !== request.payload)
            throw guidanceError(new Error('requestId was already used with a different payload'), 'guid-da844e5a927b4397');
        if (!found.result.revision && (found.revision_unavailable || !this.receiptMatches(note, found)))
            throw guidanceError(new Error('Receipt revision unavailable after an external Markdown edit; read current context, do not replay the mutation'), 'guid-82b05918e76dca87');
        return { ...structuredClone(found.result), revision: found.result.revision || note.revision };
    }
    addReceipt(fm, content, request, result, prior) {
        const receipts = structuredClone(Array.isArray(fm.work_receipts) ? fm.work_receipts : []);
        const last = receipts.at(-1);
        if (last && !last.result.revision && prior) {
            if (this.receiptMatches(prior, last))
                last.result.revision = prior.revision;
            else
                last.revision_unavailable = true;
        }
        fm.work_receipts = [...receipts.slice(-(RECEIPTS - 1)), { ...request, state: this.receiptState(fm, content), result }];
    }
    event(fm, event) {
        fm.work_changes = [...(Array.isArray(fm.work_changes) ? fm.work_changes : []).slice(-(EVENTS - 1)), { ...event, at: timestamp() }];
    }
    projectProjection(id, note, maxChars) {
        const maximum = integer(maxChars, 4000, 12000, 'maxChars');
        const project = { project_id: id };
        const result = { projectId: id, path: projectPath(id), revision: note.revision, project, truncated: false, omittedFields: [] };
        const omit = (key) => {
            result.truncated = true;
            if (!result.omittedFields.includes(key))
                result.omittedFields.push(key);
            result.nextAction = maximum < 12000
                ? { tool: 'work.project', arguments: { op: 'read', projectId: id, maxChars: 12000 } }
                : { tool: 'notes.read', arguments: { path: projectPath(id), expectedRevision: note.revision, maxChars: 12000 } };
        };
        const freeText = new Set(['title', 'goal']);
        for (const [key, cap] of Object.entries({ title: 180, owner_account_id: 64, goal: 2000, room_id: 64, created_at: 64, updated_at: 64 })) {
            const value = note.frontmatter[key];
            if (typeof value !== 'string') {
                if (value !== undefined)
                    omit(key);
                continue;
            }
            if (value.length > cap) {
                omit(key);
                if (freeText.has(key))
                    project[key] = value.slice(0, cap);
            }
            else
                project[key] = value;
        }
        for (const key of ['wip_limit', 'personal_wip_limit']) {
            const value = note.frontmatter[key];
            if (Number.isSafeInteger(value) && value >= 1 && value <= (key === 'wip_limit' ? 100 : 20))
                project[key] = value;
            else if (value !== undefined)
                omit(key);
        }
        if (['active', 'completed'].includes(note.frontmatter.team_status))
            project.team_status = note.frontmatter.team_status;
        if (note.frontmatter.review_policy)
            project.review_policy = reviewPolicy(note.frontmatter.review_policy);
        if (note.frontmatter.staffing_policy)
            project.staffing_policy = this.staffingPolicy(note.frontmatter.staffing_policy);
        for (const key of ['allowed_work', 'completion_criteria', 'participants', 'required_perspectives', 'group_ids']) {
            const value = note.frontmatter[key];
            if (!Array.isArray(value)) {
                if (value !== undefined)
                    omit(key);
                continue;
            }
            const cap = key === 'participants' ? 100 : 20;
            const textCap = key === 'participants' ? 64 : 500;
            project[key] = value.slice(0, cap).filter((v) => typeof v === 'string' && (key !== 'participants' || v.length <= textCap))
                .map((v) => key === 'participants' ? v : v.slice(0, textCap));
            if (value.length > cap || value.some(v => typeof v !== 'string' || v.length > textCap))
                omit(key);
        }
        // Shrink only projected values, admitting the complete JSON response.
        // Custom Properties, retry receipts, and arbitrary metadata never enter it.
        while (JSON.stringify(result).length > maximum) {
            const key = Object.keys(project).filter(key => key !== 'project_id')
                .sort((a, b) => JSON.stringify(project[b]).length - JSON.stringify(project[a]).length)[0];
            if (!key) {
                if (result.path) {
                    delete result.path;
                    continue;
                }
                throw guidanceError(new Error('maxChars is too small for the project response envelope'), 'guid-248a08d52702ed4d');
            }
            omit(key);
            const value = project[key];
            if (Array.isArray(value) && value.length)
                value.pop();
            else if (freeText.has(key) && typeof value === 'string' && value.length)
                project[key] = value.slice(0, Math.max(0, value.length - (JSON.stringify(result).length - maximum) - 1));
            else
                delete project[key];
        }
        return result;
    }
    async project(params) {
        const id = normalizeScopeId(params.projectId, 'projectId');
        const op = params.op || 'read';
        if (op === 'read') {
            const n = await this.projectNote(id);
            const visibleGroups = [];
            for (const groupId of Array.isArray(n.frontmatter.group_ids) ? n.frontmatter.group_ids.slice(0, 20) : []) {
                try {
                    const group = await this.visible(`Community/Groups/${normalizeScopeId(groupId, 'groupId')}.md`);
                    if (group.frontmatter.mcpvault_type === 'work_group')
                        visibleGroups.push(groupId);
                }
                catch { /* Membership is not permission; hidden group links disappear. */ }
            }
            let projected = { ...n, frontmatter: { ...n.frontmatter, ...(n.frontmatter.group_ids && { group_ids: visibleGroups }) } };
            if (n.frontmatter.room_id) {
                try {
                    await this.communityTarget('room', n.frontmatter.room_id);
                }
                catch {
                    const { room_id: _room, ...frontmatter } = projected.frontmatter;
                    projected = { ...projected, frontmatter };
                }
            }
            return this.projectProjection(id, projected, params.maxChars);
        }
        if (!['create', 'update'].includes(op))
            throw guidanceError(new Error('Invalid project operation'), 'guid-872738a197631689');
        return coordinate(async () => {
            const actor = await this.actor(params.principal);
            const path = projectPath(id);
            const prior = await this.fileSystem.noteExists(path) ? await this.projectNote(id) : undefined;
            const request = this.request(params, `project.${op}`, id);
            if (prior) {
                // A former owner is never allowed to use retry as an access bypass.
                if (prior.frontmatter.owner_account_id !== actor.accountId)
                    throw guidanceError(new Error('Only the immutable project owner can configure the project'), 'guid-a33891bcd3346298');
                const retry = this.retry(prior, request);
                if (retry)
                    return retry;
            }
            if (op === 'create' && prior)
                throw guidanceError(new Error('Project already exists'), 'guid-da17f6c2dbef879c');
            if (op === 'update' && !prior)
                throw guidanceError(new Error('Project is unavailable'), 'guid-d04b26b416aecdda');
            if (prior)
                this.revision(prior, params.expectedRevision);
            else if (params.expectedRevision && params.expectedRevision !== 'missing')
                throw guidanceError(new Error('New project requires expectedRevision=missing'), 'guid-57cc7b70921a07d4');
            const fm = { ...prior?.frontmatter, mcpvault_type: 'work_project', project_id: id, owner_account_id: actor.accountId };
            fm.title = textField(params.title ?? fm.title, 'title', 180, true);
            fm.goal = textField(params.goal ?? fm.goal, 'goal', 2000, true);
            fm.allowed_work = listField(params.allowedWork ?? fm.allowed_work, 'allowedWork', 20, true);
            fm.completion_criteria = listField(params.completionCriteria ?? fm.completion_criteria, 'completionCriteria', 20, true);
            if (params.reviewPolicy !== undefined)
                fm.review_policy = reviewPolicy(params.reviewPolicy);
            if (params.staffingPolicy !== undefined)
                fm.staffing_policy = this.staffingPolicy(params.staffingPolicy);
            if (params.requiredPerspectives !== undefined)
                fm.required_perspectives = listField(params.requiredPerspectives, 'requiredPerspectives', 20).map(p => textField(p, 'perspective', 80, true));
            if (params.groupIds !== undefined)
                fm.group_ids = listField(params.groupIds, 'groupIds', 20).map(id => normalizeScopeId(id, 'groupId'));
            if (params.teamStatus !== undefined) {
                if (!['active', 'completed'].includes(params.teamStatus))
                    throw guidanceError(new Error('Invalid teamStatus'), 'guid-2549869126c304ae');
                if (params.teamStatus === 'completed' && (await this.inventory(id)).some(n => n.fm.mcpvault_type === 'agent_task' && !finished(n.fm)))
                    throw guidanceError(new Error('Finish or cancel project tasks before closing the temporary team'), 'guid-af96c1af5ebec3c8');
                fm.team_status = params.teamStatus;
            }
            const groupGuards = [];
            for (const groupId of fm.group_ids || []) {
                const groupPath = `Community/Groups/${normalizeScopeId(groupId, 'groupId')}.md`;
                const group = await this.visible(groupPath);
                if (group.frontmatter.mcpvault_type !== 'work_group')
                    throw guidanceError(new Error('Group is unavailable'), 'guid-557e3c65a6af7537');
                groupGuards.push({ path: groupPath, expectedRevision: group.revision });
            }
            fm.participants = [actor.accountId, ...listField(params.participants ?? fm.participants ?? [], 'participants', 100)
                    .map(id => normalizeScopeId(id, 'participant')).filter(id => id !== actor.accountId)];
            const accounts = new Set((await this.auth.listPrincipals()).map(p => p.accountId));
            if (fm.participants.some((id) => !accounts.has(id)))
                throw guidanceError(new Error('Every participant must identify a registered account'), 'guid-be8515a686263419');
            fm.wip_limit = integer(params.wipLimit ?? fm.wip_limit, 3, 100, 'wipLimit');
            fm.personal_wip_limit = integer(params.personalWipLimit ?? fm.personal_wip_limit, 1, 20, 'personalWipLimit');
            if (params.roomId !== undefined)
                fm.room_id = params.roomId ? normalizeScopeId(params.roomId, 'roomId') : '';
            const room = fm.room_id ? await this.communityTarget('room', fm.room_id) : undefined;
            fm.created_at ||= timestamp();
            fm.updated_at = timestamp();
            const result = { success: true, projectId: id, path, requestId: request.requestId,
                nextAction: { endpoint: 'work.project', args: { op: 'read', projectId: id } } };
            const content = prior?.content ?? `# ${fm.title}\n\n${fm.goal}\n`;
            this.addReceipt(fm, content, request, result, prior);
            await this.actor(params.principal);
            const write = { path, content, frontmatter: fm, expectedRevision: prior?.revision || 'missing' };
            const receipt = room || groupGuards.length
                ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, [...groupGuards, ...(room ? [{ path: room.path, expectedRevision: room.note.revision }] : [])], { maxGuards: 32 })
                : await this.fileSystem.writeNoteWithReceipt(write);
            await this.fileSystem.readNote(path, MAX_NOTE_CONTENT_BYTES);
            return { ...result, revision: receipt.revision };
        });
    }
    async inventory(projectId) {
        const result = [];
        for await (const n of iterateNotes(this.fileSystem, {
            ...(projectId ? { filters: { project_id: projectId } } : { pathPrefix: 'Community/Tasks', filters: { mcpvault_type: 'agent_task' } }),
            includeContent: false, sortBy: 'path', sortOrder: 'asc',
        }, path => this.access.canAccessPhysicalPath(path))) {
            if (isModerationHidden(n.frontmatter))
                continue;
            const fm = n.frontmatter;
            // Managed task identity is its exact canonical path, not editable metadata
            // in another visible note. Never use a decoy ID to query a private ledger.
            if (fm.mcpvault_type === 'agent_task') {
                try {
                    if (typeof fm.task_id !== 'string' || n.path !== taskPath(fm.task_id) || fm.task_id !== normalizeScopeId(fm.task_id, 'taskId'))
                        continue;
                }
                catch {
                    continue;
                }
            }
            if (fm.mcpvault_type === 'agent_task' || (projectId && isActionableKnowledge(fm) && fm.mcpvault_type !== 'work_project'))
                result.push({ path: n.path, fm, ...(n.revision && { revision: n.revision }) });
        }
        return result;
    }
    async accountForAssignee(value, project) {
        const id = normalizeScopeId(value, 'assignee');
        const all = await this.auth.listPrincipals();
        const direct = all.find(p => p.accountId === id);
        const candidates = direct ? [direct] : all.filter(p => displayIdentity(p) === id);
        if (candidates.length !== 1)
            throw guidanceError(new Error('Assignee must resolve to exactly one registered account'), 'guid-5e48eef7d2ff7f31');
        this.member(project, candidates[0]);
        return candidates[0];
    }
    publicPath(value) {
        const resolved = this.access.resolveExternalPath(value);
        const path = resolved.replace(/\\/g, '/');
        if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0') || path.split('/').some(s => s === '..' || /[. ]$/.test(s)))
            throw guidanceError(new Error('Artifact path must be a canonical public vault path'), 'guid-19c84603d15136e7');
        const normalized = posix.normalize(path);
        if (!this.access.canAccessPhysicalPath(normalized))
            throw guidanceError(new Error('Artifact path must be visible public'), 'guid-742e675d8785d46a');
        return normalized;
    }
    async artifacts(value, principal, guards, requireRevision = false) {
        if (!Array.isArray(value) || value.length > 20)
            throw guidanceError(new Error('artifacts must be an array of at most 20 locators'), 'guid-37ea3105a8a8b481');
        const artifacts = [];
        for (const input of value) {
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw guidanceError(new Error('Artifact must be a locator'), 'guid-c2631d487961f3eb');
            const item = {};
            for (const field of ['repository', 'branch', 'commit', 'revision'])
                if (input[field] !== undefined)
                    item[field] = textField(input[field], `artifact.${field}`, 300, true);
            if (item.repository && /^[a-z][a-z0-9+.-]*:\/\//i.test(item.repository)) {
                const url = new URL(item.repository);
                if (url.username || url.password || url.search)
                    throw guidanceError(new Error('Repository locators must not contain credentials or query tokens'), 'guid-a0ec1e8c762998af');
            }
            if (item.commit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.commit))
                throw guidanceError(new Error('Artifact commit must be an immutable full 40- or 64-character hexadecimal Git object ID (advisory, not fetched)'), 'guid-11e48ca055aa2e96');
            if (input.files !== undefined)
                item.files = listField(input.files, 'artifact.files', 20).map(p => {
                    if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.replace(/\\/g, '/').split('/').includes('..'))
                        throw guidanceError(new Error('Artifact files must be repository-relative locators'), 'guid-98057bffa6db93d1');
                    return p.replace(/\\/g, '/');
                });
            if (input.path !== undefined) {
                item.path = this.publicPath(textField(input.path, 'artifact.path', 500, true));
                await this.references.validateAndNormalize([item.path], 'Community/Tasks/artifacts.md', principal);
                const note = await this.visible(item.path);
                if (requireRevision && (!item.revision || item.revision !== note.revision))
                    throw guidanceError(new Error('Artifact revision is missing or stale; update artifacts before approval/completion'), 'guid-1703b8bf35a1cda7');
                if (item.revision && item.revision !== note.revision)
                    throw guidanceError(new Error('Artifact revision is stale'), 'guid-fbbd13dad36c5414');
                guards.push({ path: item.path, expectedRevision: note.revision });
            }
            else if (!item.repository || !item.commit)
                throw guidanceError(new Error('External artifacts require repository and commit locators (advisory only)'), 'guid-f28729debd63666a');
            artifacts.push(item);
        }
        return artifacts;
    }
    async dependencies(fm, taskId, guards) {
        const active = new Set([taskId]);
        const checked = new Set();
        const visit = async (id) => {
            if (active.has(id))
                throw guidanceError(new Error('Dependency or parent cycle detected'), 'guid-f43c93d5c362cff8');
            if (checked.has(id))
                return;
            if (active.size + checked.size >= 100)
                throw guidanceError(new Error('Dependency graph exceeds the bounded validation window'), 'guid-1fcbc5cd5c24a84d');
            active.add(id);
            const note = await this.visible(taskPath(id));
            if (note.frontmatter.mcpvault_type !== 'agent_task' || note.frontmatter.project_id !== fm.project_id)
                throw guidanceError(new Error('Dependency must be a visible task in the same project'), 'guid-e85ad1aff682e447');
            guards.push({ path: taskPath(id), expectedRevision: note.revision });
            for (const dependency of [...(note.frontmatter.depends_on || []), ...(note.frontmatter.parent_task_id ? [note.frontmatter.parent_task_id] : [])])
                await visit(normalizeScopeId(dependency, 'dependency'));
            active.delete(id);
            checked.add(id);
        };
        for (const id of [...(fm.depends_on || []), ...(fm.parent_task_id ? [fm.parent_task_id] : [])])
            await visit(id);
    }
    async ready(fm) {
        for (const id of fm.depends_on || []) {
            const n = await this.visible(taskPath(id));
            if (n.frontmatter.project_id !== fm.project_id || n.frontmatter.status !== 'completed')
                throw guidanceError(new Error('Dependencies must be completed before starting or claiming work'), 'guid-2edfc9f4af791b1b');
        }
    }
    async wip(fm, project, taskId, prior = {}) {
        if (!started(fm))
            return;
        const addsProjectWip = !started(prior);
        const addsPersonalWip = fm.assignee_account_id && (!started(prior) || prior.assignee_account_id !== fm.assignee_account_id);
        if (!addsProjectWip && !addsPersonalWip)
            return;
        let projectCount = 0;
        let personalCount = 0;
        const projectLimit = integer(project.wip_limit, 3, 100, 'project wip_limit');
        let personalLimit = integer(project.personal_wip_limit, 1, 20, 'project personal_wip_limit');
        for (const item of await this.inventory()) {
            if (item.fm.task_id === taskId || !started(item.fm) || !item.fm.project_id)
                continue;
            if (item.fm.project_id === fm.project_id)
                projectCount++;
            if (fm.assignee_account_id && item.fm.assignee_account_id === fm.assignee_account_id) {
                personalCount++;
                const other = await this.projectNote(item.fm.project_id);
                personalLimit = Math.min(personalLimit, integer(other.frontmatter.personal_wip_limit, 1, 20, 'active project personal_wip_limit'));
            }
        }
        if (addsProjectWip && projectCount >= projectLimit)
            throw guidanceError(new Error('Project WIP limit reached'), 'guid-0bdbde9dbbc6920d');
        if (addsPersonalWip && personalCount >= personalLimit)
            throw guidanceError(new Error('Personal WIP limit reached across projects'), 'guid-bab2cb98d8f264c9');
    }
    async runTask(action, params, proceed) {
        const intent = this.intents.get(params);
        this.intents.delete(params);
        const workshopCreate = this.workshopCreates.get(params);
        this.workshopCreates.delete(params);
        params = { ...params };
        return coordinate(async () => {
            const prior = action === 'update' ? await this.visible(taskPath(params.taskId)) : undefined;
            if (params.taskId)
                await this.options.assertTaskMutation?.(normalizeScopeId(params.taskId, 'taskId'));
            const requestedProject = prior?.frontmatter.project_id || params.projectId;
            if (!requestedProject) {
                if (params.responsibility !== undefined || params.changeContext !== undefined || params.migrateReviewContract !== undefined)
                    throw guidanceError(new Error('Task responsibility requires an explicit Work project; legacy tasks are not automatically migrated'), 'guid-a7a4967a7d9d677d');
                if (intent)
                    throw guidanceError(new Error('Work actions require a project-backed task'), 'guid-b17f67cf5c49f2e8');
                return proceed();
            }
            const projectId = normalizeScopeId(requestedProject, 'projectId');
            if (prior && (!prior.frontmatter.project_id || (params.projectId !== undefined && normalizeScopeId(params.projectId, 'projectId') !== projectId)))
                throw guidanceError(new Error('Task project ownership is immutable; existing unprojected tasks are not migrated'), 'guid-a714750a675ca5e7');
            const actor = await this.actor(params.principal);
            const project = await this.projectNote(normalizeScopeId(projectId, 'projectId'));
            if (project.frontmatter.team_status === 'completed')
                throw guidanceError(new Error('Temporary team is closed; project owner must explicitly reopen it'), 'guid-f088e892bea65283');
            const moderate = this.auth.hasCapability(actor, 'moderate');
            if (!(moderate && ((intent?.kind === 'claim' && intent.params.op === 'release') || (intent?.kind === 'review' && intent.params.op === 'override'))))
                this.member(project.frontmatter, actor);
            const original = intent?.params || { ...params };
            const actionId = intent ? `${intent.kind}.${intent.params.op}` : `task.${action}`;
            const id = params.taskId ? normalizeScopeId(params.taskId, 'taskId') : `task-${fingerprint({ actor: actor.accountId, requestId: params.requestId }).slice(0, 24)}`;
            const request = this.request(original, actionId, id);
            params.taskId = id;
            const current = prior || (await this.fileSystem.noteExists(taskPath(id)) ? await this.visible(taskPath(id)) : undefined);
            if (current) {
                const retry = this.retry(current, request);
                if (retry)
                    return retry;
            }
            if (action === 'create' && current)
                throw guidanceError(new Error('Task already exists'), 'guid-6a9b24709dcf6239');
            if (prior)
                this.revision(prior, params.expectedRevision);
            const fm = { ...prior?.frontmatter, project_id: projectId, status: taskStatus(prior?.frontmatter.status) };
            const generation = Number(fm.claim_generation || 0);
            const reviewer = intent?.kind === 'review' && intent.params.op !== 'request';
            const privilegedRelease = intent?.kind === 'claim' && intent.params.op === 'release';
            if (prior && !reviewer && !privilegedRelease && params.expectedGeneration !== generation)
                throw guidanceError(new Error('expectedGeneration must match the current claim generation'), 'guid-169cbe45dbdcc739');
            if (prior && params.expectedGeneration !== undefined && params.expectedGeneration !== generation)
                throw guidanceError(new Error('Revoked claim generation'), 'guid-e6042ccfc84b07f2');
            if (!prior) {
                fm.requester_account_id = actor.accountId;
                fm.author_account_id = actor.accountId;
                fm.claim_generation = 0;
                fm.status = 'proposed';
                fm.work_kind = 'general';
                fm.depends_on = [];
                fm.completion_criteria = [];
                fm.artifacts = [];
                if (project.frontmatter.review_policy?.version === 2) {
                    fm.work_review_contract = 2;
                    fm.work_review_policy = reviewPolicy(project.frontmatter.review_policy);
                }
            }
            if (params.migrateReviewContract !== undefined) {
                if (fm.work_review_contract === 2)
                    throw guidanceError(new Error('Task already uses review contract 2; migration cannot erase existing requirements'), 'guid-8874a5524c617b92');
                if (params.migrateReviewContract !== true || !prior || fm.requester_account_id !== actor.accountId || finished(fm) || project.frontmatter.review_policy?.version !== 2)
                    throw guidanceError(new Error('Only the task owner can explicitly migrate active work to project review contract 2'), 'guid-5c0f5e3f08b7eca3');
                fm.work_review_contract = 2;
                fm.work_review_policy = reviewPolicy(project.frontmatter.review_policy);
                delete fm.work_review;
            }
            if (params.changeContext !== undefined) {
                if (fm.work_review_contract !== 2)
                    throw guidanceError(new Error('Change context requires explicit review contract 2 migration'), 'guid-233d8368e1af6979');
                fm.change_context = changeContext(params.changeContext);
                for (const locator of fm.change_context.locators)
                    if (locator.path)
                        locator.path = this.publicPath(locator.path);
            }
            const isRequester = fm.requester_account_id === actor.accountId;
            const isAssignee = fm.assignee_account_id === actor.accountId;
            const accepting = intent?.kind === 'handoff' && intent.params.op === 'accept';
            const claiming = intent?.kind === 'claim' && intent.params.op !== 'release';
            const selfClaim = !fm.assignee_account_id && [actor.accountId, displayIdentity(actor)].includes(params.assignee);
            if (prior && !isRequester && !isAssignee && !reviewer && !accepting && !claiming && !selfClaim && !privilegedRelease)
                throw guidanceError(new Error('Only task requester or assignee account can update work'), 'guid-ca3d4c2dc3f79798');
            if (params.description !== undefined)
                fm.description = textField(params.description, 'description', 4000, true);
            if (params.completionCriteria !== undefined)
                fm.completion_criteria = listField(params.completionCriteria, 'completionCriteria');
            if (params.dependsOn !== undefined)
                fm.depends_on = listField(params.dependsOn, 'dependsOn', 20).map(id => normalizeScopeId(id, 'dependency'));
            if (params.parentTaskId !== undefined)
                fm.parent_task_id = params.parentTaskId ? normalizeScopeId(params.parentTaskId, 'parentTaskId') : '';
            if (params.workKind !== undefined) {
                if (!WORK_KINDS.includes(params.workKind))
                    throw guidanceError(new Error('Invalid workKind'), 'guid-26f9290ec2e8bd9b');
                if (fm.work_kind !== 'general' && fm.work_kind !== params.workKind)
                    throw guidanceError(new Error('Risk workKind cannot be lowered or relabeled to evade review'), 'guid-b728b4395f1fcd65');
                fm.work_kind = params.workKind;
            }
            if (params.discussionSlug !== undefined)
                fm.discussion_slug = params.discussionSlug ? normalizeScopeId(params.discussionSlug, 'discussionSlug') : '';
            if (params.verification !== undefined)
                fm.verification = textField(params.verification, 'verification', 1000);
            if (params.responsibility !== undefined) {
                fm.responsibility = responsibility(params.responsibility);
                if (prior && started(prior.frontmatter) && fingerprint(assignmentShape(fm.responsibility)) !== fingerprint(assignmentShape(prior.frontmatter.responsibility)))
                    throw guidanceError(new Error('Release active work before changing its responsibility role or resources; handoff preserves the responsibility'), 'guid-e1b5d0184d4835f6');
            }
            // Match AgentTaskService's canonical value before ANY readiness, WIP or
            // completion check. Validating a raw value then persisting a normalized
            // one would let alternate casing bypass those checks.
            if (params.status !== undefined)
                fm.status = taskStatus(params.status, taskStatus(fm.status));
            const guards = [{ path: projectPath(projectId), expectedRevision: project.revision }, ...(workshopCreate?.guards || [])];
            if (params.discussionSlug !== undefined && fm.discussion_slug) {
                const discussion = await this.communityTarget('post', fm.discussion_slug);
                guards.push({ path: discussion.path, expectedRevision: discussion.note.revision });
            }
            fm.artifacts = await this.artifacts(params.artifacts ?? fm.artifacts ?? [], actor, guards);
            if (fm.responsibility) {
                const declared = responsibility(fm.responsibility);
                if (declared.coversCriteria?.some(c => !project.frontmatter.completion_criteria?.includes(c)))
                    throw guidanceError(new Error('coversCriteria must name declared project completion criteria'), 'guid-b8de90e5165d86fd');
                for (const resource of declared.resources || [])
                    if (resource.path) {
                        resource.path = this.publicPath(resource.path);
                        await this.references.validateAndNormalize([resource.path], taskPath(id), actor);
                        const target = await this.visible(resource.path);
                        guards.push({ path: resource.path, expectedRevision: target.revision });
                    }
                fm.responsibility = declared;
            }
            await this.dependencies(fm, id, guards);
            if (params.assignee !== undefined) {
                const account = params.assignee ? await this.accountForAssignee(params.assignee, project.frontmatter) : undefined;
                if (!account || account.accountId !== actor.accountId || (prior && fm.assignee_account_id && fm.assignee_account_id !== actor.accountId))
                    throw guidanceError(new Error('Assignee changes require self-claim or exact-account handoff; use release to clear'), 'guid-dc5342e7d8a49bb6');
                if (account.accountId !== fm.assignee_account_id)
                    fm.claim_generation = generation + 1;
                fm.assignee_account_id = account.accountId;
                fm.assignee = displayIdentity(account);
                params.assignee = displayIdentity(account);
            }
            let reviewContext;
            if (fm.work_review_contract === 2) {
                const state = await this.reviewEngine.state(fm, project.frontmatter, (intent?.kind === 'review' && ['request', 'approve', 'self_verify'].includes(intent.params.op)) || (fm.status === 'completed' && fm.work_review?.decision !== 'override'));
                fm.work_context_fingerprint = state.fingerprint;
                guards.push(...state.guards);
                reviewContext = state.context;
            }
            if (intent)
                await this.applyIntent(intent, params, fm, project.frontmatter, actor, reviewContext);
            // Legacy status/assignee updates get exactly the same readiness and WIP gate.
            if (['accepted', 'in_progress', 'blocked', 'in_review'].includes(fm.status) && !fm.assignee_account_id)
                throw guidanceError(new Error('Claim an assignee account before starting work'), 'guid-c00c6990b37c6049');
            if (['in_progress', 'blocked', 'in_review'].includes(fm.status))
                fm.started_at ||= timestamp();
            const newlyClaimed = fm.assignee_account_id && fm.assignee_account_id !== prior?.frontmatter.assignee_account_id;
            if (newlyClaimed)
                fm.started_at ||= timestamp();
            if (prior && fm.claim_generation !== generation)
                delete fm.work_review;
            if (newlyClaimed || (started(fm) && (!started(prior?.frontmatter || {}) || params.dependsOn !== undefined)) || fm.status === 'completed')
                await this.ready(fm);
            await this.wip(fm, project.frontmatter, id, prior?.frontmatter);
            await this.resourceAdmission(fm, id);
            if (prior && reviewBasis(fm) !== reviewBasis(prior.frontmatter) && intent?.kind !== 'review')
                delete fm.work_review;
            if (fm.status === 'completed') {
                if (!fm.completion_criteria?.length || !fm.verification)
                    throw guidanceError(new Error('Completion requires completionCriteria and verification'), 'guid-3a811c7a9e77bee9');
                await this.artifacts(fm.artifacts, actor, guards, true);
                if (fm.work_kind !== 'general' || fm.work_review_contract === 2) {
                    const approval = fm.work_review;
                    const decisions = fm.work_kind === 'general' && fm.work_review_contract === 2 ? ['approve', 'override', 'self_verify'] : ['approve', 'override'];
                    if (!approval || !decisions.includes(approval.decision) || approval.fingerprint !== reviewBasis(fm))
                        throw guidanceError(new Error('Completion requires current review approval or explicit permitted self verification'), 'guid-545d3ddced904170');
                }
            }
            params.status = fm.status;
            if (fm.status !== prior?.frontmatter.status && !params.reason)
                params.reason = intent ? textField(intent.params.reason || `${intent.kind} ${intent.params.op}`, 'reason', 500) : params.reason;
            fm.last_progress_at = timestamp();
            this.event(fm, { action: actionId, actor: actor.accountId, reason: textField(params.reason, 'reason', 500), status: fm.status, generation: fm.claim_generation,
                ...(intent?.kind === 'handoff' && intent.params.op === 'accept' && {
                    fromAccountId: prior.frontmatter.assignee_account_id, toAccountId: fm.assignee_account_id,
                    fromGeneration: generation, toGeneration: fm.claim_generation,
                    proposalRevision: prior.revision, acceptorAccountId: actor.accountId,
                }),
                ...(privilegedRelease && prior?.frontmatter.started_at && { releasedStartedAt: prior.frontmatter.started_at, releasedGeneration: generation }) });
            let result = {};
            const context = {
                // AgentTaskService owns its normalized disposition, status metadata,
                // description, and timestamps; never overlay stale copies of those.
                authorize: true, frontmatter: Object.fromEntries(TASK_EXTENSION_FIELDS.filter(key => key in fm).map(key => [key, fm[key]])),
                removeFields: Object.keys(prior?.frontmatter || {}).filter(key => !(key in fm)),
                write: async (write, applicationGuards = []) => {
                    await this.actor(params.principal);
                    const currentProject = await this.projectNote(projectId);
                    if (currentProject.revision !== project.revision)
                        throw guidanceError(new Error('Project revision changed during work mutation'), 'guid-38d47bff2f1248d3');
                    if (!moderate || (!privilegedRelease && !(intent?.kind === 'review' && intent.params.op === 'override')))
                        this.member(currentProject.frontmatter, actor);
                    await this.wip(fm, currentProject.frontmatter, id, prior?.frontmatter);
                    await this.resourceAdmission(fm, id);
                    const combined = [...guards, ...applicationGuards].filter(g => g.path !== write.path);
                    const unique = [...new Map(combined.map(g => [g.path.toLowerCase(), g])).values()];
                    if (combined.some(g => unique.find(u => u.path.toLowerCase() === g.path.toLowerCase())?.expectedRevision !== g.expectedRevision))
                        throw guidanceError(new Error('Related revision changed during work mutation'), 'guid-cdb273014178bb3a');
                    // The existing filesystem supports nine locked related revisions.
                    // Fail closed rather than drop guards from a larger mutation.
                    if (unique.length > (workshopCreate || fm.work_review_contract === 2 ? 128 : 9))
                        throw guidanceError(new Error('Work mutation exceeds related revision guard budget; split the dependency/artifact change'), 'guid-fd006d893a9a3fc2');
                    result = { success: true, taskId: id, path: write.path, status: fm.status, generation: fm.claim_generation,
                        claimGeneration: fm.claim_generation, ...(fm.assignee_account_id && { assigneeAccountId: fm.assignee_account_id }),
                        artifactFingerprint: reviewBasis(fm), requestId: request.requestId,
                        nextAction: { endpoint: 'work.packet', args: { taskId: id } } };
                    if (intent?.kind === 'claim' && intent.paidContractId) {
                        if (write.frontmatter.economy_contract_id && write.frontmatter.economy_contract_id !== intent.paidContractId)
                            throw guidanceError(new Error('Paid contract marker conflict'), 'guid-bb625df8fd8ea2e9');
                        write.frontmatter.economy_contract_id = intent.paidContractId;
                        write.frontmatter.economy_claim_request_id = request.requestId;
                        write.frontmatter.economy_claim_generation = fm.claim_generation;
                    }
                    this.addReceipt(write.frontmatter, write.content, request, result, prior);
                    if (workshopCreate) {
                        write.frontmatter.workshop_output = workshopCreate.receipt;
                        write.frontmatter.workshop_output_content_sha256 = fingerprint(write.content);
                        // Include the trusted marker in the existing retry-state digest.
                        const stored = write.frontmatter.work_receipts.at(-1);
                        stored.state = this.receiptState(write.frontmatter, write.content);
                    }
                    const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, unique, {
                        ...(workshopCreate ? { maxGuards: 128, assertAccess: workshopCreate.assertAccess } : fm.work_review_contract === 2 ? { maxGuards: 128 } : {}),
                        ...(fm.work_review_contract === 2 && { maxBytes: MAX_NOTE_CONTENT_BYTES }),
                    });
                    result = { ...result, revision: receipt.revision };
                    await this.fileSystem.readNote(write.path, MAX_NOTE_CONTENT_BYTES);
                    return receipt;
                },
            };
            await proceed(context, params);
            return result;
        });
    }
    async applyIntent(intent, params, fm, project, actor, context) {
        const generation = Number(fm.claim_generation || 0);
        const own = fm.assignee_account_id === actor.accountId;
        if (intent.kind === 'claim') {
            if (intent.params.op === 'release') {
                if (!own && fm.requester_account_id !== actor.accountId && project.owner_account_id !== actor.accountId && !this.auth.hasCapability(actor, 'moderate'))
                    throw guidanceError(new Error('Only owner, requester, assignee or host moderator may release work'), 'guid-88ad904c4e62fe3c');
                textField(intent.params.reason, 'release reason', 500, true);
                delete fm.assignee_account_id;
                delete fm.assignee;
                delete fm.work_handoff;
                delete fm.started_at;
                fm.claim_generation = generation + 1;
                fm.status = 'proposed';
                params.assignee = '';
            }
            else {
                if (finished(fm))
                    throw guidanceError(new Error('Finished work cannot be claimed'), 'guid-2d3e7bee25f51bd8');
                if (fm.assignee_account_id && !own)
                    throw guidanceError(new Error('Task already has another assignee; use handoff'), 'guid-83276b018061f992');
                if (!own)
                    fm.claim_generation = generation + 1;
                fm.assignee_account_id = actor.accountId;
                fm.assignee = displayIdentity(actor);
                params.assignee = displayIdentity(actor);
                fm.status = intent.params.op === 'start' ? 'in_progress' : 'accepted';
                // Claim reserves implementation capacity even before the first start.
                fm.started_at ||= timestamp();
            }
            return;
        }
        if (intent.kind === 'handoff') {
            if (finished(fm))
                throw guidanceError(new Error('Finished work cannot be handed off'), 'guid-9995bc4744a8ffac');
            if (intent.params.op === 'propose') {
                if (!own)
                    throw guidanceError(new Error('Only current assignee may propose a handoff'), 'guid-ee576be972203c63');
                const to = normalizeScopeId(textField(intent.params.toAccountId, 'toAccountId', 64, true), 'toAccountId');
                const target = (await this.auth.listPrincipals()).find(p => p.accountId === to);
                if (!target || to === actor.accountId)
                    throw guidanceError(new Error('Handoff requires another exact registered account'), 'guid-55d279798352054f');
                this.member(project, target);
                fm.work_handoff = { state: 'proposed', from_account_id: actor.accountId, to_account_id: to, generation,
                    completed: textField(intent.params.completed, 'completed', 500), remaining: textField(intent.params.remaining, 'remaining', 500),
                    blocker: textField(intent.params.blocker, 'blocker', 500), next_action: textField(intent.params.nextAction, 'nextAction', 500, true),
                    artifacts: fm.artifacts, proposed_at: timestamp() };
            }
            else {
                const offer = fm.work_handoff;
                if (!offer || offer.state !== 'proposed' || offer.to_account_id !== actor.accountId || offer.generation !== generation
                    || offer.from_account_id !== fm.assignee_account_id || !Number.isSafeInteger(generation) || generation < 1
                    || !Number.isSafeInteger(generation + 1))
                    throw guidanceError(new Error('Only the exact handoff recipient can accept the current proposal'), 'guid-e3de119736b9f354');
                fm.assignee_account_id = actor.accountId;
                fm.assignee = displayIdentity(actor);
                params.assignee = displayIdentity(actor);
                fm.claim_generation = generation + 1;
                fm.work_handoff = { ...offer, state: 'accepted', accepted_at: timestamp() };
                delete fm.work_review;
            }
            return;
        }
        const op = intent.params.op;
        if (op === 'request') {
            if (!own)
                throw guidanceError(new Error('Only current assignee may request review'), 'guid-dcee0126093f2357');
            if (!fm.completion_criteria?.length || !fm.verification)
                throw guidanceError(new Error('Review request requires completionCriteria and verification'), 'guid-d96a5ea839d4822e');
            if (finished(fm))
                throw guidanceError(new Error('Finished work cannot request review'), 'guid-33302d71bb7c9304');
            fm.status = 'in_review';
            fm.work_review = { decision: 'request', fingerprint: reviewBasis(fm), account_id: actor.accountId, at: timestamp() };
        }
        else {
            if (op === 'override') {
                if (!this.auth.hasCapability(actor, 'moderate'))
                    throw guidanceError(new Error('Only a host moderator can explicitly override review'), 'guid-0518e4d6bc2421fa');
            }
            else if (op === 'self_verify') {
                if (fm.work_review_contract !== 2 || fm.work_kind !== 'general' || !own)
                    throw guidanceError(new Error('Explicit self verification requires ordinary v2 work and its assignee; high-risk work needs independent review'), 'guid-d71df9c654d05d06');
            }
            else {
                this.member(project, actor);
                if ([fm.author_account_id, fm.requester_account_id, fm.assignee_account_id].includes(actor.accountId))
                    throw guidanceError(new Error('Review requires an independent authenticated account, not author or assignee'), 'guid-2c8b1d68777ff712');
            }
            const reason = textField(intent.params.reason, 'review reason', 500, true);
            if (fm.status !== 'in_review' || !fm.work_review)
                throw guidanceError(new Error('Review must first be explicitly requested'), 'guid-f6fc982b45d3dd0d');
            if (!intent.params.artifactFingerprint || intent.params.artifactFingerprint !== reviewBasis(fm))
                throw guidanceError(new Error('Review artifactFingerprint does not match the current basis'), 'guid-74fba1d52f5f41d3');
            await this.artifacts(fm.artifacts || [], actor, [], true);
            let evidence = {};
            if (fm.work_review_contract === 2 && op !== 'override')
                evidence = await this.reviewEngine.validate({ taskId: params.taskId, accountId: actor.accountId,
                    basis: reviewBasis(fm), context: context || fm.change_context, criteria: fm.completion_criteria, policy: effectiveReviewPolicy(fm, project), artifacts: fm.artifacts,
                    ...(intent.params.contextReceipts !== undefined && { receipts: intent.params.contextReceipts }),
                    ...(intent.params.checks !== undefined && { checks: intent.params.checks }), approve: op === 'approve' || op === 'self_verify' });
            fm.work_review = { decision: op, fingerprint: reviewBasis(fm), account_id: actor.accountId, reason, at: timestamp(),
                ...(fm.work_review_contract === 2 && { contract: 2, verification_level: op === 'override' ? 'host_override' : op === 'self_verify' ? 'self_verified' : op === 'approve' ? 'independently_reviewed' : 'pending', ...evidence }) };
            if (op === 'changes_requested' || op === 'question')
                fm.status = 'in_progress';
        }
        fm.work_reviews = [...(fm.work_reviews || []).slice(-(EVENTS - 1)), fm.work_review];
    }
    mutate(intent) {
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
    async claim(params) {
        if (!['claim', 'start', 'release'].includes(params.op))
            throw guidanceError(new Error('Invalid claim operation'), 'guid-faea3df717f2bfc1');
        return this.mutate({ kind: 'claim', params });
    }
    /** Internal paid lease still traverses every ordinary Work admission rule. */
    async claimPaid(params, contractId) {
        if (params.op !== 'start')
            throw guidanceError(new Error('Paid bridge only starts a claim'), 'guid-563bc26eecbcbcbb');
        return this.mutate({ kind: 'claim', params, paidContractId: normalizeScopeId(contractId, 'contractId') });
    }
    async handoff(params) {
        if (!['propose', 'accept'].includes(params.op))
            throw guidanceError(new Error('Invalid handoff operation'), 'guid-10b12447ebbb54c0');
        return this.mutate({ kind: 'handoff', params });
    }
    async review(params) {
        if (!['request', 'approve', 'self_verify', 'changes_requested', 'question', 'override'].includes(params.op))
            throw guidanceError(new Error('Invalid review operation'), 'guid-c35b8c849912b588');
        return this.mutate({ kind: 'review', params });
    }
    blocker(fm) {
        const value = fm.blocker || fm.work_handoff?.blocker || fm.waiting_for
            || ((fm.status === 'blocked' || fm.task_status === 'blocked') ? fm.status_reason : '');
        return typeof value === 'string' ? value.slice(0, 500) : '';
    }
    async boardWip(project, tasks, principal) {
        if (!principal)
            return;
        let actor;
        try {
            actor = await this.actor(principal);
            this.member(project, actor);
        }
        catch {
            return;
        }
        let used = 0;
        let limit = integer(project.personal_wip_limit, 1, 20, 'project personal_wip_limit');
        for (const task of await this.inventory()) {
            if (!task.fm.project_id || !started(task.fm) || task.fm.assignee_account_id !== actor.accountId)
                continue;
            let other;
            try {
                other = await this.projectNote(task.fm.project_id);
            }
            catch {
                continue; /* Hidden projects cannot contribute disclosed counts. */
            }
            used++;
            limit = Math.min(limit, integer(other.frontmatter.personal_wip_limit, 1, 20, 'active project personal_wip_limit'));
        }
        return { project: { used: tasks.filter(t => started(t.fm)).length, limit: integer(project.wip_limit, 3, 100, 'project wip_limit') }, personal: { used, limit } };
    }
    resourceKeys(fm) {
        const keys = new Set();
        for (const artifact of Array.isArray(fm.artifacts) ? fm.artifacts : []) {
            if (!artifact || typeof artifact !== 'object')
                continue;
            if (typeof artifact.path === 'string' && artifact.path)
                keys.add(JSON.stringify(['path', artifact.path]));
            if (typeof artifact.repository === 'string' && artifact.repository && Array.isArray(artifact.files)) {
                for (const file of artifact.files)
                    if (typeof file === 'string')
                        keys.add(JSON.stringify(['repository', artifact.repository, file]));
            }
        }
        return keys;
    }
    async resourceAdmission(fm, taskId) {
        if (finished(fm) || !(started(fm) || fm.assignee_account_id) || !fm.responsibility)
            return;
        const declared = responsibility(fm.responsibility);
        if (declared.mode !== 'exclusive_write')
            return;
        const wanted = new Set(declaredResourceKeys(declared));
        // A hidden task still owns its declared reservation. Never return this
        // internal admission inventory as a report or disclose the competing actor.
        for await (const other of iterateNotes(this.fileSystem, { pathPrefix: 'Community/Tasks', filters: { mcpvault_type: 'agent_task' }, includeContent: false }, path => this.access.canAccessPhysicalPath(path))) {
            const prior = other.frontmatter;
            if (prior.task_id === taskId || finished(prior) || !(started(prior) || prior.assignee_account_id) || !prior.responsibility)
                continue;
            const reserved = responsibility(prior.responsibility);
            if (reserved.mode === 'exclusive_write' && declaredResourceKeys(reserved).some(key => wanted.has(key))) {
                throw guidanceError(new Error('Exclusive resource overlap; coordinate or release the existing reservation before claiming'), 'guid-72ba3ac7ccff169c');
            }
        }
    }
    async responsibilityItems(fm) {
        if (!fm.responsibility)
            return [];
        let declared;
        try {
            declared = responsibility(fm.responsibility);
        }
        catch {
            return [{ kind: 'responsibility_diagnostic', text: guidanceText('guid-f44d6f86f70cd6e7', 'Malformed responsibility; repair through the current task contract before further work.') }];
        }
        const items = [];
        for (const key of ['question', 'perspective', 'mode'])
            if (declared[key])
                items.push({ kind: 'responsibility', field: key, text: declared[key] });
        for (const key of ['conditions', 'deliverables', 'coversCriteria'])
            for (const text of declared[key] || [])
                items.push({ kind: 'responsibility', field: key, text });
        for (const resource of declared.resources || []) {
            if (resource.path) {
                try {
                    const path = this.publicPath(resource.path);
                    const note = await this.visible(path);
                    items.push({ kind: 'resource', path, revision: note.revision });
                }
                catch { /* Do not disclose a hidden resource, even its declared path. */ }
            }
            else
                items.push({ kind: 'resource', ...resource, advisory: true });
        }
        return items;
    }
    async coverage(params) {
        const id = normalizeScopeId(params.projectId, 'projectId');
        const project = await this.projectNote(id);
        const inventory = await this.inventory(id);
        const tasks = inventory.filter(n => n.fm.mcpvault_type === 'agent_task' && n.fm.status !== 'cancelled');
        const rows = [];
        const reviewBases = [];
        const declared = new Map();
        for (const task of tasks) {
            try {
                if (task.fm.responsibility)
                    declared.set(task.path, responsibility(task.fm.responsibility));
            }
            catch {
                rows.push({ kind: 'invalid_responsibility', taskId: task.fm.task_id, revision: task.revision });
            }
        }
        for (const perspective of listField(project.frontmatter.required_perspectives || [], 'required_perspectives', 20)) {
            if (!tasks.some(t => declared.get(t.path)?.perspective === perspective))
                rows.push({ kind: 'missing_perspective', perspective });
        }
        for (const criterion of listField(project.frontmatter.completion_criteria || [], 'completion_criteria', 20)) {
            if (!tasks.some(t => declared.get(t.path)?.coversCriteria?.includes(criterion)))
                rows.push({ kind: 'uncovered_criterion', criterion });
        }
        for (const task of tasks) {
            const fm = task.fm;
            const base = { taskId: fm.task_id, revision: task.revision, nextAction: { endpoint: 'work.packet', args: { taskId: fm.task_id } } };
            if (!finished(fm) && !fm.assignee_account_id)
                rows.push({ ...base, kind: 'unassigned' });
            if (!declared.get(task.path)?.deliverables?.length && !fm.artifacts?.length)
                rows.push({ ...base, kind: 'missing_deliverable' });
            if (fm.work_kind !== 'general' || fm.status === 'in_review' || fm.work_review_contract === 2) {
                const current = await this.currentReview(fm, project.frontmatter);
                reviewBases.push({ path: task.path, basis: current.basis, contextSnapshot: current.contextSnapshot ?? null });
                const approved = current.current;
                if (!approved)
                    rows.push({ ...base, kind: fm.work_review ? 'review_pending_or_stale' : 'missing_review', ...(current.diagnostic && { diagnostic: current.diagnostic }) });
                if (fm.work_review_contract === 2)
                    rows.push({ ...base, kind: 'verification_coverage', declared: Boolean(fm.responsibility),
                        verified: current.verified, exception: approved && fm.work_review?.decision === 'override', verificationLevel: approved ? fm.work_review.verification_level : 'pending' });
            }
            if (fm.work_review && ['question', 'changes_requested'].includes(fm.work_review.decision))
                rows.push({ ...base, kind: 'unresolved_review' });
            if (fm.work_handoff?.state === 'proposed')
                rows.push({ ...base, kind: 'handoff_waiting' });
            if (fm.work_handoff && !fm.work_handoff.next_action)
                rows.push({ ...base, kind: 'handoff_gap' });
        }
        // Evidence can drift without changing any project/task revision. Bind the
        // cursor to the authorized derived rows as well as the Markdown inventory.
        const sig = fingerprint({ project: project.revision, inventory, rows, reviewBases });
        return page(rows, { projectId: id, projectRevision: project.revision, advisory: true,
            warning: guidanceText('guid-6d673a241b7aa571', 'Only declared visible work is checked. This is not a completeness, expertise or safety certificate.') }, sig, params, `coverage:${id}`);
    }
    async board(params) {
        const id = normalizeScopeId(params.projectId, 'projectId');
        const project = await this.projectNote(id);
        const inventory = await this.inventory(id);
        const tasks = inventory.filter(n => n.fm.mcpvault_type === 'agent_task');
        const occurrences = new Map();
        const resources = new Map(inventory.map(n => [n.path, this.resourceKeys(n.fm)]));
        for (const task of tasks)
            for (const resource of resources.get(task.path)) {
                const owners = occurrences.get(resource) || new Set();
                owners.add(task.path);
                occurrences.set(resource, owners);
            }
        const linked = new Set(tasks.flatMap(n => (n.fm.references || []).filter((p) => typeof p === 'string')));
        const taskIds = new Set(tasks.map(n => n.fm.task_id));
        const selected = inventory.filter(n => n.fm.mcpvault_type === 'agent_task' || (!linked.has(n.path) && !taskIds.has(n.fm.task_id)));
        const paid = await this.paidTasks(tasks.map(n => n.fm.task_id), params.principal);
        const currentReviews = new Map(await Promise.all(tasks.map(async (n) => [n.path, await this.currentReview(n.fm, project.frontmatter)])));
        const mutations = await this.taskMutations(tasks.map(n => n.fm.task_id));
        const rows = selected.map(n => ({ path: n.path, taskId: n.fm.task_id, title: String(n.fm.title || posix.basename(n.path)).slice(0, 180),
            status: n.fm.status || n.fm.task_status || 'open', kind: n.fm.mcpvault_type === 'agent_task' ? 'task' : 'knowledge',
            assigneeAccountId: n.fm.assignee_account_id, generation: n.fm.claim_generation,
            ...(typeof n.fm.responsibility?.perspective === 'string' && { perspective: n.fm.responsibility.perspective.slice(0, 80) }),
            ...(['exclusive_write', 'advice', 'alternative'].includes(n.fm.responsibility?.mode) && { participationMode: n.fm.responsibility.mode }),
            ...(paid[n.fm.task_id] && { paidContract: paid[n.fm.task_id] }),
            ...(mutations[n.fm.task_id] && { taskMutation: mutations[n.fm.task_id] }),
            ...(this.blocker(n.fm) && { blockedReason: this.blocker(n.fm) }),
            ...(n.fm.work_review && { review: { decision: String(n.fm.work_review.decision || '').slice(0, 32),
                    accountId: String(n.fm.work_review.account_id || '').slice(0, 64), reason: String(n.fm.work_review.reason || '').slice(0, 200),
                    current: currentReviews.get(n.path)?.current || false } }),
            ...(currentReviews.get(n.path)?.diagnostic && { reviewDiagnostic: currentReviews.get(n.path).diagnostic }),
            stale: started(n.fm) && Date.now() - Date.parse(n.fm.last_progress_at || n.fm.updated_at || '') > 86400000,
            ...(n.fm.next_action && !mutations[n.fm.task_id]?.freeMutationBlocked && { nextAction: String(n.fm.next_action).slice(0, 200) }),
            ...([...resources.get(n.path)].some(resource => {
                const owners = occurrences.get(resource);
                return owners && (owners.size > 1 || !owners.has(n.path));
            }) && { warning: guidanceText('guid-f3e8a40ffa18c42a', 'Artifact/file overlap is advisory; coordinate with peers') }),
        }));
        const wip = await this.boardWip(project.frontmatter, tasks, params.principal);
        const sig = fingerprint({ project: project.revision, inventory: selected, rows, reviewBases: [...currentReviews].map(([path, review]) => ({ path, basis: review.basis, contextSnapshot: review.contextSnapshot ?? null })), wip, paid, mutations, ...(wip && { accountId: params.principal?.accountId }) });
        return page(rows, { projectId: id, projectRevision: project.revision, fingerprint: sig, ...(wip && { wip }) }, sig, params, `board:${id}`);
    }
    async currentReview(fm, project) {
        const state = { ...fm };
        let contextSnapshot;
        try {
            if (fm.work_review_contract === 2) {
                const context = await this.reviewEngine.state(fm, project);
                state.work_context_fingerprint = context.fingerprint;
                // Keep persisted approval semantics unchanged. The reader records current
                // authorized guards even when an expected revision is already stale.
                contextSnapshot = fingerprint(context.guards);
            }
        }
        catch (error) {
            if (!(error instanceof ReviewBudgetError))
                throw error;
            return { current: false, verified: false, basis: reviewBasis({ ...state, work_context_fingerprint: 'unavailable' }), diagnostic: 'context_budget_exceeded' };
        }
        const allowed = fm.work_kind === 'general' && fm.work_review_contract === 2 ? ['approve', 'override', 'self_verify'] : ['approve', 'override'];
        const current = allowed.includes(fm.work_review?.decision) && fm.work_review?.fingerprint === reviewBasis(state);
        return { current, verified: current && fm.work_review_contract === 2 && ['approve', 'self_verify'].includes(fm.work_review?.decision), basis: reviewBasis(state), contextSnapshot };
    }
    staffingPolicy(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['taskType', 'factualVerification', 'requiredTools', 'requiredCapabilities', 'minimumTier', 'budget', 'preferences'].includes(k)))
            throw guidanceError(new Error('Invalid project staffing policy'), 'guid-580e8e0d8a5ae714');
        const policy = structuredClone(value);
        recommendStaffing({ ...policy, candidates: [], eligibleAccountIds: [], workKind: 'general', authorAccountIds: [], currentAssignments: [], workload: {}, personalWipLimit: 1 });
        return policy;
    }
    async staffing(params) {
        const actor = await this.actor(params.principal), id = normalizeScopeId(params.projectId, 'projectId');
        const project = await this.projectNote(id);
        this.member(project.frontmatter, actor);
        const inventory = await this.inventory();
        const projectTasks = inventory.filter(n => n.fm.project_id === id);
        let selected = projectTasks;
        if (params.taskId) {
            const taskId = normalizeScopeId(params.taskId, 'taskId');
            selected = projectTasks.filter(n => n.fm.task_id === taskId);
            if (selected.length !== 1)
                throw guidanceError(new Error('Staffing target unavailable'), 'guid-0a1a381d8076f396');
        }
        const policy = this.staffingPolicy(project.frontmatter.staffing_policy || { taskType: 'code' });
        const workKind = selected.find(n => n.fm.work_kind !== 'general')?.fm.work_kind || 'general';
        const deterministicAvailable = policy.taskType === 'bookkeeping' && await this.options.deterministicCoverage?.({
            principal: structuredClone(actor), project: { path: projectPath(id), revision: project.revision },
            tasks: selected.map(n => ({ path: n.path, ...(n.revision !== undefined && { revision: n.revision }) })),
        }) === true;
        const needsProfiles = !deterministicAvailable || workKind !== 'general'
            || project.frontmatter.required_perspectives?.includes('independent_review');
        const registered = await this.auth.listPrincipals();
        const eligible = [];
        for (const account of registered.filter(p => project.frontmatter.participants.includes(p.accountId))) {
            try {
                eligible.push(await this.actor(account));
            }
            catch { /* Hidden, banned, or unauthorized candidates are excluded before output. */ }
        }
        const ids = new Set(eligible.map(p => p.accountId));
        const profiles = (needsProfiles ? await this.options.executionProfiles?.() || [] : []).filter(p => ids.has(p.accountId));
        const workload = Object.fromEntries([...ids].map(account => [account, inventory.filter(n => started(n.fm) && n.fm.assignee_account_id === account).length]));
        const currentAssignments = [];
        for (const task of selected) {
            const fm = task.fm, review = await this.currentReview(fm, project.frontmatter);
            if (ids.has(fm.assignee_account_id) && fm.responsibility?.perspective && !finished(fm))
                currentAssignments.push({ accountId: fm.assignee_account_id,
                    perspective: textField(fm.responsibility.perspective, 'perspective', 80, true), active: true, verified: review.verified });
            if (review.current && fm.work_review?.decision === 'approve' && ids.has(fm.work_review.account_id))
                currentAssignments.push({ accountId: fm.work_review.account_id,
                    perspective: 'independent_review', active: true, verified: true });
        }
        const occupied = new Set(selected.filter(n => started(n.fm)).map(n => n.fm.assignee_account_id));
        const noProjectSlot = projectTasks.filter(n => started(n.fm)).length >= project.frontmatter.wip_limit;
        const result = recommendStaffing({ ...policy, ...(policy.taskType === 'bookkeeping' && { deterministicAvailable }), candidates: profiles,
            eligibleAccountIds: [...ids].filter(account => !noProjectSlot || occupied.has(account)),
            ...(project.frontmatter.required_perspectives?.length && { requiredPerspectives: project.frontmatter.required_perspectives }),
            workKind,
            authorAccountIds: [...new Set(selected.map(n => n.fm.author_account_id).filter(Boolean))],
            requesterAccountIds: [...new Set(selected.map(n => n.fm.requester_account_id).filter(Boolean))],
            assigneeAccountIds: [...new Set(selected.map(n => n.fm.assignee_account_id).filter(Boolean))],
            currentAssignments, workload, personalWipLimit: project.frontmatter.personal_wip_limit });
        const items = [...result.rows.map(row => ({ kind: 'staffing', ...row })), ...result.unfilled.map(row => ({ kind: 'unfilled', ...row })),
            ...result.explanations.map(text => ({ kind: 'explanation', text })), ...(noProjectSlot ? [{ kind: 'explanation', text: guidanceText('guid-8286904df029a470', 'Project WIP is full; finish or explicitly hand off existing work first.') }] : [])];
        if (deterministicAvailable) {
            // Host coverage is generation-specific advice, not a reusable approval.
            for (const target of [...selected, { path: projectPath(id), revision: project.revision }]) {
                if (!target.revision || (await this.visible(target.path)).revision !== target.revision) {
                    throw new Error('Staffing generation changed during host assessment; retry');
                }
            }
            const generation = (tasks) => fingerprint(tasks.map(n => ({ path: n.path, revision: n.revision })).sort((a, b) => a.path.localeCompare(b.path)));
            if (generation((await this.inventory(id)).filter(n => n.fm.mcpvault_type === 'agent_task')) !== generation(projectTasks)) {
                throw new Error('Staffing task membership or generation changed during host assessment; retry');
            }
        }
        return page(items, { projectId: id, projectRevision: project.revision, advisory: true, summary: result.summary,
            ...(result.execution && { execution: result.execution }) }, fingerprint({ account: actor.accountId, project: project.revision, task: params.taskId, inventory, items, execution: result.execution }), params, `staffing:${id}`);
    }
    async reviewContext(params) {
        const actor = await this.actor(params.principal);
        const id = normalizeScopeId(params.taskId, 'taskId'), note = await this.visible(taskPath(id));
        const project = await this.projectNote(note.frontmatter.project_id);
        this.member(project.frontmatter, actor);
        if (note.frontmatter.work_review_contract !== 2)
            throw guidanceError(new Error('Review context requires contract 2'), 'guid-1c7994c2e1691567');
        const fm = { ...note.frontmatter }, state = await this.reviewEngine.state(fm, project.frontmatter, true);
        fm.work_context_fingerprint = state.fingerprint;
        const result = await this.reviewEngine.read({ ...params, taskId: id, accountId: actor.accountId, basis: reviewBasis(fm),
            ...(state.context && { context: state.context }), project: project.frontmatter, criteria: fm.completion_criteria });
        await this.actor(params.principal);
        const latest = await this.visible(taskPath(id)), latestProject = await this.projectNote(fm.project_id);
        if (latest.revision !== note.revision || latestProject.revision !== project.revision || (await this.reviewEngine.state(fm, latestProject.frontmatter, true)).fingerprint !== state.fingerprint)
            throw guidanceError(new Error('Review context changed during delivery; reread current context'), 'guid-ef74e59f5bdaf2f0');
        return result;
    }
    async packet(params) {
        const id = normalizeScopeId(params.taskId, 'taskId');
        const n = await this.visible(taskPath(id));
        if (n.frontmatter.mcpvault_type !== 'agent_task' || n.frontmatter.task_id !== id || !n.frontmatter.project_id)
            throw guidanceError(new Error('Packet requires a project-backed task'), 'guid-77495db18b810d46');
        const project = await this.projectNote(n.frontmatter.project_id);
        const fm = { ...n.frontmatter };
        if (fm.work_review_contract === 2)
            fm.work_context_fingerprint = (await this.reviewEngine.state(fm, project.frontmatter)).fingerprint;
        const artifactFingerprint = reviewBasis(fm);
        const locators = [];
        if (fm.discussion_slug) {
            try {
                const discussion = await this.communityTarget('post', fm.discussion_slug);
                locators.push({ kind: 'discussion', slug: discussion.id, revision: discussion.note.revision,
                    tool: 'community.post_read', arguments: { slug: discussion.id, includeComments: true, commentLimit: 5 } });
            }
            catch { /* Draft, private, hidden, and missing discussions are omitted. */ }
        }
        if (fm.parent_task_id) {
            try {
                const parent = await this.visible(taskPath(fm.parent_task_id));
                if (parent.frontmatter.project_id === fm.project_id)
                    locators.push({ kind: 'parent', taskId: fm.parent_task_id, revision: parent.revision });
            }
            catch { /* Parent visibility is checked independently of task visibility. */ }
        }
        for (const taskId of fm.depends_on || []) {
            try {
                const dependency = await this.visible(taskPath(taskId));
                if (dependency.frontmatter.project_id === fm.project_id)
                    locators.push({ kind: 'dependency', taskId, revision: dependency.revision });
            }
            catch { /* Hidden and missing targets are not part of this projection. */ }
        }
        for (const locator of fm.artifacts || []) {
            try {
                if (locator.path) {
                    const path = this.publicPath(locator.path);
                    const artifact = await this.visible(path);
                    locators.push({ kind: 'artifact', ...locator, path, currentRevision: artifact.revision, stale: locator.revision !== artifact.revision });
                }
                else
                    locators.push({ kind: 'artifact', ...locator });
            }
            catch { /* Do not expose a now-private or moderated artifact locator. */ }
        }
        const paid = (await this.paidTasks([id], params.principal))[id];
        const before = (await this.taskMutations([id]))[id];
        let nextActions = before.freeMutationBlocked || paid?.freeMutationBlocked ? [] : await this.packetActions(id, { ...n, frontmatter: fm }, project.frontmatter, params.principal);
        const taskMutation = (await this.taskMutations([id]))[id];
        if (taskMutation.freeMutationBlocked)
            nextActions = [];
        const items = [
            ...(fm.work_review_contract === 2 ? [{ kind: 'reviewContract', version: 2, nextAction: { endpoint: 'work.review_context', args: { taskId: id } },
                    current: fm.work_review?.fingerprint === artifactFingerprint, verificationLevel: fm.work_review?.verification_level || 'pending' }] : []),
            { kind: 'task', title: String(fm.title || id).slice(0, 180), status: fm.status, assigneeAccountId: fm.assignee_account_id,
                requesterAccountId: fm.requester_account_id, generation: fm.claim_generation, workKind: fm.work_kind },
            { kind: 'taskMutation', ...taskMutation },
            ...(this.blocker(fm) ? [{ kind: 'blocker', text: this.blocker(fm) }] : []),
            ...nextActions,
            ...(paid ? [paid] : []),
            ...await storyWorkResults(this.fileSystem, id, fm.project_id, path => this.visible(this.publicPath(path)), path => this.access.canAccessPhysicalPath(path)),
            ...String(project.frontmatter.goal || '').match(/.{1,400}/gs)?.map(text => ({ kind: 'goal', text })) || [],
            ...(project.frontmatter.allowed_work || []).map((text) => ({ kind: 'allowedWork', text })),
            { kind: 'authority', text: guidanceText('guid-f23e84610cfaea5b', 'Task participation grants no external execution authority.') },
            ...await this.responsibilityItems(fm),
            ...String(fm.description || '').match(/.{1,400}/gs)?.map(text => ({ kind: 'description', text })) || [],
            ...(fm.completion_criteria || []).map((text) => ({ kind: 'criterion', text })),
            ...locators,
            ...(fm.verification ? [{ kind: 'verification', text: fm.verification }] : []),
            ...(fm.work_review ? reviewPacketItems(fm.work_review) : []),
            ...(fm.work_handoff ? Object.entries(fm.work_handoff).filter(([k]) => k !== 'artifacts').map(([key, value]) => ({ kind: 'handoff', key, value })) : []),
            ...(fm.work_changes || []).slice(-5).reverse().map((change) => ({ kind: 'change', ...change })),
        ];
        const signature = fingerprint({ revision: n.revision, project: project.revision, artifactFingerprint, locators, nextActions, items });
        return page(items, { taskId: id, revision: n.revision, artifactFingerprint, generation: fm.claim_generation,
            ...(params.knownRevision && { changed: params.knownRevision !== n.revision }) }, signature, params, `packet:${id}`);
    }
    async paidTasks(ids, principal) {
        const result = Object.create(null);
        if (!ids.length)
            return result;
        try {
            const rows = await this.options.paidProjection?.(ids, principal);
            for (const id of ids)
                if (rows && Object.hasOwn(rows, id) && rows[id] && typeof rows[id] === 'object')
                    result[id] = rows[id];
        }
        catch { /* Optional private detail never determines free eligibility. */ }
        return result;
    }
    async taskMutations(ids) {
        if (!ids.length)
            return {};
        const unavailable = { state: 'unavailable', freeMutationBlocked: true };
        if (!this.options.freeTaskMutations)
            return Object.fromEntries(ids.map(id => [id, { state: 'allowed', freeMutationBlocked: false }]));
        let result = {};
        try {
            result = await this.options.freeTaskMutations(ids);
        }
        catch { /* No raw ledger errors or permissive fallback. */ }
        return Object.fromEntries(ids.map(id => {
            const value = Object.hasOwn(result, id) ? result[id] : undefined;
            const valid = value && ['allowed', 'managed', 'unavailable'].includes(value.state) && value.freeMutationBlocked === (value.state !== 'allowed');
            return [id, valid ? { state: value.state, freeMutationBlocked: value.freeMutationBlocked } : unavailable];
        }));
    }
    async packetActions(id, note, project, principal) {
        if (!principal || finished(note.frontmatter) || project.team_status === 'completed')
            return [];
        let actor;
        try {
            actor = await this.actor(principal);
            this.member(project, actor);
        }
        catch {
            return [];
        }
        const fm = note.frontmatter;
        const action = (tool, op, requiredInput = []) => ({ kind: 'nextAction', tool,
            arguments: { op, taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
                requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision, tool, op }).slice(0, 24)}`,
                ...(tool === 'work.review' && op !== 'request' && { artifactFingerprint: reviewBasis(fm) }) },
            ...(requiredInput.length && { requiredInput }), advisory: true });
        if (fm.work_handoff?.state === 'proposed' && fm.work_handoff.to_account_id === actor.accountId)
            return [action('work.handoff', 'accept')];
        if (fm.status === 'in_review' && fm.work_review?.decision === 'request' && ![fm.requester_account_id, fm.assignee_account_id, fm.author_account_id].includes(actor.accountId)) {
            if (fm.work_review_contract === 2)
                return [{ kind: 'nextAction', tool: 'work.review_context', arguments: { taskId: id },
                        requiredInput: ['Read original context ranges, then supply contextReceipts and structured criterion checks to work.review'], advisory: true }];
            return [action('work.review', 'approve', ['reason']), action('work.review', 'changes_requested', ['reason']), action('work.review', 'question', ['reason'])];
        }
        if (!fm.assignee_account_id) {
            try {
                await this.ready(fm);
            }
            catch {
                return [{ kind: 'nextAction', tool: 'work.board', arguments: { projectId: fm.project_id }, reason: guidanceText('guid-178e721211cda701', 'Dependencies are not ready') }];
            }
            try {
                await this.resourceAdmission({ ...fm, assignee_account_id: actor.accountId }, id);
            }
            catch {
                return [{ kind: 'nextAction', tool: 'work.coverage', arguments: { projectId: fm.project_id }, reason: guidanceText('guid-10b4772d386de91c', 'Declared resource coordination needs attention before claiming.') }];
            }
            return [action('work.claim', 'claim')];
        }
        if (fm.assignee_account_id === actor.accountId) {
            if (fm.work_review?.decision === 'question' && fm.work_review.fingerprint === reviewBasis(fm)) {
                return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'),
                        arguments: { taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
                            requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision }).slice(0, 24)}` },
                        requiredInput: ['verification'], question: String(fm.work_review.reason || '').slice(0, 500),
                        reason: guidanceText('guid-62fd0e175b1358bd', 'Answer or clarify the review question in updated verification before requesting review again. Use the existing discussion locator if discussion is needed.'), advisory: true }];
            }
            if (['accepted', 'proposed'].includes(fm.status))
                return [action('work.claim', 'start')];
            if (fm.verification && fm.completion_criteria?.length) {
                const approval = fm.work_review;
                const approved = approval && (fm.work_kind === 'general' && fm.work_review_contract === 2 ? ['approve', 'override', 'self_verify'] : ['approve', 'override']).includes(approval.decision) && approval.fingerprint === reviewBasis(fm);
                if ((fm.work_kind === 'general' && fm.work_review_contract !== 2) || approved) {
                    return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'),
                            arguments: { taskId: id, status: 'completed', expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
                                requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision, status: 'completed' }).slice(0, 24)}` },
                            requiredInput: ['reason', 'knowledge disposition if not already recorded'],
                            reason: guidanceText('guid-16d4d42d05805788', 'Complete with a reason and auditable knowledge disposition: retrospective, knowledgeNotes, negativeKnowledgeNotes, or noReusableKnowledge with knowledgeDispositionReason. Current dependencies and artifact revisions are rechecked on write.'), advisory: true }];
                }
                if (fm.status !== 'in_review')
                    return [action('work.review', 'request')];
                if (fm.work_review_contract === 2 && fm.work_kind === 'general')
                    return [{ kind: 'nextAction', tool: 'work.review_context', arguments: { taskId: id },
                            reason: guidanceText('guid-e548d27483d6b949', 'Ordinary work may explicitly self_verify after reading context and supplying criterion evidence; this is not independent review.'), advisory: true }];
            }
            return [{ kind: 'nextAction', tool: endpointIdForTool('update_agent_task'), arguments: { taskId: id, expectedRevision: note.revision, expectedGeneration: fm.claim_generation,
                        requestId: `work-${fingerprint({ actor: actor.accountId, id, revision: note.revision }).slice(0, 24)}` }, requiredInput: ['verification or progress fields'], advisory: true }];
        }
        return [];
    }
    async pulse(principal, limit = 20, maxChars = 4000) {
        integer(limit, 20, 100, 'limit');
        integer(maxChars, 4000, 12000, 'maxChars');
        if (maxChars < JSON.stringify({ coverage: 'unavailable' }).length)
            throw guidanceError(new Error('maxChars cannot fit Work pulse coverage'), 'guid-4b39cd422f5a051e');
        if (!principal)
            return { coverage: 'unavailable' };
        let actor;
        try {
            actor = await this.actor(principal);
        }
        catch {
            return { coverage: 'unavailable' };
        }
        const candidates = [];
        const projects = new Map();
        for (const n of await this.inventory()) {
            const fm = n.fm;
            if (!fm.project_id || finished(fm))
                continue;
            let project = projects.get(fm.project_id);
            if (!project) {
                try {
                    project = (await this.projectNote(fm.project_id)).frontmatter;
                    projects.set(fm.project_id, project);
                }
                catch {
                    continue;
                }
            }
            if (!project.participants?.includes(actor.accountId))
                continue;
            if (project.team_status === 'completed')
                continue;
            let rank = 9;
            let reason = '';
            if (fm.work_handoff?.state === 'proposed' && fm.work_handoff.to_account_id === actor.accountId) {
                rank = 0;
                reason = 'Pending handoff for your account';
            }
            else if (fm.status === 'in_review' && fm.work_review?.decision === 'request' && ![fm.requester_account_id, fm.assignee_account_id].includes(actor.accountId)) {
                rank = 1;
                reason = 'Independent review requested';
            }
            else if (fm.assignee_account_id === actor.accountId) {
                rank = 2;
                reason = 'Continue your current work';
            }
            else if (!fm.assignee_account_id && fm.status === 'proposed') {
                try {
                    await this.ready(fm);
                    rank = 3;
                    reason = 'Ready unclaimed project work';
                }
                catch {
                    continue;
                }
            }
            if (rank < 9)
                candidates.push({ rank, taskId: fm.task_id, reason });
        }
        candidates.sort((a, b) => a.rank - b.rank || a.taskId.localeCompare(b.taskId));
        let mutations = await this.taskMutations(candidates.map(c => c.taskId));
        const paid = await this.paidTasks(candidates.filter(c => mutations[c.taskId].state === 'managed').map(c => c.taskId), actor);
        if (Object.keys(paid).length)
            mutations = await this.taskMutations(candidates.map(c => c.taskId));
        const actionable = candidates.filter(c => !mutations[c.taskId].freeMutationBlocked || (mutations[c.taskId].state === 'managed' && Boolean(paid[c.taskId]?.nextAction)));
        const first = actionable[0];
        const result = first ? { nextAction: { tool: 'work.packet', arguments: { taskId: first.taskId } }, reason: mutations[first.taskId].state === 'managed' ? 'Read the separately managed task and authorized contract route' : first.reason,
            summary: { actionable: Math.min(actionable.length, limit), truncated: actionable.length > limit } }
            : candidates.length ? { summary: { actionable: 0, managed: candidates.filter(c => mutations[c.taskId].state === 'managed').length,
                    unavailable: candidates.filter(c => mutations[c.taskId].state === 'unavailable').length } } : {};
        const covered = { ...result, coverage: 'loaded' };
        if (JSON.stringify(covered).length > maxChars)
            return { coverage: 'unavailable' };
        return covered;
    }
}
