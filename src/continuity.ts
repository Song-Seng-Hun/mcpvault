import { createHash } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';

const MAX_TEXT = 4000;
const MAX_LEARNING_ENTRIES = 50;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

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

type PendingEdit = { path: string; expectedRevision: string; endpointId: string; purpose?: string };
type ResearchTrailItem = { kind: 'query' | 'read' | 'finding' | 'decision'; summary: string; path?: string; revision?: string };
type LearningOrder = 'authored' | 'recommended';
type LearningEntry = { path: string; revision: string };
type LearningProgress = {
  root_path: string;
  root_revision: string;
  order: LearningOrder;
  max_depth: number;
  completed_through?: string;
  entries: LearningEntry[];
  structure_fingerprint: string;
  revision_fingerprint: string;
  saved_at: string;
};

type LearningPathBuilder = (
  principal: ScopePrincipal,
  path: string,
  maxDepth: number,
  limit: number,
  maxChars: number,
) => Promise<Record<string, any>>;

export type ContinuityServiceOptions = {
  access?: ScopeAccessPolicy;
  buildLearningPath?: LearningPathBuilder;
};

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pendingEdits(value: unknown): PendingEdit[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('pendingEdits must be an array');
  const result: PendingEdit[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each pendingEdit must be an object');
    const item = raw as Record<string, unknown>;
    const path = String(item.path ?? '').trim().replace(/\\/g, '/');
    const expectedRevision = String(item.expectedRevision ?? '').trim();
    const endpointId = String(item.endpointId ?? '').trim().toLowerCase();
    const purpose = String(item.purpose ?? '').trim().replace(/\s+/g, ' ');
    if (!path || path.length > 500 || path.split('/').includes('..')) throw new Error('pendingEdit.path must be a safe note path or scope URI of 500 characters or fewer');
    if (!expectedRevision || expectedRevision.length > 200) throw new Error('pendingEdit.expectedRevision is required and must be 200 characters or fewer');
    if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(endpointId)) throw new Error('pendingEdit.endpointId must be a valid endpoint id');
    if (purpose.length > 500) throw new Error('pendingEdit.purpose must be 500 characters or fewer');
    const normalized = { path, expectedRevision, endpointId, ...(purpose && { purpose }) };
    if (!result.some(existing => existing.path === path && existing.endpointId === endpointId)) result.push(normalized);
  }
  return result;
}

function researchTrail(value: unknown): ResearchTrailItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('researchTrail must be an array');
  const result: ResearchTrailItem[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each researchTrail item must be an object');
    const item = raw as Record<string, unknown>;
    const kind = String(item.kind ?? '').trim().toLowerCase() as ResearchTrailItem['kind'];
    const summary = String(item.summary ?? '').trim().replace(/\s+/g, ' ');
    const path = String(item.path ?? '').trim().replace(/\\/g, '/');
    const revision = String(item.revision ?? '').trim();
    if (!['query', 'read', 'finding', 'decision'].includes(kind)) throw new Error('researchTrail.kind must be query, read, finding, or decision');
    if (!summary || summary.length > 500) throw new Error('researchTrail.summary is required and must be 500 characters or fewer');
    if (path && (path.length > 500 || path.split('/').includes('..'))) throw new Error('researchTrail.path must be a safe note path or scope URI of 500 characters or fewer');
    if (revision.length > 200) throw new Error('researchTrail.revision must be 200 characters or fewer');
    const normalized = { kind, summary, ...(path && { path }), ...(revision && { revision }) };
    if (!result.some(existing => existing.kind === kind && existing.summary === summary && existing.path === path)) result.push(normalized);
  }
  return result;
}

