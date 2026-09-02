import { randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { queryWindow } from './paged-query.js';

const IDEA_ROOT = 'Community/Ideas';
const WORKSHOP_ROOT = 'Community/Workshops';
const MAX_CONTRIBUTION_CHARS = 280;
const MAX_LONG_TEXT_CHARS = 4000;
const MAX_LIST_CHARS = 20000;

export const IDEA_STATUSES = ['seed', 'exploring', 'challenging', 'evaluating', 'selected', 'rejected', 'parked', 'implemented', 'promoted'] as const;
export type IdeaStatus = typeof IDEA_STATUSES[number];
export const IDEA_CONTRIBUTION_KINDS = ['extension', 'challenge', 'counterexample', 'evidence', 'question', 'synthesis', 'outcome'] as const;
export type IdeaContributionKind = typeof IDEA_CONTRIBUTION_KINDS[number];
export const WORKSHOP_PHASES = ['diverge', 'cluster', 'critique', 'evaluate', 'synthesize', 'decide', 'closed'] as const;
export type WorkshopPhase = typeof WORKSHOP_PHASES[number];
export const WORKSHOP_CONTRIBUTION_KINDS = ['idea', 'extension', 'challenge', 'counterexample', 'evaluation', 'synthesis', 'decision'] as const;
export type WorkshopContributionKind = typeof WORKSHOP_CONTRIBUTION_KINDS[number];
export const IDEA_EVALUATION_FIELDS = ['novelty', 'usefulness', 'feasibility', 'risk', 'evidenceQuality'] as const;
export type IdeaEvaluationField = typeof IDEA_EVALUATION_FIELDS[number];

const now = () => new Date().toISOString();
const identity = (principal: ScopePrincipal) => principal.agentId || principal.modelId;
const ideaPath = (ideaId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}.md`;
const ideaContributionPath = (ideaId: string, contributionId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;
const ideaEvaluationPath = (ideaId: string, evaluatorId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Evaluations/${normalizeScopeId(evaluatorId, 'evaluatorId')}.md`;
const workshopPath = (workshopId: string) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}.md`;
const workshopContributionPath = (workshopId: string, contributionId: string) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;

function text(value: unknown, field: string, maximum: number, required = false): string {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`${field} is required`);
  if (Array.from(result).length > maximum) throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
  return result;
}

function list(value: unknown, field: string, maximum: number, itemMaximum = 500): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map(item => text(item, field, itemMaximum, true));
  if (result.length > maximum) throw new Error(`${field} must contain at most ${maximum} items`);
  return Array.from(new Set(result));
}

function enumValue<T extends readonly string[]>(value: unknown, field: string, allowed: T, fallback: T[number]): T[number] {
  const result = String(value || fallback).trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(result)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return result as T[number];
}

function score(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 5) throw new Error(`${field} must be an integer from 1 to 5`);
  return result;
}

function requireLogin(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw new Error('Login is required for Idea Lab and Workshop mutations');
  return principal;
}

function titleFrom(note: { path?: string; frontmatter: Record<string, any> }): string {
  return String(note.frontmatter.title || note.path?.split('/').at(-1)?.replace(/\.md$/i, '') || note.path || 'untitled');
}

function ideaBody(params: { title: string; seed: string; problem: string; constraints: string[]; successCriteria: string[]; synthesis?: string }): string {
  return [
    `# ${params.title}`,
    '',
    '## Seed',
    params.seed,
    '',
    ...(params.problem ? ['## Problem', params.problem, ''] : []),
    ...(params.constraints.length ? ['## Constraints', ...params.constraints.map(item => `- ${item}`), ''] : []),
    ...(params.successCriteria.length ? ['## Success criteria', ...params.successCriteria.map(item => `- ${item}`), ''] : []),
    ...(params.synthesis ? ['## Synthesis', params.synthesis, ''] : []),
  ].join('\n');
}

function workshopBody(params: { title: string; prompt: string; agenda: string[]; synthesis?: string }): string {
  return [
    `# ${params.title}`,
    '',
    '## Prompt',
    params.prompt,
    '',
    ...(params.agenda.length ? ['## Agenda', ...params.agenda.map((item, index) => `${index + 1}. ${item}`), ''] : []),
    ...(params.synthesis ? ['## Synthesis', params.synthesis, ''] : []),
  ].join('\n');
}

