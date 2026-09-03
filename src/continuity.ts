import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';

const MAX_TEXT = 4000;

function ownerPath(principal: ScopePrincipal): string {
  if (principal.agentId) return `_scopes/agents/${normalizeScopeId(principal.agentId, 'agentId')}/_continuity/work-state.md`;
  return `_scopes/models/${normalizeScopeId(principal.modelId, 'modelId')}/_continuity/work-state.md`;
}

function requiredPrincipal(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw new Error('Login is required to save or resume private work state');
  return principal;
}

function short(value: unknown, field: string, required = false): string | undefined {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`${field} is required`);
  if (result.length > MAX_TEXT) throw new Error(`${field} must be ${MAX_TEXT} characters or fewer`);
  return result || undefined;
}

function list(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))).slice(0, 20).map(item => item.slice(0, 500));
}

function render(state: { topic: string; summary: string; nextAction: string; openQuestions?: string[]; references?: string[]; cursors?: Record<string, unknown>; focus?: { questions?: string[]; projects?: string[]; notes?: string[] } }): string {
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
    ...(state.cursors && Object.keys(state.cursors).length ? ['', '## Cursors', '', '```json', JSON.stringify(state.cursors), '```'] : []),
    '',
  ].join('\n');
}

export class ContinuityService {
  constructor(private readonly fileSystem: FileSystemService) {}

  async save(params: { principal?: ScopePrincipal; topic: string; summary: string; nextAction: string; openQuestions?: unknown; references?: unknown; cursors?: unknown; focusQuestions?: unknown; focusProjects?: unknown; focusNotes?: unknown; expectedRevision?: string }) {
    const principal = requiredPrincipal(params.principal);
    const topic = short(params.topic, 'topic', true)!;
    const summary = short(params.summary, 'summary', true)!;
    const nextAction = short(params.nextAction, 'nextAction', true)!;
    const openQuestions = list(params.openQuestions, 'openQuestions');
    const references = list(params.references, 'references');
    const focusQuestions = list(params.focusQuestions, 'focusQuestions');
    const focusProjects = list(params.focusProjects, 'focusProjects');
    const focusNotes = list(params.focusNotes, 'focusNotes');
    if (params.cursors !== undefined && (!params.cursors || typeof params.cursors !== 'object' || Array.isArray(params.cursors))) throw new Error('cursors must be an object');
    const path = ownerPath(principal);
    const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
    const expectedRevision = params.expectedRevision || existing?.revision || 'missing';
    const updatedAt = new Date().toISOString();
    await this.fileSystem.writeNote({
      path,
      content: render({ topic, summary, nextAction, ...(openQuestions && { openQuestions }), ...(references && { references }), ...(params.cursors && { cursors: params.cursors as Record<string, unknown> }), focus: { ...(focusQuestions && { questions: focusQuestions }), ...(focusProjects && { projects: focusProjects }), ...(focusNotes && { notes: focusNotes }) } }),
      frontmatter: {
        mcpvault_type: 'agent_work_state', owner: principal.agentId || principal.modelId,
        model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }),
        topic, next_action: nextAction, open_questions: openQuestions || [], references: references || [],
        cursors: params.cursors || {}, focus_questions: focusQuestions || [], focus_projects: focusProjects || [], focus_notes: focusNotes || [], updated_at: updatedAt,
      },
      expectedRevision,
    });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md`, updatedAt, revision: updated.revision };
  }

  async read(params: { principal?: ScopePrincipal; maxChars?: number }) {
    const principal = requiredPrincipal(params.principal);
    const path = ownerPath(principal);
    if (!await this.fileSystem.noteExists(path)) return { exists: false, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md` };
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
