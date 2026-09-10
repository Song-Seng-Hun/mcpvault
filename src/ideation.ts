import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNote, QueryNotesCursor } from './types.js';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { queryWindow } from './paged-query.js';
import { isModerationHidden } from './moderation-policy.js';
import { validateWorkshopReferences } from './workshop-reference-validation.js';
import { buildMarkdownLiteralMask } from './backlinks.js';
import { coordinate } from './work-model.js';
import { WorkshopOutputService, type WorkshopOutputAdapter } from './workshop-output.js';
import { workshopInputGuide } from './workshop-input-guide.js';
import { attachPublicCreateRequest, preparePublicCreateRequest, runPublicCreate } from './community-public-retry.js';
import {
  advanceFacilitation, createFacilitation, FACILITATION_METHODS, managedFacilitationMarkdown, nextFacilitationAction,
  type FacilitationSubmission, type WorkshopFacilitation, validateFacilitationSubmission, validateFacilitationSynthesis,
  workshopLineagePrerequisites,
} from './workshop-facilitation.js';

const IDEA_ROOT = 'Community/Ideas';
const WORKSHOP_ROOT = 'Community/Workshops';
type FacilitationGuard = { path: string; expectedRevision: string };
type ManagedContribution = { note: QueryNote; submission: FacilitationSubmission; guards: FacilitationGuard[] };

/** Replace only the exact generated block, never an authored heading/suffix.
 * Ambiguous or externally edited blocks require explicit repair. */
function replaceFacilitationBlock(content:string, before:string|undefined, after:string):string {
  if(!before)return `${content.trimEnd()}\n\n${after}\n`;
  const mask=buildMarkdownLiteralMask(content), matches:number[]=[];
  let offset=0;
  while((offset=content.indexOf(before,offset))>=0){if(!mask[offset] && (offset===0 || content[offset-1]==='\n'))matches.push(offset);offset+=before.length;}
  if(matches.length!==1)throw guidanceError(new Error('Managed facilitation block changed or is ambiguous; repair it before updating'), 'guid-1a7447069962e0ae');
  const start=matches[0]!;
  return content.slice(0,start)+after+content.slice(start+before.length);
}
const MAX_CONTRIBUTION_CHARS = 280;
const MAX_LONG_TEXT_CHARS = 4000;
const MAX_LIST_CHARS = 20000;
const MAX_MANAGED_CONTRIBUTION_SCAN = 128;

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
export interface ResearchWorkshopWork { taskId: string; expectedRevision: string; expectedGeneration: number }