function render(state: { topic: string; summary: string; nextAction: string; openQuestions?: string[]; references?: string[]; cursors?: Record<string, unknown>; focus?: { questions?: string[]; projects?: string[]; notes?: string[] }; pendingEdits?: PendingEdit[]; researchTrail?: ResearchTrailItem[]; learningProgress?: LearningProgress }): string {
  const learningIndex = state.learningProgress?.completed_through
    ? state.learningProgress.entries.findIndex(item => item.path === state.learningProgress!.completed_through)
    : -1;
  const learningNext = state.learningProgress?.entries[learningIndex + 1];
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
    ...(state.researchTrail?.length ? ['', '## Research trail', '', ...state.researchTrail.map(item => `- ${item.kind} · ${item.summary}${item.path ? ` · ${item.path}` : ''}${item.revision ? ` · revision ${item.revision}` : ''}`)] : []),
    ...(state.learningProgress ? ['', '## Learning progress', '',
      `- Root: ${state.learningProgress.root_path}`,
      `- Order: ${state.learningProgress.order}`,
      `- Progress: ${learningIndex + 1}/${state.learningProgress.entries.length}`,
      ...(learningNext ? [`- Next: ${learningNext.path}`] : ['- State: complete at the saved revisions']),
      '- Resume through continuity.resume so path and note drift are checked before reading on.',
    ] : []),
    ...(state.cursors && Object.keys(state.cursors).length ? ['', '## Cursors', '', '```json', JSON.stringify(state.cursors), '```'] : []),
    '',
  ].join('\n');
}

export class ContinuityService {
  private readonly access: ScopeAccessPolicy;
  private readonly buildLearningPath: LearningPathBuilder | undefined;

  constructor(private readonly fileSystem: FileSystemService, options: ContinuityServiceOptions = {}) {
    this.access = options.access || new ScopeAccessPolicy();
    this.buildLearningPath = options.buildLearningPath;
  }

