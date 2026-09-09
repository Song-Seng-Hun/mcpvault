import { guidanceError } from './guidance-runtime.js';
import { STORY_METHODS, storyAccount, storyBrief, storyId, storyIds, storyList, storyProjectPath, storyText } from './story-model.js';
export function projectView(note) {
    const fm = note.frontmatter;
    return { projectId: fm.project_id, path: note.path, revision: note.revision, title: fm.title, enabled: fm.enabled,
        ownerAccountId: fm.owner_account_id, showrunnerAccountId: fm.showrunner_account_id, participants: fm.participants,
        brief: fm.brief, workProjectId: fm.work_project_id, sequences: fm.sequences, adopted: fm.adopted,
        maxSteps: fm.max_steps, methods: STORY_METHODS, content: note.content,
        authority: 'Creative decisions inside this project only; no model execution, spending, publication or private-scope grant.' };
}
/** Native Bases are live navigation over Properties, not materialized truth. */
function workspaceEntry(projectId, title, theme, branchId = 'main', presentation = []) {
    const quoted = (value) => JSON.stringify(value);
    const base = [
        '```base', 'filters:', '  and:', `    - ${quoted(`project_id == "${projectId}"`)}`,
        `    - ${quoted('fiction_domain == "story"')}`, 'views:',
        '  - type: table', '    name: Scenes', '    filters:', '      and:',
        `        - ${quoted('mcpvault_type == "story_artifact"')}`, `        - ${quoted('kind == "scene"')}`,
        '    order: [file.name, note.branch_id, note.title]',
        '  - type: table', '    name: Editorial queue', '    filters:', '      and:',
        `        - ${quoted('mcpvault_type == "story_session"')}`, `        - ${quoted('stage == "review" || stage == "decision" || stage == "waiting"')}`,
        '    order: [file.name, note.artifact_id, note.stage, note.editor_account_id, note.waiting_for]',
        '  - type: table', '    name: Reviews', `    filters: ${quoted('mcpvault_type == "story_review"')}`,
        '    order: [file.name, note.artifact_id, note.editorial_pass, note.reviewer_account_id]', '```',
    ].join('\n');
    const links = presentation.map(id => `- [[Community/Stories/${projectId}/Artifacts/${id}|${id}]]`).join('\n') || 'Use story.sequence to order scene links.';
    return `# ${title}\n\n${theme}\n\n## Manuscript (${branchId})\n\n${links}\n\n## Scenes and editorial queue\n\n${base}\n\nThese views navigate current Properties. Check story.review and story.export health for exact source freshness; table sorting does not change manuscript order.\n`;
}
export class StoryProjects {
    w;
    constructor(w) {
        this.w = w;
    }
    async execute(params, principal) {
        const id = storyId(params.projectId, 'projectId'), path = storyProjectPath(id), op = params.op ?? 'read';
        if (op === 'read')
            return this.w.detail(projectView(await this.w.project(id, principal)), params, principal);
        if (!['create', 'update'].includes(op))
            throw guidanceError(new Error('Invalid story project operation'), 'guid-2d0d4883c9673f88');
        const actor = await this.w.actor(principal);
        const prior = await this.w.store.read(path, actor, true);
        const request = this.w.store.request(`project.${op}`, params, actor);
        if (prior) {
            await this.w.authorize(prior, actor, 'owner', true);
            const retry = this.w.store.retry(prior, request);
            if (retry)
                return retry;
            if (op === 'create')
                throw guidanceError(new Error('Story project already exists'), 'guid-efd4fa27077badf6');
            this.w.projectRevision(prior, params.expectedRevision);
        }
        else if (op !== 'create' || params.expectedRevision !== 'missing')
            throw guidanceError(new Error('New story project requires expectedRevision=missing'), 'guid-aa3767d2d4e9c9af');
        const brief = params.brief !== undefined ? storyBrief(params.brief) : prior?.frontmatter.brief;
        if (!brief)
            throw guidanceError(new Error('Story brief required'), 'guid-450369594eecb108');
        const title = storyText(params.title ?? prior?.frontmatter.title, 'title', 180, true);
        if (/[\r\n]/.test(title))
            throw guidanceError(new Error('Story title must be a single line'), 'guid-554f0e49be29a671');
        const referenceGuards = [];
        for (const value of [title, ...Object.values(brief).flat()]) {
            if (typeof value === 'string')
                referenceGuards.push(...(await this.w.referencesFor(id, 'main', [], path, value, actor, true)).guards);
            if (this.w.mergeGuards(referenceGuards).length > 50)
                throw guidanceError(new Error('Story project reference limit exceeds 50 sources'), 'guid-ea9f4f4c9899c959');
        }
        const participants = [...new Set([actor.accountId, ...storyList(params.participants ?? prior?.frontmatter.participants ?? [], 'participants', 50).map(storyAccount)])];
        const accounts = new Set((await this.w.auth.listPrincipals()).map(p => p.accountId));
        if (participants.some(id => !accounts.has(id)))
            throw guidanceError(new Error('Every story participant must be a registered account'), 'guid-eac4ab54fda807e6');
        const showrunner = storyAccount(params.showrunnerAccountId ?? prior?.frontmatter.showrunner_account_id ?? actor.accountId);
        if (!participants.includes(showrunner))
            throw guidanceError(new Error('Showrunner must be a registered participant'), 'guid-24ab6a920c687ba2');
        if (params.enabled !== undefined && typeof params.enabled !== 'boolean')
            throw guidanceError(new Error('enabled must be boolean'), 'guid-e76b2d39e41b8863');
        const maxSteps = params.maxSteps ?? prior?.frontmatter.max_steps ?? 32;
        if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 128)
            throw guidanceError(new Error('maxSteps requires 1..128'), 'guid-a44053c1d16e3e8a');
        const workPath = `Community/Projects/${id}.md`;
        const existingWork = await this.w.store.read(workPath, actor, true);
        if (!existingWork) {
            await this.w.work.project({ op: 'create', projectId: id, title, goal: 'Create, review and adopt a fictional work inside its creative brief.',
                allowedWork: ['general'], completionCriteria: ['Revision-pinned manuscript reviewed and adopted'], participants,
                expectedRevision: 'missing', requestId: `story-${request.id}`, principal: actor });
        }
        const workGuard = await this.w.work.authorizeWorkshopProject(actor, id, true, showrunner, actor.accountId);
        const workNote = (await this.w.store.read(workPath, actor));
        if (participants.some(id => !workNote.frontmatter.participants.includes(id)))
            throw guidanceError(new Error('Add registered participants through work.project before including them in the creative workspace'), 'guid-cc254b7092ff5f2b');
        const fm = { ...prior?.frontmatter, mcpvault_type: 'story_project', fiction_domain: 'story', project_id: id, work_project_id: id,
            owner_account_id: actor.accountId, showrunner_account_id: showrunner, participants, title, brief, max_steps: maxSteps,
            enabled: params.enabled ?? prior?.frontmatter.enabled ?? true, sequences: prior?.frontmatter.sequences ?? {}, adopted: prior?.frontmatter.adopted ?? {},
            created_at: prior?.frontmatter.created_at ?? new Date().toISOString() };
        const content = prior?.content ?? workspaceEntry(id, title, brief.theme ?? 'Creative workspace');
        const result = { projectId: id, path, enabled: fm.enabled, showrunnerAccountId: showrunner, workProjectId: id,
            nextAction: { endpointId: 'story.project', arguments: { projectId: id } } };
        const saved = await this.w.store.write(path, fm, content, params.expectedRevision, request, result, [workGuard, ...referenceGuards], async () => {
            await this.w.actor(actor);
            await this.w.work.authorizeWorkshopProject(actor, id, true, showrunner, actor.accountId);
        }, prior);
        this.w.options.changed?.(path);
        return saved;
    }
    async sequence(params, principal) {
        const project = await this.w.project(storyId(params.projectId), principal), branchId = storyId(params.branchId ?? 'main', 'branchId');
        const sequence = project.frontmatter.sequences?.[branchId] ?? { presentation: [], chronology: [], shots: [] };
        if (!params.op || params.op === 'read')
            return this.w.detail({ path: project.path, projectId: params.projectId, revision: project.revision, branchId, ...sequence }, params, principal);
        if (params.op !== 'update')
            throw guidanceError(new Error('Invalid story sequence operation'), 'guid-11a38fc1b40c95cc');
        const guard = await this.w.authorize(project, principal, 'showrunner'), actor = principal;
        const request = this.w.store.request('sequence.update', params, actor);
        const retry = this.w.store.retry(project, request);
        if (retry)
            return retry;
        this.w.projectRevision(project, params.expectedRevision);
        const presentation = storyIds(params.presentation ?? sequence.presentation, 'presentation');
        const chronology = storyIds(params.chronology ?? sequence.chronology, 'chronology');
        const shots = storyIds(params.shots ?? sequence.shots ?? [], 'shots');
        if (presentation.length !== chronology.length || presentation.some(id => !chronology.includes(id)))
            throw guidanceError(new Error('Chronology must contain the same scene IDs as presentation'), 'guid-3a7948fe34b84609');
        const sceneGuards = [];
        for (const id of [...presentation, ...shots]) {
            const note = await this.w.artifact(params.projectId, id, actor, branchId);
            if (note.frontmatter.kind !== (shots.includes(id) ? 'shot' : 'scene'))
                throw guidanceError(new Error('Sequence requires scenes and shot list requires shots'), 'guid-e717f6a5d68ada1f');
            sceneGuards.push({ path: note.path, expectedRevision: note.revision });
        }
        if (Object.keys(project.frontmatter.sequences).length >= 16 && !project.frontmatter.sequences[branchId])
            throw guidanceError(new Error('At most 16 story branches'), 'guid-4cba29bf6b1d3e7e');
        const fm = { ...project.frontmatter, sequences: { ...project.frontmatter.sequences, [branchId]: { presentation, chronology, shots } } };
        const content = workspaceEntry(params.projectId, fm.title, fm.brief.theme ?? 'Creative workspace', branchId, presentation);
        return this.w.store.write(project.path, fm, content, params.expectedRevision, request, { projectId: params.projectId, path: project.path, branchId, presentation, chronology, shots }, [guard, ...sceneGuards], async () => { await this.w.authorize(project, actor, 'showrunner'); }, project);
    }
}