function boundedProjection(value: Record<string, unknown>, maxChars: number): { value: Record<string, unknown>; truncated: boolean } {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return { value, truncated: false };
  const result = { ...value };
  for (const key of ['contributions', 'evaluations']) {
    if (Array.isArray(result[key])) result[key] = [];
  }
  return { value: result, truncated: true };
}

export class IdeationService {
  constructor(private readonly fileSystem: FileSystemService, private readonly references: ReferenceService) {}

  async createIdea(params: {
    principal?: ScopePrincipal;
    ideaId?: string;
    title: string;
    seed: string;
    problem?: string;
    constraints?: unknown;
    successCriteria?: unknown;
    references?: unknown;
    workshopId?: string;
    expectedRevision?: string;
  }) {
    const principal = requireLogin(params.principal);
    const title = text(params.title, 'title', 180, true);
    const seed = text(params.seed, 'seed', MAX_LONG_TEXT_CHARS, true);
    const problem = text(params.problem, 'problem', MAX_LONG_TEXT_CHARS);
    const constraints = list(params.constraints, 'constraints', 12, 500);
    const successCriteria = list(params.successCriteria, 'successCriteria', 12, 500);
    const ideaId = params.ideaId ? normalizeScopeId(params.ideaId, 'ideaId') : `idea-${randomUUID().slice(0, 12)}`;
    const path = ideaPath(ideaId);
    if (params.expectedRevision && params.expectedRevision !== 'missing') throw new Error('A new idea must use expectedRevision=missing');
    const references = await this.references.validateAndNormalize(params.references, path, principal, seed);
    const timestamp = now();
    await this.fileSystem.writeNote({
      path,
      content: `${ideaBody({ title, seed, problem, constraints, successCriteria })}\n`,
      frontmatter: {
        mcpvault_type: 'idea', idea_id: ideaId, title, author: identity(principal),
        status: 'seed', parent_ideas: [], ...(params.workshopId && { workshop_id: normalizeScopeId(params.workshopId, 'workshopId') }),
        references, constraints, success_criteria: successCriteria,
        created_at: timestamp, updated_at: timestamp,
      },
      expectedRevision: 'missing',
    });
    const created = await this.fileSystem.readNote(path);
    return { success: true, ideaId, path, status: 'seed', revision: created.revision };
  }

