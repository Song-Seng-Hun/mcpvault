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
function pendingEdits(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('pendingEdits must be an array');
    const result = [];
    for (const raw of value.slice(0, 20)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Each pendingEdit must be an object');
        const item = raw;
        const path = String(item.path ?? '').trim().replace(/\\/g, '/');
        const expectedRevision = String(item.expectedRevision ?? '').trim();
        const endpointId = String(item.endpointId ?? '').trim().toLowerCase();
        const purpose = String(item.purpose ?? '').trim().replace(/\s+/g, ' ');
        if (!path || path.length > 500 || path.split('/').includes('..'))
            throw new Error('pendingEdit.path must be a safe note path or scope URI of 500 characters or fewer');
        if (!expectedRevision || expectedRevision.length > 200)
            throw new Error('pendingEdit.expectedRevision is required and must be 200 characters or fewer');
        if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(endpointId))
            throw new Error('pendingEdit.endpointId must be a valid endpoint id');
        if (purpose.length > 500)
            throw new Error('pendingEdit.purpose must be 500 characters or fewer');
        const normalized = { path, expectedRevision, endpointId, ...(purpose && { purpose }) };
        if (!result.some(existing => existing.path === path && existing.endpointId === endpointId))
            result.push(normalized);
    }
    return result;
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
        ...(state.focus?.questions?.length ? ['', '## Top-of-mind questions', '', ...state.focus.questions.map(item => `- ${item}`)] : []),
        ...(state.focus?.projects?.length ? ['', '## Top-of-mind projects', '', ...state.focus.projects.map(item => `- ${item}`)] : []),
        ...(state.focus?.notes?.length ? ['', '## Top-of-mind notes', '', ...state.focus.notes.map(item => `- ${item}`)] : []),
        ...(state.pendingEdits?.length ? ['', '## Pending revision-checked edits', '', ...state.pendingEdits.map(item => `- ${item.endpointId} · ${item.path} · revision ${item.expectedRevision}${item.purpose ? ` · ${item.purpose}` : ''}`)] : []),
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
        const focusQuestions = list(params.focusQuestions, 'focusQuestions');
        const focusProjects = list(params.focusProjects, 'focusProjects');
        const focusNotes = list(params.focusNotes, 'focusNotes');
        const pending = pendingEdits(params.pendingEdits);
        if (params.cursors !== undefined && (!params.cursors || typeof params.cursors !== 'object' || Array.isArray(params.cursors)))
            throw new Error('cursors must be an object');
        const path = ownerPath(principal);
        const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
        const expectedRevision = params.expectedRevision || existing?.revision || 'missing';
        const updatedAt = new Date().toISOString();
        await this.fileSystem.writeNote({
            path,
            content: render({ topic, summary, nextAction, ...(openQuestions && { openQuestions }), ...(references && { references }), ...(params.cursors && { cursors: params.cursors }), focus: { ...(focusQuestions && { questions: focusQuestions }), ...(focusProjects && { projects: focusProjects }), ...(focusNotes && { notes: focusNotes }) }, ...(pending && { pendingEdits: pending }) }),
            frontmatter: {
                mcpvault_type: 'agent_work_state', owner: principal.agentId || principal.modelId,
                model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }),
                topic, next_action: nextAction, open_questions: openQuestions || [], references: references || [],
                cursors: params.cursors || {}, focus_questions: focusQuestions || [], focus_projects: focusProjects || [], focus_notes: focusNotes || [], pending_edits: pending || [], updated_at: updatedAt,
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
