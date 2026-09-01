import { normalizeScopeId } from './scopes.js';
const MAX_TEXT = 4000;
function ownerPath(principal) {
    if (principal.agentId)
        return `_scopes/agents/${normalizeScopeId(principal.agentId, 'agentId')}/_continuity/work-state.md`;
    return `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_continuity/work-state.md`;
}
function requiredPrincipal(principal) {
    if (!principal)
        throw new Error('Login is required to save or resume private work state');
    return principal;
}
function short(value, field, required = false) {
    const result = String(value ?? '').trim();
    if (required && !result)
        throw new Error(`${field} is required`);
    if (result.length > MAX_TEXT)
        throw new Error(`${field} must be ${MAX_TEXT} characters or fewer`);
    return result || undefined;
}
function list(value, field) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error(`${field} must be an array of strings`);
    return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 20).map(item => item.slice(0, 500));
}
function render(state) {
    return [
        `# Work state: ${state.topic}`,
        '',
        '## Summary',
        '', state.summary,
        '',
        '## Next action',
        '', state.nextAction,
        ...(state.openQuestions?.length ? ['', '## Open questions', '', ...state.openQuestions.map(item => `- ${item}`)] : []),
        ...(state.references?.length ? ['', '## References', '', ...state.references.map(item => `- ${item}`)] : []),
        ...(state.cursors && Object.keys(state.cursors).length ? ['', '## Cursors', '', '```json', JSON.stringify(state.cursors), '```'] : []),
        '',
    ].join('\n');
}
export class ContinuityService {
    fileSystem;
    constructor(fileSystem) {
        this.fileSystem = fileSystem;
    }
    async save(params) {
        const principal = requiredPrincipal(params.principal);
        const topic = short(params.topic, 'topic', true);
        const summary = short(params.summary, 'summary', true);
        const nextAction = short(params.nextAction, 'nextAction', true);
        const openQuestions = list(params.openQuestions, 'openQuestions');
        const references = list(params.references, 'references');
        if (params.cursors !== undefined && (!params.cursors || typeof params.cursors !== 'object' || Array.isArray(params.cursors)))
            throw new Error('cursors must be an object');
        const path = ownerPath(principal);
        const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
        const expectedRevision = params.expectedRevision || existing?.revision || 'missing';
        const updatedAt = new Date().toISOString();
        await this.fileSystem.writeNote({
            path,
            content: render({ topic, summary, nextAction, ...(openQuestions && { openQuestions }), ...(references && { references }), ...(params.cursors && { cursors: params.cursors }) }),
            frontmatter: {
                mcpvault_type: 'agent_work_state', owner: principal.agentId || principal.modelId,
                model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }),
                topic, next_action: nextAction, open_questions: openQuestions || [], references: references || [],
                cursors: params.cursors || {}, updated_at: updatedAt,
            },
            expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return { success: true, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md`, updatedAt, revision: updated.revision };
    }
    async read(params) {
        const principal = requiredPrincipal(params.principal);
        const path = ownerPath(principal);
        if (!await this.fileSystem.noteExists(path))
            return { exists: false, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md` };
        const note = await this.fileSystem.readNote(path);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
        return {
            exists: true,
            path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md`,
            fm: note.frontmatter,
            content: note.content.slice(0, maxChars),
            truncated: note.content.length > maxChars,
            revision: note.revision,
        };
    }
}
