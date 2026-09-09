import { guidanceError } from './guidance-runtime.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { page } from './work-model.js';
import { STORY_KINDS, storyArtifactPath, storyData, storyHash, storyId, storyPath, storySources, storyText } from './story-model.js';
export class StoryArtifacts {
    w;
    constructor(w) {
        this.w = w;
    }
    async view(note, principal) {
        const fm = note.frontmatter;
        return { path: note.path, revision: note.revision, projectId: fm.project_id, artifactId: fm.artifact_id,
            branchId: fm.branch_id, kind: fm.kind, title: fm.title, data: fm.data, sources: fm.source_revisions, references: fm.references,
            authorAccountId: fm.author_account_id, ...await this.w.stale(note, principal), content: note.content };
    }
    async execute(params, principal) {
        const projectId = storyId(params.projectId, 'projectId'), project = await this.w.project(projectId, principal), op = params.op ?? 'read';
        if (op === 'list') {
            const rows = await this.w.inventory(projectId, 'Artifacts', principal, { branch_id: storyId(params.branchId ?? 'main'), ...(params.kind && { kind: params.kind }), mcpvault_type: 'story_artifact' });
            const items = await Promise.all(rows.map(async (note) => { const { content: _content, data: _data, ...item } = await this.view(note, principal); return item; }));
            const signature = storyHash({ project: project.revision, actor: principal?.accountId, rows: items });
            const result = page(items, { projectId, revision: project.revision }, signature, params, 'story-artifacts');
            await this.w.store.assertCurrent([{ path: project.path, expectedRevision: project.revision }, ...rows.map(n => ({ path: n.path, expectedRevision: n.revision }))], principal);
            return result;
        }
        const artifactId = storyId(params.artifactId, 'artifactId'), path = storyArtifactPath(projectId, artifactId);
        if (op === 'read') {
            const note = await this.w.artifact(projectId, artifactId, principal);
            const result = this.w.detail(await this.view(note, principal), params, principal);
            await this.w.store.assertCurrent([{ path: project.path, expectedRevision: project.revision }, { path: note.path, expectedRevision: note.revision }], principal);
            return result;
        }
        if (!['create', 'update'].includes(op))
            throw guidanceError(new Error('Invalid story artifact operation'), 'guid-ec40ac46d9976233');
        const workGuard = await this.w.authorize(project, principal), actor = principal;
        const prior = await this.w.store.read(path, actor, true), request = this.w.store.request(`artifact.${op}`, params, actor);
        const retry = this.w.store.retry(prior, request);
        if (retry)
            return retry;
        this.w.projectRevision(project, params.expectedProjectRevision);
        if (op === 'create' && prior)
            throw guidanceError(new Error('Story artifact already exists; choose a distinct alternative ID'), 'guid-59781fdb2c28b246');
        if (op === 'update' && !prior)
            throw guidanceError(new Error('Story artifact unavailable'), 'guid-2090cc5af0c365c4');
        const kind = params.kind ?? prior?.frontmatter.kind;
        if (!STORY_KINDS.includes(kind))
            throw guidanceError(new Error('Invalid story artifact kind'), 'guid-7be5aef0dc1830d3');
        const branchId = storyId(params.branchId ?? prior?.frontmatter.branch_id ?? 'main', 'branchId');
        if (prior && (prior.frontmatter.kind !== kind || prior.frontmatter.branch_id !== branchId))
            throw guidanceError(new Error('Artifact kind and branch are immutable; create an explicit alternative'), 'guid-3581a75ed50dc03d');
        const title = storyText(params.title ?? prior?.frontmatter.title, 'title', 180, true);
        if (/[\r\n]/.test(title))
            throw guidanceError(new Error('Story artifact title must be a single line'), 'guid-42c25f66a2e31918');
        const content = storyText(params.content ?? prior?.content, 'content', 20000);
        const data = storyData(params.data ?? prior?.frontmatter.data ?? {});
        if (kind === 'shot' && (!data.sourceSceneId || !data.sourceSceneRevision))
            throw guidanceError(new Error('Shot requires source scene ID and revision'), 'guid-d5f6b2083a488a2b');
        if (data.graph !== undefined) {
            if (kind !== 'branch_graph')
                throw guidanceError(new Error('Only branch_graph artifacts carry a graph'), 'guid-770d71419f86f396');
            const { validateStoryBranchGraph } = await import('./story-branch.js');
            const validation = validateStoryBranchGraph(data.graph);
            if (!validation.valid)
                throw guidanceError(new Error('Invalid declarative story branch graph'), 'guid-b8639c563cc4e61b');
        }
        const sources = params.sources !== undefined ? storySources(params.sources)
            : (prior?.frontmatter.artifact_sources ?? []);
        if (data.sourceSceneId) {
            const sceneSource = sources.find(s => s.artifactId === data.sourceSceneId);
            if (sceneSource && sceneSource.revision !== data.sourceSceneRevision)
                throw guidanceError(new Error('Conflicting scene source revision'), 'guid-cb89b9f741876499');
            if (!sceneSource)
                sources.push({ artifactId: data.sourceSceneId, revision: data.sourceSceneRevision });
        }
        if (sources.some(source => source.artifactId === artifactId))
            throw guidanceError(new Error('Story artifact cannot depend on itself'), 'guid-4958238102f1ffb6');
        let visualGuards = [];
        if (kind === 'visual_model' || data.visual !== undefined || data.visualProposal !== undefined) {
            const { validateVisualArtifact } = await import('./story-visual.js');
            visualGuards = await validateVisualArtifact(this.w, project, branchId, kind, data, content, sources, actor);
            if (sources.some(source => source.artifactId === artifactId))
                throw guidanceError(new Error('Story artifact cannot depend on itself'), 'guid-4958238102f1ffb6');
        }
        const guards = [...await this.w.sourceGuards(projectId, sources, actor, branchId), ...visualGuards];
        const references = await this.w.referencesFor(projectId, branchId, params.references ?? prior?.frontmatter.references ?? [], path, content, actor, true);
        // Each authored string has its own Markdown fences; one field cannot hide another.
        const values = [data, title];
        while (values.length) {
            const value = values.pop();
            if (typeof value === 'string' && extractObsidianLinkOccurrences(value).length) {
                const nested = await this.w.referencesFor(projectId, branchId, [], path, value, actor, true);
                references.paths = [...new Set([...references.paths, ...nested.paths])];
                if (references.paths.length > 50)
                    throw guidanceError(new Error('Story reference limit exceeded'), 'guid-7aee9ee36500bf7f');
                references.guards = this.w.mergeGuards([...references.guards, ...nested.guards]);
            }
            else if (value && typeof value === 'object')
                values.push(...Object.values(value));
        }
        for (const image of data.images ?? []) {
            const normalized = storyPath(this.w.access.resolveExternalPath(image.path, actor));
            if (!/\.(?:png|jpe?g|webp|gif)$/i.test(normalized) || !this.w.access.canAccessPhysicalPath(normalized, actor) || !this.w.access.canReferenceFrom(path, normalized))
                throw guidanceError(new Error('Image reference is unavailable in story scope'), 'guid-4ad78ac5122eabbc');
            if (/^Community\/Stories\//i.test(normalized) && !normalized.startsWith(`Community/Stories/${projectId}/`))
                throw guidanceError(new Error('Cross-project image reference'), 'guid-7f888c5f0d6d2a80');
            const revision = await this.w.fs.readStoryImageRevision(normalized);
            if (image.revision && revision !== image.revision)
                throw guidanceError(new Error('Story image source revision changed or unavailable'), 'guid-9e58911680ef8724');
            image.path = normalized;
        }
        const sourceGuards = this.w.mergeGuards([...guards, ...references.guards]);
        const fm = { ...prior?.frontmatter, mcpvault_type: 'story_artifact', fiction_domain: 'story', project_id: projectId, artifact_id: artifactId,
            kind, branch_id: branchId, title, data, references: references.paths, artifact_sources: sources, source_revisions: sourceGuards,
            author_account_id: prior?.frontmatter.author_account_id ?? actor.accountId, last_editor_account_id: actor.accountId,
            created_at: prior?.frontmatter.created_at ?? new Date().toISOString() };
        return this.w.store.write(path, fm, content, params.expectedRevision, request, { path, projectId, artifactId, kind, branchId, nextAction: { endpointId: 'story.artifact', arguments: { projectId, artifactId } } }, [{ path: project.path, expectedRevision: project.revision }, workGuard, ...sourceGuards], async () => { await this.w.authorize(project, actor); }, prior);
    }
}