  private physicalLearningPath(value: unknown, field: string, principal: ScopePrincipal): string {
    const raw = String(value ?? '').trim();
    if (!raw || raw.length > 500) throw new Error(`${field} is required and must be 500 characters or fewer`);
    const path = this.access.resolveExternalPath(raw, principal).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!path || path.split('/').some(part => part === '.' || part === '..') || !this.access.canAccessPhysicalPath(path, principal)) {
      throw new Error(`${field} must be a visible, safe note path`);
    }
    return path;
  }

  private async prepareLearningProgress(principal: ScopePrincipal, value: unknown): Promise<LearningProgress | undefined> {
    if (value === undefined) return undefined;
    const input = record(value);
    if (!input) throw new Error('learningProgress must be an object');
    if (!this.buildLearningPath) throw new Error('Learning-path checkpoints are unavailable on this server');
    const rootPath = this.physicalLearningPath(input.rootPath, 'learningProgress.rootPath', principal);
    const order = String(input.order || 'authored').trim().toLowerCase() as LearningOrder;
    if (!['authored', 'recommended'].includes(order)) throw new Error('learningProgress.order must be authored or recommended');
    const maxDepth = input.maxDepth === undefined ? 2 : Number(input.maxDepth);
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 6) throw new Error('learningProgress.maxDepth must be an integer from 0 to 6');

    const projection = await this.buildLearningPath(principal, rootPath, maxDepth, MAX_LEARNING_ENTRIES, 16_000);
    const root = record(projection.root);
    const rootRevision = String(root?.revision || '').toLowerCase();
    if (!REVISION_PATTERN.test(rootRevision)) throw new Error('The learning path did not return a valid root revision');
    const authored = Array.isArray(projection.authoredOrder) ? projection.authoredOrder : [];
    const authoredEntries: LearningEntry[] = [];
    for (const raw of authored.slice(0, MAX_LEARNING_ENTRIES)) {
      const item = record(raw);
      if (!item) continue;
      const physical = this.physicalLearningPath(item.path, 'learningProgress entry path', principal);
      const revision = String(item.revision || '').toLowerCase();
      if (!REVISION_PATTERN.test(revision)) throw new Error(`Learning-path entry '${item.path}' has no valid revision`);
      const path = this.access.toPublicPath(physical);
      if (!authoredEntries.some(existing => existing.path === path)) authoredEntries.push({ path, revision });
    }
    const omitted = Number(record(projection.summary)?.omittedEntries || 0);
    if (omitted > 0 || authored.length > MAX_LEARNING_ENTRIES) {
      throw new Error(`Learning progress is limited to ${MAX_LEARNING_ENTRIES} entries; split this oversized MOC into nested maps before checkpointing it`);
    }
    if (projection.truncated === true) {
      throw new Error('The learning path scan is truncated or incomplete; simplify the MOC or checkpoint a smaller nested map before saving progress');
    }
    const byPath = new Map(authoredEntries.map(item => [item.path, item]));
    const entries = order === 'authored'
      ? authoredEntries
      : (Array.isArray(projection.recommendedOrder) ? projection.recommendedOrder : []).map(rawPath => {
        const physical = this.physicalLearningPath(rawPath, 'recommended learning path', principal);
        const path = this.access.toPublicPath(physical);
        const item = byPath.get(path);
        if (!item) throw new Error(`Recommended learning entry is missing a revision snapshot: ${path}`);
        return item;
      });
    if (order === 'recommended' && authoredEntries.length > 0 && entries.length !== authoredEntries.length) {
      throw new Error('The recommended path omits cyclic or blocked entries; use authored order or repair the MOC before saving progress');
    }

    let completedThrough: string | undefined;
    if (input.completedThrough !== undefined && String(input.completedThrough).trim()) {
      const physical = this.physicalLearningPath(input.completedThrough, 'learningProgress.completedThrough', principal);
      completedThrough = this.access.toPublicPath(physical);
      if (!entries.some(item => item.path === completedThrough)) throw new Error('learningProgress.completedThrough must be one entry in the selected learning path');
    }
    const publicRoot = this.access.toPublicPath(rootPath);
    const savedAt = new Date().toISOString();
    return {
      root_path: publicRoot,
      root_revision: rootRevision,
      order,
      max_depth: maxDepth,
      ...(completedThrough && { completed_through: completedThrough }),
      entries,
      structure_fingerprint: fingerprint({ root: publicRoot, order, maxDepth, paths: entries.map(item => item.path) }),
      revision_fingerprint: fingerprint({ root: [publicRoot, rootRevision], entries }),
      saved_at: savedAt,
    };
  }

  private compactLearningProgress(progress: LearningProgress, state: 'saved_unchecked' | 'ready' | 'complete' | 'stale', drift?: Record<string, unknown>) {
    const completedIndex = progress.completed_through ? progress.entries.findIndex(item => item.path === progress.completed_through) : -1;
    const next = progress.entries[completedIndex + 1];
    return {
      state,
      root: { path: progress.root_path, revision: progress.root_revision },
      order: progress.order,
      maxDepth: progress.max_depth,
      entriesTracked: progress.entries.length,
      completedCount: completedIndex + 1,
      ...(progress.completed_through && { completedThrough: progress.completed_through }),
      ...(state === 'ready' && next && { next: { ...next, endpointId: 'notes.read', arguments: { path: next.path, maxChars: 6000 } } }),
      ...(drift && { drift }),
      ...(state === 'stale' ? { canResume: false, nextAction: { endpointId: 'wiki.learning_path', arguments: { path: progress.root_path, maxDepth: progress.max_depth, limit: MAX_LEARNING_ENTRIES, maxChars: 7000 } } } : {}),
      ...(state === 'ready' ? { canResume: true } : {}),
      ...(state === 'complete' ? { canResume: true, complete: true } : {}),
      ...(state === 'saved_unchecked' ? { canResume: false, revalidateWith: 'continuity.resume' } : {}),
    };
  }

  private async validateLearningProgress(principal: ScopePrincipal, raw: unknown, validate: boolean) {
    const candidate = record(raw);
    const candidateEntries = Array.isArray(candidate?.entries) ? candidate.entries : [];
    const entries = candidateEntries.slice(0, MAX_LEARNING_ENTRIES).flatMap(rawEntry => {
      const item = record(rawEntry);
      const path = String(item?.path || '').trim();
      const revision = String(item?.revision || '').trim().toLowerCase();
      return path && path.length <= 500 && REVISION_PATTERN.test(revision) ? [{ path, revision }] : [];
    });
    const order = String(candidate?.order || '') as LearningOrder;
    const maxDepth = Number(candidate?.max_depth);
    const stored: LearningProgress | undefined = candidate
      && String(candidate.root_path || '').length <= 500
      && REVISION_PATTERN.test(String(candidate.root_revision || '').toLowerCase())
      && ['authored', 'recommended'].includes(order)
      && Number.isInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 6
      && candidateEntries.length <= MAX_LEARNING_ENTRIES
      && entries.length === candidateEntries.length
      && REVISION_PATTERN.test(String(candidate.structure_fingerprint || '').toLowerCase())
      && REVISION_PATTERN.test(String(candidate.revision_fingerprint || '').toLowerCase())
      ? {
        root_path: String(candidate.root_path), root_revision: String(candidate.root_revision).toLowerCase(), order, max_depth: maxDepth,
        ...(candidate.completed_through && { completed_through: String(candidate.completed_through) }), entries,
        structure_fingerprint: String(candidate.structure_fingerprint).toLowerCase(), revision_fingerprint: String(candidate.revision_fingerprint).toLowerCase(),
        saved_at: String(candidate.saved_at || ''),
      } satisfies LearningProgress
      : undefined;
    if (!stored || (stored.completed_through !== undefined && !stored.entries.some(item => item.path === stored.completed_through))) {
      return { state: 'invalid_checkpoint', canResume: false, reason: 'Stored learning progress is malformed; regenerate it with continuity.save.' };
    }
    if (!validate) return this.compactLearningProgress(stored, 'saved_unchecked');
    try {
      const current = await this.prepareLearningProgress(principal, {
        rootPath: stored.root_path,
        order: stored.order,
        maxDepth: stored.max_depth,
        ...(stored.completed_through && { completedThrough: stored.completed_through }),
      });
      if (!current) throw new Error('Learning path could not be rebuilt');
      const previousByPath = new Map<string, string>(stored.entries.map(item => [item.path, item.revision]));
      const currentByPath = new Map<string, string>(current.entries.map(item => [item.path, item.revision]));
      const changedEntries = [...new Set([...previousByPath.keys(), ...currentByPath.keys()])].flatMap(path => {
        const previous = previousByPath.get(path);
        const next = currentByPath.get(path);
        if (previous === next) return [];
        return [{ path, state: previous === undefined ? 'added' : next === undefined ? 'removed' : 'revised', ...(previous && { previousRevision: previous }), ...(next && { currentRevision: next }) }];
      });
      const structureChanged = current.structure_fingerprint !== stored.structure_fingerprint;
      const revisionsChanged = current.revision_fingerprint !== stored.revision_fingerprint;
      if (structureChanged || revisionsChanged) {
        return this.compactLearningProgress(stored, 'stale', {
          rootChanged: current.root_revision !== stored.root_revision,
          structureChanged,
          revisionsChanged,
          changedEntries: changedEntries.slice(0, 8),
          changedEntriesTotal: changedEntries.length,
        });
      }
      const completedIndex = current.completed_through ? current.entries.findIndex(item => item.path === current.completed_through) : -1;
      return this.compactLearningProgress(current, completedIndex + 1 >= current.entries.length ? 'complete' : 'ready');
    } catch (error) {
      return {
        ...this.compactLearningProgress(stored, 'stale'),
        drift: { validationError: error instanceof Error ? error.message.slice(0, 500) : 'Learning path validation failed' },
      };
    }
  }

  async save(params: { principal?: ScopePrincipal; topic: string; summary: string; nextAction: string; openQuestions?: unknown; references?: unknown; cursors?: unknown; focusQuestions?: unknown; focusProjects?: unknown; focusNotes?: unknown; pendingEdits?: unknown; researchTrail?: unknown; learningProgress?: unknown; expectedRevision?: string }) {
    const principal = requiredPrincipal(params.principal);
    const topic = short(params.topic, 'topic', true)!;
    const summary = short(params.summary, 'summary', true)!;
    const nextAction = short(params.nextAction, 'nextAction', true)!;
    const openQuestions = list(params.openQuestions, 'openQuestions');
    const references = list(params.references, 'references');
    const focusQuestions = list(params.focusQuestions, 'focusQuestions');
    const focusProjects = list(params.focusProjects, 'focusProjects');
    const focusNotes = list(params.focusNotes, 'focusNotes');
    const pending = pendingEdits(params.pendingEdits);
    const trail = researchTrail(params.researchTrail);
    const learningProgress = await this.prepareLearningProgress(principal, params.learningProgress);
    if (params.cursors !== undefined && (!params.cursors || typeof params.cursors !== 'object' || Array.isArray(params.cursors))) throw new Error('cursors must be an object');
    const path = ownerPath(principal);
    const existing = await this.fileSystem.noteExists(path) ? await this.fileSystem.readNote(path) : undefined;
    const expectedRevision = params.expectedRevision || existing?.revision || 'missing';
    const updatedAt = new Date().toISOString();
    await this.fileSystem.writeNote({
      path,
      content: render({ topic, summary, nextAction, ...(openQuestions && { openQuestions }), ...(references && { references }), ...(params.cursors && { cursors: params.cursors as Record<string, unknown> }), focus: { ...(focusQuestions && { questions: focusQuestions }), ...(focusProjects && { projects: focusProjects }), ...(focusNotes && { notes: focusNotes }) }, ...(pending && { pendingEdits: pending }), ...(trail && { researchTrail: trail }), ...(learningProgress && { learningProgress }) }),
      frontmatter: {
        mcpvault_type: 'agent_work_state', owner: principal.agentId || principal.modelId,
        model_id: principal.modelId, ...(principal.agentId && { agent_id: principal.agentId }),
        topic, next_action: nextAction, open_questions: openQuestions || [], references: references || [],
        cursors: params.cursors || {}, focus_questions: focusQuestions || [], focus_projects: focusProjects || [], focus_notes: focusNotes || [], pending_edits: pending || [], research_trail: trail || [], ...(learningProgress && { learning_progress: learningProgress }), updated_at: updatedAt,
      },
      expectedRevision,
    });
    const updated = await this.fileSystem.readNote(path);
    const learningCompletedIndex = learningProgress?.completed_through ? learningProgress.entries.findIndex(item => item.path === learningProgress.completed_through) : -1;
    const learningState = learningProgress && learningCompletedIndex + 1 >= learningProgress.entries.length ? 'complete' : 'ready';
    return { success: true, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md`, updatedAt, revision: updated.revision, ...(learningProgress && { learningProgress: this.compactLearningProgress(learningProgress, learningState) }) };
  }

  async read(params: { principal?: ScopePrincipal; maxChars?: number; validateLearningProgress?: boolean }) {
    const principal = requiredPrincipal(params.principal);
    const path = ownerPath(principal);
    if (!await this.fileSystem.noteExists(path)) return { exists: false, path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md` };
    const note = await this.fileSystem.readNote(path);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
    const { learning_progress: rawLearningProgress, ...frontmatter } = note.frontmatter;
    const learningProgress = rawLearningProgress === undefined
      ? undefined
      : await this.validateLearningProgress(principal, rawLearningProgress, params.validateLearningProgress !== false);
    return {
      exists: true,
      path: `scope://${principal.agentId ? 'agent' : 'model'}/${principal.agentId || principal.modelId}/_continuity/work-state.md`,
      fm: frontmatter,
      content: note.content.slice(0, maxChars),
      truncated: note.content.length > maxChars,
      revision: note.revision,
      ...(learningProgress && { learningProgress }),
    };
  }
}
