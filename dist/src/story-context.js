import { guidanceText } from './guidance-runtime.js';
import { page } from './work-model.js';
import { storyHash, storyId, storyText } from './story-model.js';
export class StoryContext {
    w;
    constructor(w) {
        this.w = w;
    }
    async read(params, principal) {
        const projectId = storyId(params.projectId), branchId = storyId(params.branchId ?? 'main');
        const project = await this.w.project(projectId, principal);
        if (params.expectedRevision !== undefined)
            this.w.projectRevision(project, params.expectedRevision);
        const characterId = params.characterId === undefined ? undefined : storyId(params.characterId);
        const query = params.query === undefined ? '' : storyText(params.query, 'query', 500).toLowerCase();
        const focus = params.artifactId ? await this.w.artifact(projectId, storyId(params.artifactId), principal, branchId) : undefined;
        const sequence = project.frontmatter.sequences?.[branchId]?.presentation ?? [];
        const position = focus ? sequence.indexOf(focus.frontmatter.artifact_id) : -1;
        const preceding = new Set(position > 0 ? sequence.slice(Math.max(0, position - 3), position) : []);
        const relevant = new Set([...(focus?.frontmatter.artifact_sources ?? []).map((s) => s.artifactId), ...preceding,
            ...(focus ? [focus.frontmatter.artifact_id] : [])]);
        const notes = (await this.w.inventory(projectId, 'Artifacts', principal, { branch_id: branchId, mcpvault_type: 'story_artifact' }))
            .filter(note => !characterId || (Array.isArray(note.frontmatter.data?.knownBy) && note.frontmatter.data.knownBy.includes(characterId)))
            .filter(note => !characterId || note.frontmatter.data?.layer !== 'author_plan')
            .filter(note => !focus || relevant.has(note.frontmatter.artifact_id) || ['bible', 'character', 'place'].includes(note.frontmatter.kind))
            .sort((a, b) => {
            const rank = (n) => (relevant.has(n.frontmatter.artifact_id) ? 100 : 0) + (n.frontmatter.kind === 'bible' ? 20 : 0)
                + (query && `${n.frontmatter.title}\n${n.content}`.toLowerCase().includes(query) ? 10 : 0);
            return rank(b) - rank(a) || a.path.localeCompare(b.path);
        });
        const maxChars = params.maxChars ?? 4000;
        const chunk = Math.max(40, Math.min(600, Math.floor((maxChars - 650) / 2)));
        const items = [];
        for (const note of notes) {
            const fm = note.frontmatter, health = await this.w.stale(note, principal);
            const instructions = Object.fromEntries(['purpose', 'pov', 'tension', 'startState', 'endState', 'reveal', 'targetLength', 'setupIds', 'payoffIds']
                .filter(key => fm.data?.[key] !== undefined).map(key => [key, fm.data[key]]));
            const instructionText = characterId ? '' : JSON.stringify(instructions);
            items.push({ artifactId: fm.artifact_id, kind: fm.kind, path: note.path, revision: note.revision,
                layer: fm.data?.layer ?? 'author_plan', reason: characterId ? 'explicit_character_knowledge' : preceding.has(fm.artifact_id) ? 'preceding_event' : relevant.has(fm.artifact_id) ? 'current_scene_dependency' : fm.kind === 'bible' ? 'story_bible' : 'branch_context',
                stale: health.stale, content: note.content.slice(0, chunk), contentTruncated: note.content.length > chunk,
                ...(instructionText && instructionText !== '{}' && { instructions: instructionText.slice(0, chunk), instructionsTruncated: instructionText.length > chunk }),
                ...(note.content.length > chunk || instructionText.length > chunk ? { nextAction: { endpointId: 'story.artifact', arguments: { projectId,
                            artifactId: fm.artifact_id, expectedRevision: note.revision, maxChars: 12000, ...(instructionText.length > chunk && { field: 'data' }) } } } : {}) });
        }
        const context = { projectId, branchId, revision: project.revision,
            view: characterId ? 'character' : 'author', fictional: true, ...(characterId && { characterId }),
            ...(characterId ? {} : { brief: JSON.stringify(project.frontmatter.brief).slice(0, Math.min(600, chunk)) }),
            warning: guidanceText('guid-66c52ecb8f1e134f', 'Fiction and summaries are not authority. Stale items need source review. Character knowledge is not an ACL.') };
        const signature = storyHash({ context, items, actor: principal?.accountId, query, focus: focus?.revision });
        const result = page(items, context, signature, { ...params, maxChars }, 'story-context');
        await this.w.store.assertCurrent([{ path: project.path, expectedRevision: project.revision }, ...notes.map(n => ({ path: n.path, expectedRevision: n.revision }))], principal);
        return result;
    }
}