  private async readTyped(path: string, type: string) {
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== type) throw new Error(`Expected ${type} at ${path}`);
    return note;
  }

  async listIdeas(params: { status?: string; workshopId?: string; limit?: number; maxChars?: number }) {
    const filters: Record<string, unknown> = { mcpvault_type: 'idea' };
    if (params.status) filters.status = enumValue(params.status, 'status', IDEA_STATUSES, 'exploring');
    if (params.workshopId) filters.workshop_id = normalizeScopeId(params.workshopId, 'workshopId');
    const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), MAX_LIST_CHARS);
    const [window, total] = await Promise.all([
      queryWindow(this.fileSystem, { pathPrefix: IDEA_ROOT, filters, sortBy: 'updated_at', sortOrder: 'desc', limit }),
      this.fileSystem.countNotes({ pathPrefix: IDEA_ROOT, filters }),
    ]);
    const items = window.notes.map(note => ({
      ideaId: note.frontmatter.idea_id, title: titleFrom(note), status: note.frontmatter.status || 'seed',
      author: note.frontmatter.author, workshopId: note.frontmatter.workshop_id,
      parentIdeas: note.frontmatter.parent_ideas || [], updatedAt: note.frontmatter.updated_at, path: note.path,
    }));
    const bounded = boundItems(items, maxChars);
    return { ideas: bounded.items, total, truncated: window.truncated || total > window.notes.length || bounded.truncated };
  }

  async readIdea(params: { ideaId: string; limit?: number; maxChars?: number; includeContent?: boolean }) {
    const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
    const path = ideaPath(ideaId);
    const note = await this.readTyped(path, 'idea');
    const limit = Math.min(Math.max(Number(params.limit ?? 12), 1), 50);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), MAX_LIST_CHARS);
    const [contributionWindow, evaluationWindow, contributionTotal, evaluationTotal] = await Promise.all([
      queryWindow(this.fileSystem, { pathPrefix: `${IDEA_ROOT}/${ideaId}/Contributions`, filters: { mcpvault_type: 'idea_contribution' }, sortBy: 'created_at', sortOrder: 'desc', limit, includeContent: true }),
      queryWindow(this.fileSystem, { pathPrefix: `${IDEA_ROOT}/${ideaId}/Evaluations`, filters: { mcpvault_type: 'idea_evaluation' }, sortBy: 'created_at', sortOrder: 'desc', limit, includeContent: true }),
      this.fileSystem.countNotes({ pathPrefix: `${IDEA_ROOT}/${ideaId}/Contributions`, filters: { mcpvault_type: 'idea_contribution' } }),
      this.fileSystem.countNotes({ pathPrefix: `${IDEA_ROOT}/${ideaId}/Evaluations`, filters: { mcpvault_type: 'idea_evaluation' } }),
    ]);
    const items = {
      idea: {
        ideaId, path, title: titleFrom(note), status: note.frontmatter.status || 'seed', author: note.frontmatter.author,
        parentIdeas: note.frontmatter.parent_ideas || [], workshopId: note.frontmatter.workshop_id,
        references: note.frontmatter.references || [], revision: note.revision,
        ...(params.includeContent !== false && { content: note.content.slice(0, Math.min(note.content.length, maxChars)) }),
      },
      contributions: contributionWindow.notes.map(item => ({
        contributionId: item.frontmatter.contribution_id, kind: item.frontmatter.kind, author: item.frontmatter.author,
        content: (item.content || '').slice(0, MAX_CONTRIBUTION_CHARS), references: item.frontmatter.references || [],
        createdAt: item.frontmatter.created_at, replyTo: item.frontmatter.reply_to,
      })),
      evaluations: evaluationWindow.notes.map(item => ({
        evaluator: item.frontmatter.evaluator, novelty: item.frontmatter.novelty, usefulness: item.frontmatter.usefulness,
        feasibility: item.frontmatter.feasibility, risk: item.frontmatter.risk, evidenceQuality: item.frontmatter.evidence_quality,
        rationale: (item.content || '').slice(0, MAX_CONTRIBUTION_CHARS), createdAt: item.frontmatter.created_at,
      })),
    };
    const bounded = boundedProjection(items, maxChars);
    return { ...bounded.value, contributionTotal, evaluationTotal, truncated: contributionWindow.truncated || evaluationWindow.truncated || bounded.truncated };
  }

  async branchIdea(params: { principal?: ScopePrincipal; parentIdeaId: string; ideaId?: string; title: string; seed: string; references?: unknown; expectedParentRevision: string }) {
    const principal = requireLogin(params.principal);
    if (!params.expectedParentRevision) throw new Error('expectedParentRevision is required; read the parent idea first');
    const parentId = normalizeScopeId(params.parentIdeaId, 'parentIdeaId');
    const parent = await this.readTyped(ideaPath(parentId), 'idea');
    if (parent.revision !== params.expectedParentRevision) throw new Error('The parent idea changed; reread it before branching');
    const result = await this.createIdea({
      principal, ...(params.ideaId && { ideaId: params.ideaId }), title: params.title, seed: params.seed, references: params.references,
      expectedRevision: 'missing',
    });
    const child = await this.readTyped(ideaPath(result.ideaId), 'idea');
    const timestamp = now();
    await this.fileSystem.writeNote({
      path: ideaPath(result.ideaId), content: child.content,
      frontmatter: { ...child.frontmatter, parent_ideas: [parentId], relation: 'branch_of', updated_at: timestamp },
      expectedRevision: result.revision,
    });
    const updated = await this.fileSystem.readNote(ideaPath(result.ideaId));
    return { ...result, parentIdeaId: parentId, revision: updated.revision };
  }

  async updateIdeaStatus(params: { principal?: ScopePrincipal; ideaId: string; status: string; reason: string; expectedRevision: string }) {
    const principal = requireLogin(params.principal);
    const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
    const status = enumValue(params.status, 'status', IDEA_STATUSES, 'exploring');
    const reason = text(params.reason, 'reason', 500, true);
    const note = await this.readTyped(ideaPath(ideaId), 'idea');
    if (note.revision !== params.expectedRevision) throw new Error('The idea changed; reread it before changing status');
    const timestamp = now();
    await this.fileSystem.writeNote({
      path: ideaPath(ideaId), content: note.content,
      frontmatter: { ...note.frontmatter, status, status_reason: reason, status_changed_by: identity(principal), status_changed_at: timestamp, updated_at: timestamp },
      expectedRevision: params.expectedRevision,
    });
    const updated = await this.fileSystem.readNote(ideaPath(ideaId));
    return { success: true, ideaId, status, reason, revision: updated.revision };
  }

  async contributeIdea(params: { principal?: ScopePrincipal; ideaId: string; kind: string; content: string; references?: unknown; replyTo?: string }) {
    const principal = requireLogin(params.principal);
    const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
    const idea = await this.readTyped(ideaPath(ideaId), 'idea');
    if (['rejected', 'promoted'].includes(String(idea.frontmatter.status))) throw new Error('This idea is closed for new contributions');
    const kind = enumValue(params.kind, 'kind', IDEA_CONTRIBUTION_KINDS, 'extension');
    const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
    const contributionId = `contrib-${randomUUID().slice(0, 12)}`;
    const path = ideaContributionPath(ideaId, contributionId);
    const references = await this.references.validateAndNormalize(params.references, path, principal, content);
    await this.fileSystem.writeNote({
      path, content: `${content}\n`, frontmatter: {
        mcpvault_type: 'idea_contribution', contribution_id: contributionId, idea_id: ideaId, kind,
        author: identity(principal), ...(params.replyTo && { reply_to: normalizeScopeId(params.replyTo, 'replyTo') }),
        references, created_at: now(),
      }, expectedRevision: 'missing',
    });
    return { success: true, ideaId, contributionId, kind, path };
  }

  async evaluateIdea(params: { principal?: ScopePrincipal; ideaId: string; novelty: unknown; usefulness: unknown; feasibility: unknown; risk: unknown; evidenceQuality: unknown; rationale: string; references?: unknown; expectedRevision?: string }) {
    const principal = requireLogin(params.principal);
    const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
    await this.readTyped(ideaPath(ideaId), 'idea');
    const evaluator = normalizeScopeId(identity(principal), 'evaluatorId');
    const path = ideaEvaluationPath(ideaId, evaluator);
    const exists = await this.fileSystem.noteExists(path);
    const current = exists ? await this.readTyped(path, 'idea_evaluation') : undefined;
    const expectedRevision = params.expectedRevision || (exists ? '' : 'missing');
    if (!expectedRevision) throw new Error('expectedRevision is required when updating an existing evaluation');
    const rationale = text(params.rationale, 'rationale', MAX_CONTRIBUTION_CHARS, true);
    const references = await this.references.validateAndNormalize(params.references ?? current?.frontmatter.references, path, principal, rationale);
    await this.fileSystem.writeNote({
      path, content: `${rationale}\n`, frontmatter: {
        ...(current?.frontmatter || {}), mcpvault_type: 'idea_evaluation', idea_id: ideaId, evaluator,
        novelty: score(params.novelty, 'novelty'), usefulness: score(params.usefulness, 'usefulness'),
        feasibility: score(params.feasibility, 'feasibility'), risk: score(params.risk, 'risk'),
        evidence_quality: score(params.evidenceQuality, 'evidenceQuality'), references,
        created_at: current?.frontmatter.created_at || now(), updated_at: now(),
      }, expectedRevision,
    });
    const updated = await this.fileSystem.readNote(path);
    return { success: true, ideaId, evaluator, revision: updated.revision };
  }

  async createWorkshop(params: { principal?: ScopePrincipal; workshopId?: string; title: string; prompt: string; agenda?: unknown; ideaIds?: unknown; timeboxMinutes?: number; maxContributionsPerAgent?: number; references?: unknown }) {
    const principal = requireLogin(params.principal);
    const title = text(params.title, 'title', 180, true);
    const prompt = text(params.prompt, 'prompt', MAX_LONG_TEXT_CHARS, true);
    const agenda = list(params.agenda, 'agenda', 12, 500);
    const ideaIds = list(params.ideaIds, 'ideaIds', 20, 64).map(value => normalizeScopeId(value, 'ideaId'));
    for (const ideaId of ideaIds) await this.readTyped(ideaPath(ideaId), 'idea');
    const timeboxMinutes = params.timeboxMinutes === undefined ? undefined : Math.min(Math.max(Number(params.timeboxMinutes), 1), 10080);
    if (timeboxMinutes !== undefined && !Number.isInteger(timeboxMinutes)) throw new Error('timeboxMinutes must be an integer');
    const maxContributionsPerAgent = params.maxContributionsPerAgent === undefined ? 3 : Math.min(Math.max(Number(params.maxContributionsPerAgent), 1), 20);
    if (!Number.isInteger(maxContributionsPerAgent)) throw new Error('maxContributionsPerAgent must be an integer');
    const workshopId = params.workshopId ? normalizeScopeId(params.workshopId, 'workshopId') : `workshop-${randomUUID().slice(0, 12)}`;
    const path = workshopPath(workshopId);
    const references = await this.references.validateAndNormalize(params.references, path, principal, prompt);
    const timestamp = now();
    await this.fileSystem.writeNote({
      path, content: `${workshopBody({ title, prompt, agenda })}\n`, frontmatter: {
        mcpvault_type: 'workshop', workshop_id: workshopId, title, prompt, agenda, idea_ids: ideaIds,
        phase: 'diverge', status: 'open', facilitator: identity(principal), references,
        ...(timeboxMinutes !== undefined && { timebox_minutes: timeboxMinutes }), max_contributions_per_agent: maxContributionsPerAgent,
        created_at: timestamp, updated_at: timestamp,
      }, expectedRevision: 'missing',
    });
    const created = await this.fileSystem.readNote(path);
    return { success: true, workshopId, path, phase: 'diverge', revision: created.revision };
  }

  async listWorkshops(params: { phase?: string; status?: string; limit?: number; maxChars?: number }) {
    const filters: Record<string, unknown> = { mcpvault_type: 'workshop' };
    if (params.phase) filters.phase = enumValue(params.phase, 'phase', WORKSHOP_PHASES, 'diverge');
    if (params.status) filters.status = params.status === 'closed' ? 'closed' : 'open';
    const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), MAX_LIST_CHARS);
    const [window, total] = await Promise.all([
      queryWindow(this.fileSystem, { pathPrefix: WORKSHOP_ROOT, filters, sortBy: 'updated_at', sortOrder: 'desc', limit }),
      this.fileSystem.countNotes({ pathPrefix: WORKSHOP_ROOT, filters }),
    ]);
    const items = window.notes.map(note => ({ workshopId: note.frontmatter.workshop_id, title: titleFrom(note), phase: note.frontmatter.phase, status: note.frontmatter.status, facilitator: note.frontmatter.facilitator, updatedAt: note.frontmatter.updated_at, path: note.path }));
    const bounded = boundItems(items, maxChars);
    return { workshops: bounded.items, total, truncated: window.truncated || total > window.notes.length || bounded.truncated };
  }

  async readWorkshop(params: { workshopId: string; limit?: number; maxChars?: number; includeContent?: boolean }) {
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const note = await this.readTyped(workshopPath(workshopId), 'workshop');
    const limit = Math.min(Math.max(Number(params.limit ?? 15), 1), 50);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), MAX_LIST_CHARS);
    const [window, total] = await Promise.all([
      queryWindow(this.fileSystem, { pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' }, sortBy: 'created_at', sortOrder: 'desc', limit, includeContent: true }),
      this.fileSystem.countNotes({ pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' } }),
    ]);
    const value = {
      workshop: { workshopId, path: workshopPath(workshopId), title: titleFrom(note), prompt: note.frontmatter.prompt, phase: note.frontmatter.phase, status: note.frontmatter.status, agenda: note.frontmatter.agenda || [], ideaIds: note.frontmatter.idea_ids || [], nextAction: note.frontmatter.next_action, revision: note.revision, ...(params.includeContent !== false && { content: note.content.slice(0, maxChars) }) },
      contributions: window.notes.map(item => ({ contributionId: item.frontmatter.contribution_id, kind: item.frontmatter.kind, phase: item.frontmatter.phase, author: item.frontmatter.author, ideaId: item.frontmatter.idea_id, content: (item.content || '').slice(0, MAX_CONTRIBUTION_CHARS), references: item.frontmatter.references || [], createdAt: item.frontmatter.created_at })),
    };
    const bounded = boundedProjection(value, maxChars);
    return { ...bounded.value, contributionTotal: total, truncated: window.truncated || bounded.truncated };
  }

  async contributeWorkshop(params: { principal?: ScopePrincipal; workshopId: string; kind: string; content: string; ideaId?: string; references?: unknown; expectedPhase?: string }) {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const workshop = await this.readTyped(workshopPath(workshopId), 'workshop');
    if (workshop.frontmatter.status === 'closed' || workshop.frontmatter.phase === 'closed') throw new Error('This workshop is closed for contributions');
    const phase = enumValue(workshop.frontmatter.phase, 'phase', WORKSHOP_PHASES, 'diverge');
    if (params.expectedPhase && params.expectedPhase !== phase) throw new Error(`Workshop phase changed to ${phase}; reread it before contributing`);
    const kind = enumValue(params.kind, 'kind', WORKSHOP_CONTRIBUTION_KINDS, 'idea');
    const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
    const ideaId = params.ideaId ? normalizeScopeId(params.ideaId, 'ideaId') : undefined;
    if (ideaId) await this.readTyped(ideaPath(ideaId), 'idea');
    const contributionId = `contrib-${randomUUID().slice(0, 12)}`;
    const path = workshopContributionPath(workshopId, contributionId);
    const references = await this.references.validateAndNormalize(params.references, path, principal, content);
    await this.fileSystem.writeNote({ path, content: `${content}\n`, frontmatter: { mcpvault_type: 'workshop_contribution', contribution_id: contributionId, workshop_id: workshopId, phase, kind, ...(ideaId && { idea_id: ideaId }), author: identity(principal), references, created_at: now() }, expectedRevision: 'missing' });
    return { success: true, workshopId, contributionId, phase, kind, path };
  }

  async updateWorkshopPhase(params: { principal?: ScopePrincipal; workshopId: string; phase: string; reason: string; expectedRevision: string }) {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const phase = enumValue(params.phase, 'phase', WORKSHOP_PHASES, 'diverge');
    const reason = text(params.reason, 'reason', 500, true);
    const note = await this.readTyped(workshopPath(workshopId), 'workshop');
    if (note.revision !== params.expectedRevision) throw new Error('The workshop changed; reread it before advancing the phase');
    const status = phase === 'closed' ? 'closed' : 'open';
    const timestamp = now();
    await this.fileSystem.writeNote({ path: workshopPath(workshopId), content: note.content, frontmatter: { ...note.frontmatter, phase, status, phase_reason: reason, phase_changed_by: identity(principal), phase_changed_at: timestamp, updated_at: timestamp }, expectedRevision: params.expectedRevision });
    const updated = await this.fileSystem.readNote(workshopPath(workshopId));
    return { success: true, workshopId, phase, status, reason, revision: updated.revision };
  }

  async synthesizeWorkshop(params: { principal?: ScopePrincipal; workshopId: string; synthesis: string; references?: unknown; expectedRevision: string }) {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const synthesis = text(params.synthesis, 'synthesis', MAX_LONG_TEXT_CHARS, true);
    const note = await this.readTyped(workshopPath(workshopId), 'workshop');
    if (note.revision !== params.expectedRevision) throw new Error('The workshop changed; reread it before recording synthesis');
    const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, workshopPath(workshopId), principal, synthesis);
    const title = titleFrom(note);
    const agenda = Array.isArray(note.frontmatter.agenda) ? note.frontmatter.agenda.map(String) : [];
    await this.fileSystem.writeNote({ path: workshopPath(workshopId), content: `${workshopBody({ title, prompt: String(note.frontmatter.prompt || ''), agenda, synthesis })}\n`, frontmatter: { ...note.frontmatter, references, synthesis_status: 'proposed', synthesis_by: identity(principal), synthesis_at: now(), phase: 'decide', updated_at: now(), next_action: 'Review the synthesis and create wiki.decision_record or an agent task.' }, expectedRevision: params.expectedRevision });
    const updated = await this.fileSystem.readNote(workshopPath(workshopId));
    return { success: true, workshopId, phase: 'decide', synthesisStatus: 'proposed', nextAction: 'Review the synthesis and create wiki.decision_record or an agent task.', revision: updated.revision };
  }
}