const now = () => new Date().toISOString();
const identity = (principal: ScopePrincipal) => principal.agentId || principal.modelId;
const ideaPath = (ideaId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}.md`;
const ideaContributionPath = (ideaId: string, contributionId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;
const ideaEvaluationPath = (ideaId: string, evaluatorId: string) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Evaluations/${normalizeScopeId(evaluatorId, 'evaluatorId')}.md`;
const workshopPath = (workshopId: string) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}.md`;
const workshopContributionPath = (workshopId: string, contributionId: string) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;
const workshopFacilitationReceiptLimit = 16;

function hashPayload(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, ordered(child)]))
      : item;
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}

function managedFacilitation(note: { frontmatter: Record<string, unknown> }): WorkshopFacilitation | undefined {
  if (note.frontmatter.facilitation === undefined) return undefined;
  try { return createFacilitation(note.frontmatter.facilitation); }
  catch (error) { throw guidanceError(new Error(`Managed facilitation configuration is malformed: ${error instanceof Error ? error.message : 'invalid value'}`), 'guid-991ec137da6d531c'); }
}

function initialFacilitation(value:unknown):WorkshopFacilitation {
  const state=createFacilitation(value);
  if(state.currentStepId!==state.methods[0]!.steps[0]!.id || state.round!==1 || (state.brainwritingCycle??1)!==1 || state.facilitatorGeneration!==0
    || state.ordinaryRedoCount!==0 || state.outputs.length || state.checks.length)throw guidanceError(new Error('Initial facilitation must start at its first step without forged progress or outputs'), 'guid-18066c4acf12c79f');
  return state;
}

function facilitationReceipts(note: { frontmatter: Record<string, unknown> }): Array<Record<string, unknown>> {
  const value = note.frontmatter.facilitation_mutation_receipts;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > workshopFacilitationReceiptLimit || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw guidanceError(new Error('Managed facilitation mutation receipts are malformed'), 'guid-dbd260c5d34df5ea');
  }
  return value as Array<Record<string, unknown>>;
}

function requireFacilitator(principal: ScopePrincipal, facilitation: WorkshopFacilitation): void {
  if (principal.accountId !== facilitation.facilitatorAccountId) throw guidanceError(new Error('Only the current authenticated facilitator account may manage this workshop'), 'guid-0e252e8b90918500');
}

async function revalidateManagedActor(principal: ScopePrincipal, revalidateActor?: () => Promise<ScopePrincipal>): Promise<ScopePrincipal> {
  const current = revalidateActor ? await revalidateActor() : principal;
  if (current.accountId !== principal.accountId) throw guidanceError(new Error('Authenticated account changed before the managed facilitation mutation could be finalized'), 'guid-363030a921f26003');
  return current;
}

function facilitationCursor(value: unknown): QueryNotesCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw guidanceError(new Error('cursor must be an object returned by read_workshop_facilitation'), 'guid-a87d3027db149e2d');
  const cursor = value as Record<string, unknown>;
  const unknown = Object.keys(cursor).filter(key => !['path', 'value', 'missing'].includes(key));
  if (unknown.length || typeof cursor.path !== 'string' || !cursor.path.trim()) throw guidanceError(new Error('cursor is malformed'), 'guid-c4311bf7dbab26f1');
  if (cursor.value !== undefined && typeof cursor.value !== 'string' && typeof cursor.value !== 'number' && typeof cursor.value !== 'boolean' && cursor.value !== null) throw guidanceError(new Error('cursor.value is malformed'), 'guid-043930158938a854');
  if (cursor.missing !== undefined && typeof cursor.missing !== 'boolean') throw guidanceError(new Error('cursor.missing is malformed'), 'guid-133596b3e2f77210');
  return { path: cursor.path, ...(cursor.value === undefined ? {} : { value: cursor.value }), ...(cursor.missing === undefined ? {} : { missing: cursor.missing }) };
}

function combineManagedGuards(...groups: Array<Array<{ path: string; expectedRevision: string }>>): Array<{ path: string; expectedRevision: string }> {
  const guards = new Map<string, { path: string; expectedRevision: string }>();
  for (const guard of groups.flat()) {
    const key = guard.path.toLowerCase();
    const prior = guards.get(key);
    if (prior && prior.expectedRevision !== guard.expectedRevision) throw guidanceError(new Error('Managed workshop revision guards are inconsistent'), 'guid-160863164be808e8');
    guards.set(key, guard);
  }
  if (guards.size > 128) throw guidanceError(new Error('Managed workshop has too many related revision guards; reduce the step without dropping evidence'), 'guid-9cfe4e1339b981bc');
  return [...guards.values()];
}

function text(value: unknown, field: string, maximum: number, required = false): string {
  const result = String(value ?? '').trim();
  if (required && !result) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  if (Array.from(result).length > maximum) throw guidanceError(new Error(`${field} must be ${maximum} Unicode characters or fewer`), 'guid-ece47846ed48d00b');
  return result;
}

function list(value: unknown, field: string, maximum: number, itemMaximum = 500): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw guidanceError(new Error(`${field} must be an array`), 'guid-865ca92fb9b851b2');
  const result = value.map(item => text(item, field, itemMaximum, true));
  if (result.length > maximum) throw guidanceError(new Error(`${field} must contain at most ${maximum} items`), 'guid-f4f055c2f23bdb98');
  return Array.from(new Set(result));
}

function enumValue<T extends readonly string[]>(value: unknown, field: string, allowed: T, fallback: T[number]): T[number] {
  const result = String(value || fallback).trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(result)) throw guidanceError(new Error(`${field} must be one of: ${allowed.join(', ')}`), 'guid-5a45b0b5c070aa75');
  return result as T[number];
}

function score(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 5) throw guidanceError(new Error(`${field} must be an integer from 1 to 5`), 'guid-ac539862d53cad8a');
  return result;
}

function requireLogin(principal?: ScopePrincipal): ScopePrincipal {
  if (!principal) throw guidanceError(new Error('Login is required for Idea Lab and Workshop mutations'), 'guid-9f95fd7664c3d06a');
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
  private outputService?:WorkshopOutputService;
  constructor(private readonly fileSystem: FileSystemService, private readonly references: ReferenceService) {}
  attachOutputAdapter(adapter:WorkshopOutputAdapter):void { this.outputService=new WorkshopOutputService(this.fileSystem,adapter); }

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
    requestId?: string;
  }) {
    const principal = requireLogin(params.principal);
    const title = text(params.title, 'title', 180, true);
    const seed = text(params.seed, 'seed', MAX_LONG_TEXT_CHARS, true);
    const problem = text(params.problem, 'problem', MAX_LONG_TEXT_CHARS);
    const constraints = list(params.constraints, 'constraints', 12, 500);
    const successCriteria = list(params.successCriteria, 'successCriteria', 12, 500);
    if (params.expectedRevision && params.expectedRevision !== 'missing') throw guidanceError(new Error('A new idea must use expectedRevision=missing'), 'guid-e9e1492d765c58ae');
    const workshopId = params.workshopId ? normalizeScopeId(params.workshopId, 'workshopId') : undefined;
    const requestedIdeaId = params.ideaId ? normalizeScopeId(params.ideaId, 'ideaId') : undefined;
    const request = preparePublicCreateRequest({
      principal, requestId: params.requestId, action: 'idea.create', generatedPrefix: 'idea',
      ...(requestedIdeaId && { requestedTargetId: requestedIdeaId }),
      payload: { ideaId: requestedIdeaId, title, seed, problem, constraints, successCriteria, workshopId, references: params.references },
    });
    const ideaId = request?.targetId || requestedIdeaId || `idea-${randomUUID().slice(0, 12)}`;
    const path = ideaPath(ideaId);
    let references: string[] = [];
    let guards: Array<{ path: string; expectedRevision: string }> = [];
    return runPublicCreate({
      fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['initiate'], topicMetadata: { title },
      revalidate: async () => {
        guards = [];
        if (workshopId) {
          const workshop = await this.readTyped(workshopPath(workshopId), 'workshop');
          if (workshop.frontmatter.status === 'closed' || workshop.frontmatter.phase === 'closed') throw guidanceError(new Error('This workshop is closed'), 'guid-7b25d9ba91b613af');
          guards.push({ path: workshopPath(workshopId), expectedRevision: workshop.revision });
        }
        references = await this.references.validateAndNormalize(params.references, path, principal, seed);
        return { parentPaths: guards.map(guard => guard.path) };
      },
      create: async participationGuard => {
        const timestamp = now();
        const body = `${ideaBody({ title, seed, problem, constraints, successCriteria })}\n`;
        const frontmatter = attachPublicCreateRequest(request, {
          mcpvault_type: 'idea', idea_id: ideaId, title, author: identity(principal), status: 'seed', parent_ideas: [],
          ...(workshopId && { workshop_id: workshopId }), references, constraints, success_criteria: successCriteria,
          created_at: timestamp, updated_at: timestamp,
        }, body);
        const write = { path, content: body, frontmatter, expectedRevision: 'missing' };
        const allGuards = [...guards, ...(participationGuard ? [participationGuard] : [])];
        const receipt = allGuards.length
          ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, allGuards)
          : await this.fileSystem.writeNoteWithReceipt(write);
        return { success: true as const, ideaId, path, status: 'seed' as const, revision: receipt.revision };
      },
      replay: note => {
        if (note.frontmatter.mcpvault_type !== 'idea' || note.frontmatter.idea_id !== ideaId) throw guidanceError(new Error('Public request result is unavailable'), 'guid-503e43625954dd85');
        return { success: true as const, ideaId, path, status: 'seed' as const, revision: note.revision };
      },
    });
  }

  private async readTyped(path: string, type: string) {
    const note = await this.fileSystem.readNote(path);
    if (note.frontmatter.mcpvault_type !== type) throw guidanceError(new Error(`Expected ${type} at ${path}`), 'guid-3562d36bcd13cf73');
    if (isModerationHidden(note.frontmatter) || note.frontmatter.content_status === 'deleted') throw guidanceError(new Error(`${type} is unavailable`), 'guid-341defbcb499491e');
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
    if (!params.expectedParentRevision) throw guidanceError(new Error('expectedParentRevision is required; read the parent idea first'), 'guid-879190b9f39e2454');
    const parentId = normalizeScopeId(params.parentIdeaId, 'parentIdeaId');
    const parent = await this.readTyped(ideaPath(parentId), 'idea');
    if (parent.revision !== params.expectedParentRevision) throw guidanceError(new Error('The parent idea changed; reread it before branching'), 'guid-04582bbb86030841');
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
    if (note.revision !== params.expectedRevision) throw guidanceError(new Error('The idea changed; reread it before changing status'), 'guid-0694a231b17bb908');
    const timestamp = now();
    await this.fileSystem.writeNote({
      path: ideaPath(ideaId), content: note.content,
      frontmatter: { ...note.frontmatter, status, status_reason: reason, status_changed_by: identity(principal), status_changed_at: timestamp, updated_at: timestamp },
      expectedRevision: params.expectedRevision,
    });
    const updated = await this.fileSystem.readNote(ideaPath(ideaId));
    return { success: true, ideaId, status, reason, revision: updated.revision };
  }

  async contributeIdea(params: { principal?: ScopePrincipal; ideaId: string; kind: string; content: string; references?: unknown; replyTo?: string; requestId?: string }) {
    const principal = requireLogin(params.principal);
    const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
    const kind = enumValue(params.kind, 'kind', IDEA_CONTRIBUTION_KINDS, 'extension');
    const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
    const replyTo = params.replyTo ? normalizeScopeId(params.replyTo, 'replyTo') : undefined;
    const request = preparePublicCreateRequest({
      principal, requestId: params.requestId, action: 'idea.contribute', generatedPrefix: 'contrib',
      payload: { ideaId, kind, content, replyTo, references: params.references },
    });
    const contributionId = request?.targetId || `contrib-${randomUUID().slice(0, 12)}`;
    const path = ideaContributionPath(ideaId, contributionId);
    let references: string[] = [];
    let guards: Array<{ path: string; expectedRevision: string }> = [];
    return runPublicCreate({
      fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['respond', 'explore'],
      revalidate: async () => {
        const idea = await this.readTyped(ideaPath(ideaId), 'idea');
        if (['rejected', 'promoted'].includes(String(idea.frontmatter.status))) throw guidanceError(new Error('This idea is closed for new contributions'), 'guid-4b2da5eb695daedd');
        guards = [{ path: ideaPath(ideaId), expectedRevision: idea.revision }];
        if (replyTo) {
          const parentPath = ideaContributionPath(ideaId, replyTo);
          const parent = await this.readTyped(parentPath, 'idea_contribution');
          if (parent.frontmatter.idea_id !== ideaId) throw guidanceError(new Error('Reply target is unavailable'), 'guid-ae6a4bae0abacc55');
          guards.push({ path: parentPath, expectedRevision: parent.revision });
        }
        references = await this.references.validateAndNormalize(params.references, path, principal, content);
        return { parentPaths: guards.map(guard => guard.path) };
      },
      create: async participationGuard => {
        const body = `${content}\n`;
        const frontmatter = attachPublicCreateRequest(request, {
          mcpvault_type: 'idea_contribution', contribution_id: contributionId, idea_id: ideaId, kind,
          author: identity(principal), ...(replyTo && { reply_to: replyTo }), references, created_at: now(),
        }, body);
        const write = { path, content: body, frontmatter, expectedRevision: 'missing' };
        const allGuards = [...guards, ...(participationGuard ? [participationGuard] : [])];
        const receipt = allGuards.length
          ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, allGuards)
          : await this.fileSystem.writeNoteWithReceipt(write);
        return { success: true as const, ideaId, contributionId, kind, path, revision: receipt.revision };
      },
      replay: note => {
        if (note.frontmatter.mcpvault_type !== 'idea_contribution' || note.frontmatter.idea_id !== ideaId || note.frontmatter.contribution_id !== contributionId) {
          throw guidanceError(new Error('Public request result is unavailable'), 'guid-503e43625954dd85');
        }
        return { success: true as const, ideaId, contributionId, kind, path, revision: note.revision };
      },
    });
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
    if (!expectedRevision) throw guidanceError(new Error('expectedRevision is required when updating an existing evaluation'), 'guid-ec57f611a5160e56');
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

  async createWorkshop(params: { principal?: ScopePrincipal; workshopId?: string; title: string; prompt: string; agenda?: unknown; ideaIds?: unknown; timeboxMinutes?: number; maxContributionsPerAgent?: number; references?: unknown; facilitation?: unknown; requestId?: string; researchWork?: ResearchWorkshopWork; revalidateActor?: () => Promise<ScopePrincipal> }) {
    const principal = requireLogin(params.principal);
    const title = text(params.title, 'title', 180, true);
    const prompt = text(params.prompt, 'prompt', MAX_LONG_TEXT_CHARS, true);
    const agenda = list(params.agenda, 'agenda', 12, 500);
    const ideaIds = list(params.ideaIds, 'ideaIds', 20, 64).map(value => normalizeScopeId(value, 'ideaId'));
    const timeboxMinutes = params.timeboxMinutes === undefined ? undefined : Math.min(Math.max(Number(params.timeboxMinutes), 1), 10080);
    if (timeboxMinutes !== undefined && !Number.isInteger(timeboxMinutes)) throw guidanceError(new Error('timeboxMinutes must be an integer'), 'guid-c8569ec809bf9f3e');
    const maxContributionsPerAgent = params.maxContributionsPerAgent === undefined ? 3 : Math.min(Math.max(Number(params.maxContributionsPerAgent), 1), 20);
    if (!Number.isInteger(maxContributionsPerAgent)) throw guidanceError(new Error('maxContributionsPerAgent must be an integer'), 'guid-7b8a2d2a189e48b3');
    const requestedWorkshopId = params.workshopId ? normalizeScopeId(params.workshopId, 'workshopId') : undefined;
    const reservedResearchId = requestedWorkshopId ? /^research-[a-f0-9]{48}$/.test(requestedWorkshopId) : false;
    if (reservedResearchId && !params.researchWork) throw guidanceError(new Error('A reserved research workshop requires its current researchWork claim'), 'guid-265e2057fbec76dd');
    if (params.researchWork && !reservedResearchId) throw guidanceError(new Error('researchWork is available only for an exact reserved research workshop id'), 'guid-be000200113c34d5');
    const researchWork = params.researchWork ? {
      taskId: normalizeScopeId(params.researchWork.taskId, 'researchWork.taskId'),
      expectedRevision: String(params.researchWork.expectedRevision || '').trim().toLowerCase(),
      expectedGeneration: Number(params.researchWork.expectedGeneration),
    } : undefined;
    if (researchWork && (researchWork.taskId !== requestedWorkshopId || !/^[a-f0-9]{64}$/.test(researchWork.expectedRevision)
      || !Number.isSafeInteger(researchWork.expectedGeneration) || researchWork.expectedGeneration < 0)) {
      throw guidanceError(new Error('researchWork must identify the matching task, current revision, and non-negative claim generation'), 'guid-70d744c1ea6342f7');
    }
    const request = preparePublicCreateRequest({
      principal, requestId: params.requestId, action: 'workshop.create', generatedPrefix: 'workshop',
      ...(requestedWorkshopId && { requestedTargetId: requestedWorkshopId }),
      payload: { workshopId: requestedWorkshopId, title, prompt, agenda, ideaIds, timeboxMinutes, maxContributionsPerAgent, references: params.references, researchWork, facilitation:params.facilitation },
    });
    const workshopId = request?.targetId || requestedWorkshopId || `workshop-${randomUUID().slice(0, 12)}`;
    const path = workshopPath(workshopId);
    let references: string[] = [];
    let guards: Array<{ path: string; expectedRevision: string }> = [];
    let facilitation = params.facilitation === undefined ? undefined : initialFacilitation(params.facilitation);
    if (facilitation && facilitation.facilitatorAccountId !== principal.accountId) throw guidanceError(new Error('facilitation.facilitatorAccountId must be the authenticated creator account'), 'guid-d2644c91abd036cd');
    return runPublicCreate({
      fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['initiate'], topicMetadata: { title },
      revalidate: async () => {
        guards = [];
        for (const ideaId of ideaIds) {
          const idea = await this.readTyped(ideaPath(ideaId), 'idea');
          guards.push({ path: ideaPath(ideaId), expectedRevision: idea.revision });
        }
        if (researchWork) {
          const taskPath = `Community/Tasks/${researchWork.taskId}.md`;
          const task = await this.readTyped(taskPath, 'agent_task');
          if (task.frontmatter.task_id !== researchWork.taskId || !task.frontmatter.project_id || task.frontmatter.status !== 'in_progress'
            || task.frontmatter.assignee_account_id !== principal.accountId
            || task.frontmatter.claim_generation !== researchWork.expectedGeneration
            || task.revision !== researchWork.expectedRevision) {
            throw guidanceError(new Error('Research task claim changed; refresh the work packet before creating or replaying this workshop'), 'guid-44e27fb4a43e8f5e');
          }
          guards.push({ path: taskPath, expectedRevision: task.revision });
        }
        references = await this.references.validateAndNormalize(params.references, path, principal, prompt);
        if (facilitation) {
          facilitation = await this.validateFacilitationSources(facilitation, principal, path);
          const facilitationGuards = await validateWorkshopReferences(this.fileSystem, this.references, {
            facilitation, prompt, ...(params.references === undefined ? {} : { references: params.references }),
          }, path, principal);
          guards = combineManagedGuards(guards, facilitationGuards);
        }
        return { parentPaths: guards.map(guard => guard.path) };
      },
      create: async participationGuard => {
        if (facilitation) await revalidateManagedActor(principal, params.revalidateActor);
        const timestamp = now();
        const body = `${workshopBody({ title, prompt, agenda })}${facilitation ? `\n${managedFacilitationMarkdown(facilitation)}\n` : '\n'}`;
        const frontmatter = attachPublicCreateRequest(request, {
          mcpvault_type: 'workshop', workshop_id: workshopId, title, prompt, agenda, idea_ids: ideaIds,
          phase: 'diverge', status: 'open', facilitator: identity(principal), facilitator_account_id: principal.accountId, facilitator_generation: 0, references,
          ...(facilitation && { facilitation }),
          ...(timeboxMinutes !== undefined && { timebox_minutes: timeboxMinutes }), max_contributions_per_agent: maxContributionsPerAgent,
          created_at: timestamp, updated_at: timestamp,
        }, body);
        const write = { path, content: body, frontmatter, expectedRevision: 'missing' };
        const allGuards = facilitation ? combineManagedGuards(guards, participationGuard ? [participationGuard] : []) : [...guards, ...(participationGuard ? [participationGuard] : [])];
        const receipt = allGuards.length
          ? await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write, allGuards)
          : await this.fileSystem.writeNoteWithReceipt(write);
        return { success: true as const, workshopId, path, phase: 'diverge' as const, revision: receipt.revision };
      },
      replay: note => {
        if (note.frontmatter.mcpvault_type !== 'workshop' || note.frontmatter.workshop_id !== workshopId) throw guidanceError(new Error('Public request result is unavailable'), 'guid-503e43625954dd85');
        return { success: true as const, workshopId, path, phase: 'diverge' as const, revision: note.revision };
      },
    });
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

  getWorkshopMethods(params: { methodId?: unknown; stepId?:unknown; cursor?: unknown; maxChars?: number } = {}) {
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
    const methodId = params.methodId === undefined ? undefined : String(params.methodId).trim();
    const selected = methodId === undefined ? undefined : FACILITATION_METHODS.find(method => method.methodId === methodId);
    if (methodId !== undefined && !selected) throw guidanceError(new Error('methodId is not a supported managed facilitation method'), 'guid-1ccd8f9908d3865d');
    if(params.stepId!==undefined) {
      const step=selected?.steps.find(s=>s.id===params.stepId);
      if(!step)throw guidanceError(new Error('stepId must belong to the selected methodId'), 'guid-7be08dcbd4293356');
      const response={methodId: selected!.methodId,stepId:step.id,required:step.required,finishCondition:step.finishCondition,...workshopInputGuide(step.id),truncated:false};
      if(Array.from(JSON.stringify(response)).length>maxChars)throw guidanceError(new Error('Increase maxChars for the complete input guide (maximum 12000)'), 'guid-8e33c471caae6c10');
      return response;
    }
    const start = selected || params.cursor === undefined ? 0 : Number(params.cursor);
    if (!Number.isSafeInteger(start) || start < 0 || start >= FACILITATION_METHODS.length) throw guidanceError(new Error('cursor must be a valid list_workshop_methods continuation'), 'guid-69f9e66b64a047a1');
    const source = selected ? [selected] : FACILITATION_METHODS.slice(start);
    const methods = source.map(method => ({ methodId: method.methodId, version: method.version, title: method.title,
      adaptation: method.adaptation, steps: method.steps.map(step => ({ id: step.id, title: step.title, required: step.required,
        finishCondition: step.finishCondition, adaptation: step.adaptation, inputAction:{endpointId:'workshop.methods',arguments:{methodId:method.methodId,stepId:step.id}}, ...(step.minimumAccounts ? { minimumAccounts: step.minimumAccounts } : {}) })) }));
    const bounded = boundItems(methods, maxChars - 240);
    if (!selected && bounded.items.length === 0) {
      if (maxChars >= 12000) throw guidanceError(new Error('A method cannot fit the maximum catalog budget; request an exact methodId'), 'guid-d26fa53eab85e947');
      return { methods: [], truncated: true, cursor: start,
        nextAction: { endpointId: 'workshop.methods', arguments: { cursor: start, maxChars: 12000 } } };
    }
    if (selected && bounded.items.length === 0) {
      return { methods: [{ methodId: selected.methodId, version: selected.version, title: selected.title, stepCount: selected.steps.length }],
        truncated: true, nextAction: { endpointId: 'workshop.methods', arguments: { methodId: selected.methodId, maxChars: 12000 } } };
    }
    const next = !selected && start + bounded.items.length < FACILITATION_METHODS.length ? start + bounded.items.length : undefined;
    return { methods: bounded.items, truncated: bounded.truncated || next !== undefined,
      ...(next === undefined ? {} : { cursor: next, nextAction: { endpointId: 'workshop.methods', arguments: { cursor: next, maxChars } } }) };
  }

  private async validateFacilitationSources(facilitation: WorkshopFacilitation, principal: ScopePrincipal | undefined, containerPath: string): Promise<WorkshopFacilitation> {
    const sourceGuards = await validateWorkshopReferences(this.fileSystem, this.references, { sourceRevisions: facilitation.sourceRevisions }, containerPath, principal);
    if (sourceGuards.length !== facilitation.sourceRevisions.length) throw guidanceError(new Error('Managed facilitation sources are unavailable or changed'), 'guid-58bb554a6883a0d1');
    await validateWorkshopReferences(this.fileSystem, this.references, facilitation, containerPath, principal);
    return facilitation;
  }

  /** Re-open every contribution before it affects a managed workflow. Raw
   * query rows are advisory: deleted, hidden, cross-scope, malformed, stale,
   * revoked, duplicate-ballot, and wrong-workshop rows never reach a count or
   * page cursor. */
  private async managedWorkshopContributions(workshopId: string, facilitation: WorkshopFacilitation, principal?: ScopePrincipal, after?: QueryNotesCursor, incoming?:unknown,excludePath?:string): Promise<{ rows: ManagedContribution[]; incomplete: boolean }> {
    const configuredSteps = new Map(facilitation.methods.flatMap(method => method.steps).map(step => [step.id, step]));
    const currentIndex = [...configuredSteps.keys()].indexOf(facilitation.currentStepId);
    const eligible=(item:QueryNote)=>item.path!==excludePath&&item.frontmatter.workshop_id===workshopId&&!isModerationHidden(item.frontmatter)
      &&item.frontmatter.content_status!=='deleted'&&facilitation.participants.includes(item.frontmatter.account_id)
      &&(item.frontmatter.facilitation_round??1)===facilitation.round;
    const required=new Set([facilitation.currentStepId]);
    const cycling=facilitation.currentStepId==='brainwriting-build'&&(facilitation.brainwritingCycle??1)>1;
    const currentCycle=(fm:Record<string,any>)=>!cycling||fm.structured?.cycle===facilitation.brainwritingCycle;
    for(const step of required)for(const dependency of workshopLineagePrerequisites(step))if(configuredSteps.has(dependency)&&[...configuredSteps.keys()].indexOf(dependency)<=currentIndex)required.add(dependency);
    const queried = await this.fileSystem.queryNotes({
      pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' },
      sortBy: 'created_at', sortOrder: 'asc', limit: MAX_MANAGED_CONTRIBUTION_SCAN, ...(after ? { after } : {}), includeContent: false, includeTotal: true,
    }, () => true, item => eligible(item)&&item.frontmatter.facilitation_step_id===facilitation.currentStepId&&currentCycle(item.frontmatter));
    let incomplete=queried.truncated;
    const candidates=[...queried.notes];
    const ideaFilter=!cycling&&(facilitation.currentStepId==='brainwriting-build'||facilitation.currentStepId.startsWith('scamper-'));
    const wanted=new Set<string>();
    const collectIds=(value:any)=>{for(const id of Array.isArray(value?.parentIdeaIds)?value.parentIdeaIds:[])if(typeof id==='string')wanted.add(id);for(const idea of Array.isArray(value?.ideaIds)?value.ideaIds:[])for(const id of [idea?.ideaId,idea?.parentIdeaId])if(typeof id==='string')wanted.add(id);};
    if(cycling) {
      const previous=await this.fileSystem.queryNotes({pathPrefix:`${WORKSHOP_ROOT}/${workshopId}/Contributions`,filters:{mcpvault_type:'workshop_contribution'},sortBy:'created_at',sortOrder:'asc',limit:128,includeContent:false,includeTotal:true},()=>true,item=>eligible(item)&&item.frontmatter.facilitation_step_id==='brainwriting-build'&&Number(item.frontmatter.structured?.cycle)<facilitation.brainwritingCycle!);
      incomplete ||= previous.truncated;candidates.push(...previous.notes);
    }
    for(const row of candidates)collectIds(row.frontmatter.structured);collectIds(incoming);
    // Read only prerequisite stages; old unrelated transcript pages cannot
    // starve current-step admission. Parent lookups use exact referenced IDs.
    for(const step of [...required].reverse()) {
      if(step===facilitation.currentStepId)continue;
      const prior=await this.fileSystem.queryNotes({pathPrefix:`${WORKSHOP_ROOT}/${workshopId}/Contributions`,filters:{mcpvault_type:'workshop_contribution'},sortBy:'created_at',sortOrder:'asc',limit:128,includeContent:false,includeTotal:true},()=>true,
        item=>eligible(item)&&item.frontmatter.facilitation_step_id===step&&(!ideaFilter||(Array.isArray(item.frontmatter.structured?.ideaIds)&&item.frontmatter.structured.ideaIds.some((i:any)=>wanted.has(i.ideaId)))));
      incomplete ||= prior.truncated;
      candidates.push(...prior.notes);for(const row of prior.notes)collectIds(row.frontmatter.structured);
      if(candidates.length>256){incomplete=true;break;}
    }
    candidates.sort((a,b)=>[...configuredSteps.keys()].indexOf(a.frontmatter.facilitation_step_id)-[...configuredSteps.keys()].indexOf(b.frontmatter.facilitation_step_id)
      ||(cycling?Number(a.frontmatter.structured?.cycle??1)-Number(b.frontmatter.structured?.cycle??1):0)
      ||String(a.frontmatter.created_at||'').localeCompare(String(b.frontmatter.created_at||''))||a.path.localeCompare(b.path));
    const accepted: ManagedContribution[] = [];
    for(const source of facilitation.sourceRevisions) {
      const seedId=`source-${hashPayload(source.path).slice(0,16)}`;
      accepted.push({note:{path:source.path,revision:source.revision,frontmatter:{}},submission:{accountId:facilitation.facilitatorAccountId,stepId:'source-origin',structured:{ideaIds:[{ideaId:seedId,origin:'Pinned public source'}]}},guards:[{path:source.path,expectedRevision:source.revision}]});
    }
    for (const candidate of candidates.slice(0,256)) {
      try {
        const note = await this.fileSystem.readNote(candidate.path);
        if (note.frontmatter.mcpvault_type !== 'workshop_contribution' || note.frontmatter.workshop_id !== workshopId
          || isModerationHidden(note.frontmatter) || note.frontmatter.content_status === 'deleted') continue;
        const accountId = typeof note.frontmatter.account_id === 'string' ? note.frontmatter.account_id : '';
        const stepId = typeof note.frontmatter.facilitation_step_id === 'string' ? note.frontmatter.facilitation_step_id : '';
        const workshopRevision = typeof note.frontmatter.workshop_revision === 'string' ? note.frontmatter.workshop_revision : '';
        const structured = note.frontmatter.structured;
        if (!eligible({path:candidate.path,frontmatter:note.frontmatter}) || !stepId || !structured || typeof structured !== 'object' || Array.isArray(structured)) continue;
        const stepIndex = [...configuredSteps.keys()].indexOf(stepId);
        if (stepIndex < 0 || stepIndex > currentIndex) continue;
        const guards = await validateWorkshopReferences(this.fileSystem, this.references, { structured,
          ...(note.frontmatter.references === undefined ? {} : { references: note.frontmatter.references }) }, candidate.path, principal);
        const validation = validateFacilitationSubmission({ ...facilitation, currentStepId: stepId, ...(cycling?{brainwritingCycle:Number(structured.cycle??1)}:{}) }, {
          accountId, stepId, workshopRevision, structured,
          existingSubmissions: accepted.map(item => item.submission),
        });
        accepted.push({ note: { path: candidate.path, frontmatter: note.frontmatter, revision: note.revision }, submission: { accountId, stepId, structured: validation.structured }, guards: [...guards,{path:candidate.path,expectedRevision:note.revision}] });
      } catch {
        // A malformed or no-longer-visible public contribution cannot block or
        // impersonate a current participant. It is excluded before pagination.
      }
    }
    return { rows: accepted, incomplete };
  }

  private facilitationCursorOffset(rows: Array<{ note: QueryNote }>, cursor: QueryNotesCursor | undefined): number {
    if (!cursor) return 0;
    const index = rows.findIndex(row => row.note.path === cursor.path
      && (cursor.missing === true ? row.note.frontmatter.created_at === undefined : cursor.value === row.note.frontmatter.created_at));
    if (index < 0) throw guidanceError(new Error('cursor no longer identifies an emitted managed contribution'), 'guid-93ffd23dc28eed94');
    return index + 1;
  }

  async readWorkshopFacilitation(params: { principal?: ScopePrincipal; workshopId: string; cursor?: unknown; limit?: number; maxChars?: number }) {
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const note = await this.readTyped(workshopPath(workshopId), 'workshop');
    let facilitation = managedFacilitation(note);
    if (!facilitation) return { workshopId, managed: false, revision: note.revision, nextAction: { kind: 'legacy', message: guidanceText('guid-914b2a497f3ce0e2', 'This legacy workshop uses phase-based contributions.') } };
    const limit = Math.min(Math.max(Number(params.limit ?? 12), 1), 50);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
    const after = params.cursor === undefined ? undefined : facilitationCursor(params.cursor);
    if(note.frontmatter.phase==='closed'&&note.frontmatter.facilitation_close_outcome==='unresolved') {
      return {workshopId,managed:true,revision:note.revision,phase:'closed',outcome:'unresolved',
        nextAction:{kind:'closed',message:guidanceText('guid-869a2b475c06801c', 'Meeting closed unresolved; original outputs and approvals were not changed.')},truncated:false};
    }
    try { facilitation = await this.validateFacilitationSources(facilitation, params.principal, workshopPath(workshopId)); }
    catch { return { workshopId, managed: true, revision: note.revision, blocked: true, facilitation: { version: facilitation.version, currentStepId: facilitation.currentStepId, round: facilitation.round }, submissions: [], submissionTotal: 0, nextAction: { kind: 'blocked', stepId: facilitation.currentStepId, message: guidanceText('guid-315205edaac603ba', 'Managed sources are unavailable or changed; refresh authorized sources before continuing.') }, truncated: false }; }
    const aggregate = await this.managedWorkshopContributions(workshopId, facilitation, params.principal);
    // Pagination is a view over a complete bounded current-step admission scan,
    // so a continuation cannot forget frozen alternatives or count duplicates.
    const page = aggregate;
    const rows = page.rows.filter(row=>row.submission.stepId===facilitation!.currentStepId&&((facilitation!.brainwritingCycle??1)<=1||row.submission.structured.cycle===facilitation!.brainwritingCycle));
    const offset = this.facilitationCursorOffset(rows, after);
    const candidates = rows.slice(offset, offset + limit);
    const action = note.frontmatter.phase==='closed' ? {kind:'closed',message:guidanceText('guid-beee6bd69298982b', 'Meeting closed. Review linked outputs; no execution permission is granted.')} : aggregate.incomplete
      ? { kind: 'blocked', stepId: facilitation.currentStepId, required: ['complete managed contribution scan'], finishCondition: 'A bounded scan must cover every eligible current-step contribution before completion is assessed.', adaptation: 'Read a narrower current source window or resolve the workshop backlog; no completion is inferred.' }
      : nextFacilitationAction(facilitation, aggregate.rows.map(row => row.submission));
    const project = (row: typeof rows[number]) => ({ contributionId: row.note.frontmatter.contribution_id, accountId: row.submission.accountId,
      stepId: row.submission.stepId, structured: row.submission.structured, createdAt: row.note.frontmatter.created_at });
    const currentStep = facilitation.methods.flatMap(method => method.steps).find(step => step.id === facilitation.currentStepId)!;
    const sourcePins = facilitation.sourceRevisions.slice(0, 2);
    const publicFacilitation = { version: facilitation.version, purpose: facilitation.purpose, scope: facilitation.scope,
      successCriteria: facilitation.successCriteria, currentStepId: facilitation.currentStepId, round: facilitation.round,
      ...(facilitation.brainwritingCycle&&{brainwritingCycle:facilitation.brainwritingCycle,cycleInstruction:'6-3-5: six actual accounts each submit three extensions of peers from the previous cycle; variant 6-3-5, cycle equals brainwritingCycle, cycleMinutes 5. Declared timing is not verified attendance.'}),
      facilitatorAccountId: facilitation.facilitatorAccountId, currentStep: { title: currentStep.title, required: currentStep.required,
        finishCondition: currentStep.finishCondition, adaptation: currentStep.adaptation, input:workshopInputGuide(currentStep.id,params.principal?.accountId,sourcePins[0]) }, sourcePins,
      sourceOrigins:sourcePins.map(source=>({path:source.path,ideaId:`source-${hashPayload(source.path).slice(0,16)}`,revision:source.revision})),
      sourcePinsTruncated: facilitation.sourceRevisions.length > sourcePins.length,
      ...(facilitation.sourceRevisions.length > sourcePins.length ? { sourceDetailAction: { endpointId: 'notes.read', arguments: { path: workshopPath(workshopId), expectedRevision: note.revision, maxChars: 4000 } } } : {}) };
    const outputAuthority = 'not_execution_authority';
    const responseFor = (items: typeof candidates) => {
      const more = offset + items.length < rows.length || page.incomplete;
      const last = items.at(-1)?.note;
      const cursor = more && last ? { path: last.path,
        ...(last.frontmatter.created_at === undefined ? { missing: true } : { value: last.frontmatter.created_at as string | number | boolean | null }) } : undefined;
      return { workshopId, managed: true, revision: note.revision, facilitation: publicFacilitation, outputAuthority, nextAction: action,
        submissions: items.map(project), submissionTotal: rows.length,
        ...(note.frontmatter.workshop_output_pending&&{pendingOutput:{state:'pending',guidance:guidanceText('guid-1b792863732a2d58', 'Reread the same reserved output ID and payload to recover. If no output exists, the current facilitator may use cancel_output with outputId and reason; no created output is deleted.'),nextAction:{endpointId:'notes.read',arguments:{path:workshopPath(workshopId),expectedRevision:note.revision,maxChars:4000}}}}),
        completionUnknown: aggregate.incomplete, ...(cursor ? { cursor } : {}), truncated: more };
    };
    let emitted = candidates;
    while (emitted.length && Array.from(JSON.stringify(responseFor(emitted))).length > maxChars) emitted = emitted.slice(0, -1);
    const response = responseFor(emitted);
    if (Array.from(JSON.stringify(response)).length > maxChars || (candidates.length > 0 && emitted.length === 0)) {
      throw guidanceError(new Error('maxChars is too small for required context and one contribution; increase it (maximum 12000). Cursor was not advanced.'), 'guid-a2671d2d59f85d1c');
    }
    return response;
  }

  async updateWorkshopFacilitation(params: {
    principal?: ScopePrincipal; workshopId: string; expectedRevision: string; requestId: string; operation: string;
    payload?: unknown; stepId?: string; structured?: unknown; content?: string; kind?: string; references?: unknown; revalidateActor?: () => Promise<ScopePrincipal>;
  }) {
    return coordinate(async () => {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const requestId = text(params.requestId, 'requestId', 128, true);
    const operation = enumValue(params.operation, 'operation', ['configure', 'submit', 'advance', 'handoff', 'revoke', 'pause','resume','redo', 'synthesize', 'record_output','delegate','execute_output','cancel_output','reconcile_output','close'] as const, 'configure');
    const unresolvedClose=operation==='close'&&params.payload!==null&&typeof params.payload==='object'&&!Array.isArray(params.payload)&&(params.payload as Record<string,unknown>).outcome==='unresolved';
    const recovery=operation==='cancel_output'||operation==='reconcile_output'||unresolvedClose;
    const path = workshopPath(workshopId);
    const note = await this.readTyped(path, 'workshop');
    const payloadHash = hashPayload({ operation, payload: params.payload, stepId: params.stepId, structured: params.structured, content: params.content, kind: params.kind, references: params.references });
    const requestKey = hashPayload({ accountId: principal.accountId, requestId });
    const owner = String(note.frontmatter.facilitator_account_id || '');
    let facilitation = managedFacilitation(note);
    const previousBlock = facilitation ? managedFacilitationMarkdown(facilitation) : undefined;
    const completionGuards: FacilitationGuard[] = [];
    if (facilitation) {
      if(!recovery)facilitation = await this.validateFacilitationSources(facilitation, principal, path);
      if (operation === 'submit') {
        if (!facilitation.participants.includes(principal.accountId)) throw guidanceError(new Error('Only an explicitly configured participant account may submit to managed facilitation'), 'guid-9672d34cd4a91774');
      } else if(operation!=='execute_output') {
        requireFacilitator(principal, facilitation);
      }
    } else if (operation === 'configure') {
      if (!owner) throw guidanceError(new Error('This legacy workshop has no account-bound facilitator and cannot be converted to managed facilitation'), 'guid-0856732d5fb78ec7');
      if (principal.accountId !== owner) throw guidanceError(new Error('Only the creator account may configure managed facilitation'), 'guid-abb5cc3bdb73f3e7');
    }
    const receipts = facilitationReceipts(note);
    if(recovery&&owner!==principal.accountId)throw guidanceError(Error('Only the current workshop facilitator may recover or close unresolved'), 'guid-6975cba6e2d650af');
    const prior = receipts.find(receipt => receipt.request_key === requestKey);
    if (prior) {
      if (prior.operation !== operation || prior.payload_hash !== payloadHash) throw guidanceError(new Error('requestId was already used for a different facilitation mutation or payload'), 'guid-fd709fff9f63123b');
      if(operation==='reconcile_output') {
        if(!this.outputService)throw guidanceError(Error('Managed output adapter is unavailable'), 'guid-3c341f947b39bd1b');
        await this.outputService.verifyReconciliationReplay(path,note,principal,params.payload,async()=>{await revalidateManagedActor(principal,params.revalidateActor);});
      }
      await revalidateManagedActor(principal, params.revalidateActor);
      return { success: true, workshopId, replayed: true, ...(prior.result && typeof prior.result === 'object' && !Array.isArray(prior.result) ? prior.result as Record<string, unknown> : {}), revision: note.revision };
    }
    if(operation==='cancel_output') {
      if(!facilitation||!this.outputService)throw guidanceError(new Error('Managed output adapter is unavailable'), 'guid-3c341f947b39bd1b');
      if(note.revision!==params.expectedRevision)throw guidanceError(new Error('Workshop revision changed; reread before cancellation'), 'guid-b7370d45502ab43e');
      return this.outputService.cancel(path,note,principal,params.payload,async()=>{await revalidateManagedActor(principal,params.revalidateActor);},{requestKey,payloadHash});
    }
    if(operation==='reconcile_output') {
      if(!facilitation||!this.outputService)throw guidanceError(Error('Managed output adapter is unavailable'), 'guid-3c341f947b39bd1b');
      if(note.revision!==params.expectedRevision)throw guidanceError(Error('Workshop revision changed; reread before reconciliation'), 'guid-29e33c1ed37171ee');
      return this.outputService.reconcile(path,note,principal,params.payload,async()=>{await revalidateManagedActor(principal,params.revalidateActor);},{requestKey,payloadHash});
    }
    if(operation==='execute_output') {
      if(!facilitation||!this.outputService)throw guidanceError(new Error('Managed output adapter is unavailable'), 'guid-3c341f947b39bd1b');
      if(note.revision!==params.expectedRevision)throw guidanceError(new Error('Workshop revision changed; reread before output'), 'guid-9b856d26d440814f');
      if(facilitation.waitingReason)throw guidanceError(new Error('Workshop is paused; resume explicitly before producing outputs'), 'guid-7cb2759f7e6a8513');
      if(note.frontmatter.phase!=='decide'||!facilitation.outputs.some(o=>o.type==='facilitation_synthesis'&&(o.round??1)===facilitation!.round))throw guidanceError(new Error('Record the reviewed synthesis before delegated outputs'), 'guid-fa56d90719ab44f6');
      const guards=combineManagedGuards(await validateWorkshopReferences(this.fileSystem,this.references,params.payload,path,principal),await validateWorkshopReferences(this.fileSystem,this.references,facilitation,path,principal));
      return this.outputService.execute(path,note,principal,params.payload,async()=>{await revalidateManagedActor(principal,params.revalidateActor);},guards);
    }
    if(operation==='delegate') {
      if(!facilitation||!this.outputService)throw guidanceError(new Error('Managed output adapter is unavailable'), 'guid-3c341f947b39bd1b');
      if(note.frontmatter.phase==='closed')throw guidanceError(new Error('Workshop is closed'), 'guid-fc9d85244755d976');
      if(note.revision!==params.expectedRevision)throw guidanceError(new Error('Workshop revision changed; reread before delegation'), 'guid-5d3d42ba1948f3bf');
      return this.outputService.delegate(path,note,principal,params.payload,async()=>{await revalidateManagedActor(principal,params.revalidateActor);},{requestKey,payloadHash});
    }
    if(note.frontmatter.phase==='closed')throw guidanceError(new Error('Workshop is closed; create a linked follow-up instead of silently reopening'), 'guid-d5821e340fa6458f');
    if (note.revision !== params.expectedRevision) throw guidanceError(new Error('The workshop changed; reread it before this facilitation mutation'), 'guid-fec09a7542d2d7e6');
    if (operation === 'submit') {
      if (!facilitation) throw guidanceError(new Error('Configure managed facilitation before submitting a managed step'), 'guid-081fd0d3ca94e84b');
      const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
      const kind = enumValue(params.kind, 'kind', WORKSHOP_CONTRIBUTION_KINDS, 'idea');
      return this.contributeWorkshop({ principal, workshopId, kind, content, references: params.references, expectedRevision: params.expectedRevision,
        stepId: text(params.stepId, 'stepId', 160, true), structured: params.structured, requestId, ...(params.revalidateActor ? { revalidateActor: params.revalidateActor } : {}) });
    }
    if (operation === 'configure') {
      if (facilitation) throw guidanceError(new Error('Managed facilitation is already configured; use a specific facilitation operation'), 'guid-e9768f08d12ed87c');
      facilitation = initialFacilitation((params.payload as Record<string, unknown> | undefined)?.facilitation);
      if (facilitation.facilitatorAccountId !== principal.accountId) throw guidanceError(new Error('facilitatorAccountId must be the current authenticated creator account'), 'guid-4180473c7046bfec');
      facilitation = await this.validateFacilitationSources(facilitation, principal, path);
    } else {
      if (!facilitation) throw guidanceError(new Error('This workshop has no managed facilitation configuration'), 'guid-5ddbf43a917253b4');
      const payload = params.payload === undefined ? {} : (params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload) ? params.payload as Record<string, unknown> : (() => { throw guidanceError(new Error('payload must be an object'), 'guid-a9a0abe502e369b4'); })());
      if (operation === 'redo') {
        if(note.frontmatter.workshop_output_pending)throw guidanceError(new Error('Recover the pending delegated output before re-discussion'), 'guid-105ff0d272117149');
        if(facilitation.ordinaryRedoCount>=1)throw guidanceError(new Error('Ordinary re-discussion is limited to once; create a linked follow-up'), 'guid-ccc7e82119331b41');
        if((note.frontmatter.workshop_outputs||[]).length)throw guidanceError(new Error('Existing delegated outputs require a linked follow-up, not silent re-discussion'), 'guid-249f1f28dec3ab81');
        const currentMethod=facilitation.methods.find(m=>m.steps.some(s=>s.id===facilitation!.currentStepId))!;
        facilitation={...facilitation,ordinaryRedoCount:1,round:facilitation.round+1,brainwritingCycle:1,currentStepId:currentMethod.steps[0]!.id,resumeCondition:text(payload.reason,'payload.reason',500,true)};
        delete facilitation.waitingReason;
      } else if(operation==='pause') {
        facilitation={...facilitation,waitingReason:text(payload.reason,'payload.reason',500,true),resumeCondition:text(payload.resumeCondition,'payload.resumeCondition',500,true)};
      } else if (operation === 'close') {
        if(note.frontmatter.workshop_output_pending)throw guidanceError(new Error('Recover the pending delegated output before closing'), 'guid-ad6d20f0c683f558');
        text(payload.reason,'payload.reason',500,true);
        if(payload.outcome!==undefined&&payload.outcome!=='unresolved')throw guidanceError(Error('Unknown workshop closure outcome'), 'guid-9a7684fd9935070d');
        if(!unresolvedClose) {
        const submissions=await this.managedWorkshopContributions(workshopId,facilitation,principal);
        if(submissions.incomplete||nextFacilitationAction(facilitation,submissions.rows.map(r=>r.submission)).kind!=='record_output')throw guidanceError(new Error('Finish the final method step before closing'), 'guid-36df650d7a327b54');
        if(!facilitation.outputs.some(o=>o.type==='facilitation_synthesis'&&(o.round??1)===facilitation!.round))throw guidanceError(new Error('Record synthesis with minority, uncertainty and revisit before closing'), 'guid-717fbe2450843a54');
        completionGuards.push(...submissions.rows.flatMap(row=>row.guards));
        }
      } else if (operation === 'advance') {
        const submissions = await this.managedWorkshopContributions(workshopId, facilitation, principal);
        if (submissions.incomplete) throw guidanceError(new Error('Managed contribution scan is incomplete; completion cannot be inferred'), 'guid-21786edd4fd81a7e');
        completionGuards.push(...submissions.rows.flatMap(row=>row.guards));
        const action = nextFacilitationAction(facilitation, submissions.rows.map(item => item.submission));
        if (action.kind !== 'advance') throw guidanceError(new Error(`Facilitation step is incomplete: ${action.resumeCondition || action.finishCondition}`), 'guid-8485b50cbfe43ffb');
        facilitation = advanceFacilitation(facilitation, text(payload.reason, 'payload.reason', 500, true),submissions.rows.map(r=>r.submission));
      } else if (operation === 'handoff') {
        const nextAccountId = text(payload.facilitatorAccountId, 'payload.facilitatorAccountId', 160, true);
        const participants = Array.from(new Set([...facilitation.participants, nextAccountId]));
        facilitation = { ...facilitation, facilitatorAccountId: nextAccountId, facilitatorGeneration: facilitation.facilitatorGeneration + 1, participants };
      } else if (operation === 'revoke') {
        const accountId = text(payload.accountId, 'payload.accountId', 160, true);
        if (accountId === facilitation.facilitatorAccountId) throw guidanceError(new Error('Hand off facilitation before revoking the current facilitator'), 'guid-6c9af6d729c1bbb7');
        const decisionAuthority = facilitation.decisionAuthority.delegatedAccountId === accountId
          ? (facilitation.decisionAuthority.approverAccountId ? { approverAccountId: facilitation.decisionAuthority.approverAccountId } : {})
          : facilitation.decisionAuthority;
        facilitation = { ...facilitation, participants: facilitation.participants.filter(item => item !== accountId),
          decisionAuthority };
      } else if (operation === 'resume') {
        facilitation = { ...facilitation, ...(payload.waitingReason === undefined ? {} : { waitingReason: text(payload.waitingReason, 'payload.waitingReason', 500, true) }),
          ...(payload.resumeCondition === undefined ? {} : { resumeCondition: text(payload.resumeCondition, 'payload.resumeCondition', 500, true) }) };
        if(payload.waitingReason===undefined)delete facilitation.waitingReason;
      } else if (operation === 'synthesize') {
        const submissions = await this.managedWorkshopContributions(workshopId, facilitation, principal);
        if (submissions.incomplete) throw guidanceError(new Error('Managed contribution scan is incomplete; completion cannot be inferred'), 'guid-21786edd4fd81a7e');
        completionGuards.push(...submissions.rows.flatMap(row=>row.guards));
        const action = nextFacilitationAction(facilitation, submissions.rows.map(item => item.submission));
        if (action.kind !== 'record_output') throw guidanceError(new Error(`Final facilitation step is incomplete: ${action.resumeCondition || action.finishCondition}`), 'guid-02e107d99abd703e');
        const synthesis = text(payload.synthesis, 'payload.synthesis', MAX_LONG_TEXT_CHARS, true);
        const structuredSynthesis = validateFacilitationSynthesis(payload.structured);
        for (const field of ['adopted', 'rejected', 'minority', 'uncertainty', 'revisit']) {
          if (!Object.hasOwn(structuredSynthesis, field) || typeof structuredSynthesis[field] === 'boolean') throw guidanceError(new Error(`Managed synthesis requires explicit typed ${field}`), 'guid-8a2c72e9ddfbacc2');
        }
        await validateWorkshopReferences(this.fileSystem, this.references, { structured: structuredSynthesis,
          ...(params.references === undefined ? {} : { references: params.references }), synthesis }, path, principal);
        const synthesisReferences = await this.references.validateAndNormalize(params.references, path, principal, `${synthesis}\n${JSON.stringify(structuredSynthesis)}`, { strictBodyLinks: true });
        if (facilitation.outputs.length >= 16) throw guidanceError(new Error('Managed facilitation has reached its bounded output limit'), 'guid-52987a16e92fe8d4');
        facilitation = { ...facilitation, outputs: [...facilitation.outputs, { type: 'facilitation_synthesis', round:facilitation.round, synthesis, structured: structuredSynthesis, references: synthesisReferences, status: 'proposed' }] };
      } else if (operation === 'record_output') {
        const output = payload.output;
        if (!output || typeof output !== 'object' || Array.isArray(output)) throw guidanceError(new Error('payload.output must be an object'), 'guid-379b1d004d36f6f6');
        const typed = output as Record<string, unknown>;
        const type = text(typed.type, 'payload.output.type', 80, true);
        if (!['decision_plan', 'work_task_plan', 'facilitation_receipt'].includes(type)) throw guidanceError(new Error('Output type must be decision_plan, work_task_plan, or facilitation_receipt; outputs never implement work'), 'guid-f94ce60d0b78f12a');
        if (typed.status !== undefined && typed.status !== 'proposed' && typed.status !== 'unverified') throw guidanceError(new Error('Managed output status must be proposed or unverified until an authorized output bridge verifies it'), 'guid-5a2530df511de8d6');
        await validateWorkshopReferences(this.fileSystem, this.references, typed, path, principal);
        if (facilitation.outputs.length >= 16) throw guidanceError(new Error('Managed facilitation has reached its bounded output limit'), 'guid-52987a16e92fe8d4');
        facilitation = { ...facilitation, outputs: [...facilitation.outputs, { ...typed, status: typed.status || 'unverified' }] };
      }
    }
    // Re-parse the whole persisted value before writing so direct-object
    // payloads cannot create a state that a later read will reject.
    facilitation = createFacilitation(facilitation);
    const result = { operation, currentStepId: facilitation.currentStepId, facilitatorAccountId: facilitation.facilitatorAccountId,
      ...(operation === 'record_output' ? { outputRecorded: true } : {}),
      ...(operation === 'synthesize' ? { synthesisStatus: 'proposed', decisionOutput: 'Use the recorded synthesis as input to wiki.decision_record; it is not an approval or implementation.' } : {}),
      ...(operation==='close'?{outcome:unresolvedClose?'unresolved':'completed'}:{nextAction: nextFacilitationAction(facilitation, [])}),
    };
    const nextReceipts = [...receipts, { request_key: requestKey, operation, payload_hash: payloadHash, result }].slice(-workshopFacilitationReceiptLimit);
    const synthesisOutput = operation === 'synthesize' ? facilitation.outputs.at(-1) : undefined;
    const content = replaceFacilitationBlock(note.content,previousBlock,managedFacilitationMarkdown(facilitation)) + (synthesisOutput ? `\n\n## Synthesis\n${String(synthesisOutput.synthesis || '')}\n` : '');
    const allGuards = [...(unresolvedClose?[]:await validateWorkshopReferences(this.fileSystem, this.references, facilitation, path, principal)),...completionGuards];
    const uniqueGuards = new Map<string,FacilitationGuard>();
    for(const guard of allGuards){const key=guard.path.toLowerCase();const prior=uniqueGuards.get(key);if(prior && prior.expectedRevision!==guard.expectedRevision)throw guidanceError(new Error('Completion evidence changed during validation'), 'guid-2e351c7ff8440b2c');uniqueGuards.set(key,guard);}
    const relatedGuards=[...uniqueGuards.values()].filter(guard=>guard.path!==path);
    if(relatedGuards.length>128)throw guidanceError(new Error('Completion exceeds 128 revision guards; narrow this step without discarding its evidence'), 'guid-3e02e5726049a214');
    await revalidateManagedActor(principal, params.revalidateActor);
    const write={ path, content, frontmatter: { ...note.frontmatter, facilitation,
      facilitator_account_id: facilitation.facilitatorAccountId, facilitator_generation: facilitation.facilitatorGeneration,
      facilitation_mutation_receipts: nextReceipts, ...(operation === 'synthesize' ? { synthesis_status: 'proposed', phase: 'decide', next_action: 'Review this bounded synthesis, then use wiki.decision_record or task generation through their normal authorization.' } : {}),
      ...(operation==='close'?{phase:'closed',status:'closed',facilitation_closed_at:now(),facilitation_close_outcome:unresolvedClose?'unresolved':'completed',facilitation_close_reason:(params.payload as Record<string,unknown>).reason,next_action:'Meeting closed; outputs do not authorize external execution.'}:{}), updated_at: now(), }, expectedRevision: params.expectedRevision };
    const policy={maxGuards:128,assertAccess:async()=>{await revalidateManagedActor(principal,params.revalidateActor);}};
    if(relatedGuards.length)await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write,relatedGuards,policy);
    else await this.fileSystem.writeNoteWithReceipt(write,policy);
    const updated = await this.fileSystem.readNote(path);
    return { success: true, workshopId, ...result, revision: updated.revision };
    });
  }

  async contributeWorkshop(params: { principal?: ScopePrincipal; workshopId: string; kind: string; content: string; ideaId?: string; references?: unknown; expectedPhase?: string; expectedRevision?: string; stepId?: string; structured?: unknown; requestId?: string; revalidateActor?: () => Promise<ScopePrincipal> }) {
    // Reuse the process-wide short Work coordinator across adapter instances.
    // No model work runs under it; revision locks remain the final write gate.
    return coordinate(async () => {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const kind = enumValue(params.kind, 'kind', WORKSHOP_CONTRIBUTION_KINDS, 'idea');
    const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
    const ideaId = params.ideaId ? normalizeScopeId(params.ideaId, 'ideaId') : undefined;
    const expectedPhase = params.expectedPhase ? enumValue(params.expectedPhase, 'expectedPhase', WORKSHOP_PHASES, 'diverge') : undefined;
    const request = preparePublicCreateRequest({
      principal, requestId: params.requestId, action: 'workshop.contribute', generatedPrefix: 'contrib',
      payload: { workshopId, kind, content, ideaId, expectedPhase, expectedRevision: params.expectedRevision, stepId: params.stepId, structured: params.structured, references: params.references },
    });
    const contributionId = request?.targetId || `contrib-${randomUUID().slice(0, 12)}`;
    const path = workshopContributionPath(workshopId, contributionId);
    let phase: WorkshopPhase = 'diverge';
    let facilitation: WorkshopFacilitation | undefined;
    let structured: Record<string, unknown> | undefined;
    let references: string[] = [];
    let guards: Array<{ path: string; expectedRevision: string }> = [];
    let managedReferenceGuards: Array<{ path: string; expectedRevision: string }> = [];
    return runPublicCreate({
      fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['respond', 'explore'],
      revalidate: async () => {
        const workshop = await this.readTyped(workshopPath(workshopId), 'workshop');
        if (workshop.frontmatter.status === 'closed' || workshop.frontmatter.phase === 'closed') throw guidanceError(new Error('This workshop is closed for contributions'), 'guid-b4fbc7565e078b37');
        phase = enumValue(workshop.frontmatter.phase, 'phase', WORKSHOP_PHASES, 'diverge');
        if (expectedPhase && expectedPhase !== phase) throw guidanceError(new Error(`Workshop phase changed to ${phase}; reread it before contributing`), 'guid-299d206bdb487317');
        facilitation = managedFacilitation(workshop);
        if (facilitation) {
          facilitation = await this.validateFacilitationSources(facilitation, principal, workshopPath(workshopId));
          if (!params.expectedRevision || params.expectedRevision !== workshop.revision) throw guidanceError(new Error('Managed facilitation contributions require the exact current workshop revision'), 'guid-6df5b3815eb78af4');
          if (!params.stepId) throw guidanceError(new Error('Managed facilitation contributions require stepId'), 'guid-bd26d0f701d1b0c6');
          const existing = await this.managedWorkshopContributions(workshopId, facilitation, principal,undefined,params.structured,path);
          if (existing.incomplete) throw guidanceError(new Error('Managed predecessor scan is incomplete; lineage or duplicate admission cannot be inferred'), 'guid-8bd1a107c4ff1831');
          structured = validateFacilitationSubmission(facilitation, {
            accountId: principal.accountId, stepId: params.stepId, workshopRevision: params.expectedRevision, structured: params.structured,
            existingSubmissions: existing.rows.map(item => item.submission),
          }).structured;
          managedReferenceGuards = combineManagedGuards(existing.rows.flatMap(row=>row.guards),await validateWorkshopReferences(this.fileSystem, this.references, {
            facilitation, structured, content, ...(params.references === undefined ? {} : { references: params.references }),
          }, path, principal));
        }
        guards = [{ path: workshopPath(workshopId), expectedRevision: workshop.revision }];
        if (ideaId) {
          const idea = await this.readTyped(ideaPath(ideaId), 'idea');
          guards.push({ path: ideaPath(ideaId), expectedRevision: idea.revision });
        }
        references = await this.references.validateAndNormalize(params.references, path, principal, `${content}\n${structured ? JSON.stringify(structured) : ''}`, { strictBodyLinks: facilitation !== undefined });
        return { parentPaths: guards.map(guard => guard.path) };
      },
      create: async participationGuard => {
        if (facilitation) await revalidateManagedActor(principal, params.revalidateActor);
        const body = `${content}\n`;
        const frontmatter = attachPublicCreateRequest(request, {
          mcpvault_type: 'workshop_contribution', contribution_id: contributionId, workshop_id: workshopId, phase, kind,
          ...(ideaId && { idea_id: ideaId }), author: identity(principal), account_id: principal.accountId,
          ...(facilitation && { facilitation_step_id: facilitation.currentStepId, facilitation_round:facilitation.round, workshop_revision: params.expectedRevision, structured }), references, created_at: now(),
        }, body);
        const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(
          { path, content: body, frontmatter, expectedRevision: 'missing' },
          combineManagedGuards(guards, managedReferenceGuards, participationGuard ? [participationGuard] : []),
          {maxGuards:128},
        );
        return { success: true as const, workshopId, contributionId, phase, kind, ...(facilitation && { stepId: facilitation.currentStepId }), path, revision: receipt.revision };
      },
      replay: note => {
        if (note.frontmatter.mcpvault_type !== 'workshop_contribution' || note.frontmatter.workshop_id !== workshopId || note.frontmatter.contribution_id !== contributionId) {
          throw guidanceError(new Error('Public request result is unavailable'), 'guid-503e43625954dd85');
        }
        const storedPhase = enumValue(note.frontmatter.phase, 'phase', WORKSHOP_PHASES, 'diverge');
        return { success: true as const, workshopId, contributionId, phase: storedPhase, kind, ...(note.frontmatter.facilitation_step_id && { stepId: note.frontmatter.facilitation_step_id }), path, revision: note.revision };
      },
    });
    });
  }

  async updateWorkshopPhase(params: { principal?: ScopePrincipal; workshopId: string; phase: string; reason: string; expectedRevision: string }) {
    const principal = requireLogin(params.principal);
    const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
    const phase = enumValue(params.phase, 'phase', WORKSHOP_PHASES, 'diverge');
    const reason = text(params.reason, 'reason', 500, true);
    const note = await this.readTyped(workshopPath(workshopId), 'workshop');
    if (managedFacilitation(note)) throw guidanceError(new Error('Managed workshops advance only through workshop.facilitation_update so required step contributions are checked'), 'guid-303d46eeb6fb9ab8');
    if (note.revision !== params.expectedRevision) throw guidanceError(new Error('The workshop changed; reread it before advancing the phase'), 'guid-0257c2cbbc62eb84');
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
    if (managedFacilitation(note)) throw guidanceError(new Error('Managed workshops record synthesis only through workshop.facilitation_update so the current facilitation gate cannot be bypassed'), 'guid-94d5465a09e6a105');
    if (note.revision !== params.expectedRevision) throw guidanceError(new Error('The workshop changed; reread it before recording synthesis'), 'guid-ae838b3c8ae442de');
    const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, workshopPath(workshopId), principal, synthesis);
    const title = titleFrom(note);
    const agenda = Array.isArray(note.frontmatter.agenda) ? note.frontmatter.agenda.map(String) : [];
    await this.fileSystem.writeNote({ path: workshopPath(workshopId), content: `${workshopBody({ title, prompt: String(note.frontmatter.prompt || ''), agenda, synthesis })}\n`, frontmatter: { ...note.frontmatter, references, synthesis_status: 'proposed', synthesis_by: identity(principal), synthesis_at: now(), phase: 'decide', updated_at: now(), next_action: 'Review the synthesis and create wiki.decision_record or an agent task.' }, expectedRevision: params.expectedRevision });
    const updated = await this.fileSystem.readNote(workshopPath(workshopId));
    return { success: true, workshopId, phase: 'decide', synthesisStatus: 'proposed', nextAction: 'Review the synthesis and create wiki.decision_record or an agent task.', revision: updated.revision };
  }
}
