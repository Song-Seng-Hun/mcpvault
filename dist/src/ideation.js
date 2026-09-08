import { createHash, randomUUID } from 'node:crypto';
import { normalizeScopeId } from './scopes.js';
import { boundItems } from './search-limits.js';
import { queryWindow } from './paged-query.js';
import { isModerationHidden } from './moderation-policy.js';
import { validateWorkshopReferences } from './workshop-reference-validation.js';
import { buildMarkdownLiteralMask } from './backlinks.js';
import { coordinate } from './work-model.js';
import { WorkshopOutputService } from './workshop-output.js';
import { workshopInputGuide } from './workshop-input-guide.js';
import { attachPublicCreateRequest, preparePublicCreateRequest, runPublicCreate } from './community-public-retry.js';
import { advanceFacilitation, createFacilitation, FACILITATION_METHODS, managedFacilitationMarkdown, nextFacilitationAction, validateFacilitationSubmission, validateFacilitationSynthesis, workshopLineagePrerequisites, } from './workshop-facilitation.js';
const IDEA_ROOT = 'Community/Ideas';
const WORKSHOP_ROOT = 'Community/Workshops';
/** Replace only the exact generated block, never an authored heading/suffix.
 * Ambiguous or externally edited blocks require explicit repair. */
function replaceFacilitationBlock(content, before, after) {
    if (!before)
        return `${content.trimEnd()}\n\n${after}\n`;
    const mask = buildMarkdownLiteralMask(content), matches = [];
    let offset = 0;
    while ((offset = content.indexOf(before, offset)) >= 0) {
        if (!mask[offset] && (offset === 0 || content[offset - 1] === '\n'))
            matches.push(offset);
        offset += before.length;
    }
    if (matches.length !== 1)
        throw new Error('Managed facilitation block changed or is ambiguous; repair it before updating');
    const start = matches[0];
    return content.slice(0, start) + after + content.slice(start + before.length);
}
const MAX_CONTRIBUTION_CHARS = 280;
const MAX_LONG_TEXT_CHARS = 4000;
const MAX_LIST_CHARS = 20000;
const MAX_MANAGED_CONTRIBUTION_SCAN = 128;
export const IDEA_STATUSES = ['seed', 'exploring', 'challenging', 'evaluating', 'selected', 'rejected', 'parked', 'implemented', 'promoted'];
export const IDEA_CONTRIBUTION_KINDS = ['extension', 'challenge', 'counterexample', 'evidence', 'question', 'synthesis', 'outcome'];
export const WORKSHOP_PHASES = ['diverge', 'cluster', 'critique', 'evaluate', 'synthesize', 'decide', 'closed'];
export const WORKSHOP_CONTRIBUTION_KINDS = ['idea', 'extension', 'challenge', 'counterexample', 'evaluation', 'synthesis', 'decision'];
export const IDEA_EVALUATION_FIELDS = ['novelty', 'usefulness', 'feasibility', 'risk', 'evidenceQuality'];
const now = () => new Date().toISOString();
const identity = (principal) => principal.agentId || principal.modelId;
const ideaPath = (ideaId) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}.md`;
const ideaContributionPath = (ideaId, contributionId) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;
const ideaEvaluationPath = (ideaId, evaluatorId) => `${IDEA_ROOT}/${normalizeScopeId(ideaId, 'ideaId')}/Evaluations/${normalizeScopeId(evaluatorId, 'evaluatorId')}.md`;
const workshopPath = (workshopId) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}.md`;
const workshopContributionPath = (workshopId, contributionId) => `${WORKSHOP_ROOT}/${normalizeScopeId(workshopId, 'workshopId')}/Contributions/${normalizeScopeId(contributionId, 'contributionId')}.md`;
const workshopFacilitationReceiptLimit = 16;
function hashPayload(value) {
    const ordered = (item) => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, ordered(child)]))
            : item;
    return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
function managedFacilitation(note) {
    if (note.frontmatter.facilitation === undefined)
        return undefined;
    try {
        return createFacilitation(note.frontmatter.facilitation);
    }
    catch (error) {
        throw new Error(`Managed facilitation configuration is malformed: ${error instanceof Error ? error.message : 'invalid value'}`);
    }
}
function initialFacilitation(value) {
    const state = createFacilitation(value);
    if (state.currentStepId !== state.methods[0].steps[0].id || state.round !== 1 || (state.brainwritingCycle ?? 1) !== 1 || state.facilitatorGeneration !== 0
        || state.ordinaryRedoCount !== 0 || state.outputs.length || state.checks.length)
        throw new Error('Initial facilitation must start at its first step without forged progress or outputs');
    return state;
}
function facilitationReceipts(note) {
    const value = note.frontmatter.facilitation_mutation_receipts;
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > workshopFacilitationReceiptLimit || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('Managed facilitation mutation receipts are malformed');
    }
    return value;
}
function requireFacilitator(principal, facilitation) {
    if (principal.accountId !== facilitation.facilitatorAccountId)
        throw new Error('Only the current authenticated facilitator account may manage this workshop');
}
async function revalidateManagedActor(principal, revalidateActor) {
    const current = revalidateActor ? await revalidateActor() : principal;
    if (current.accountId !== principal.accountId)
        throw new Error('Authenticated account changed before the managed facilitation mutation could be finalized');
    return current;
}
function facilitationCursor(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('cursor must be an object returned by read_workshop_facilitation');
    const cursor = value;
    const unknown = Object.keys(cursor).filter(key => !['path', 'value', 'missing'].includes(key));
    if (unknown.length || typeof cursor.path !== 'string' || !cursor.path.trim())
        throw new Error('cursor is malformed');
    if (cursor.value !== undefined && typeof cursor.value !== 'string' && typeof cursor.value !== 'number' && typeof cursor.value !== 'boolean' && cursor.value !== null)
        throw new Error('cursor.value is malformed');
    if (cursor.missing !== undefined && typeof cursor.missing !== 'boolean')
        throw new Error('cursor.missing is malformed');
    return { path: cursor.path, ...(cursor.value === undefined ? {} : { value: cursor.value }), ...(cursor.missing === undefined ? {} : { missing: cursor.missing }) };
}
function combineManagedGuards(...groups) {
    const guards = new Map();
    for (const guard of groups.flat()) {
        const key = guard.path.toLowerCase();
        const prior = guards.get(key);
        if (prior && prior.expectedRevision !== guard.expectedRevision)
            throw new Error('Managed workshop revision guards are inconsistent');
        guards.set(key, guard);
    }
    if (guards.size > 128)
        throw new Error('Managed workshop has too many related revision guards; reduce the step without dropping evidence');
    return [...guards.values()];
}
function text(value, field, maximum, required = false) {
    const result = String(value ?? '').trim();
    if (required && !result)
        throw new Error(`${field} is required`);
    if (Array.from(result).length > maximum)
        throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
    return result;
}
function list(value, field, maximum, itemMaximum = 500) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new Error(`${field} must be an array`);
    const result = value.map(item => text(item, field, itemMaximum, true));
    if (result.length > maximum)
        throw new Error(`${field} must contain at most ${maximum} items`);
    return Array.from(new Set(result));
}
function enumValue(value, field, allowed, fallback) {
    const result = String(value || fallback).trim().toLowerCase();
    if (!allowed.includes(result))
        throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
    return result;
}
function score(value, field) {
    const result = Number(value);
    if (!Number.isInteger(result) || result < 1 || result > 5)
        throw new Error(`${field} must be an integer from 1 to 5`);
    return result;
}
function requireLogin(principal) {
    if (!principal)
        throw new Error('Login is required for Idea Lab and Workshop mutations');
    return principal;
}
function titleFrom(note) {
    return String(note.frontmatter.title || note.path?.split('/').at(-1)?.replace(/\.md$/i, '') || note.path || 'untitled');
}
function ideaBody(params) {
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
function workshopBody(params) {
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
function boundedProjection(value, maxChars) {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars)
        return { value, truncated: false };
    const result = { ...value };
    for (const key of ['contributions', 'evaluations']) {
        if (Array.isArray(result[key]))
            result[key] = [];
    }
    return { value: result, truncated: true };
}
export class IdeationService {
    fileSystem;
    references;
    outputService;
    constructor(fileSystem, references) {
        this.fileSystem = fileSystem;
        this.references = references;
    }
    attachOutputAdapter(adapter) { this.outputService = new WorkshopOutputService(this.fileSystem, adapter); }
    async createIdea(params) {
        const principal = requireLogin(params.principal);
        const title = text(params.title, 'title', 180, true);
        const seed = text(params.seed, 'seed', MAX_LONG_TEXT_CHARS, true);
        const problem = text(params.problem, 'problem', MAX_LONG_TEXT_CHARS);
        const constraints = list(params.constraints, 'constraints', 12, 500);
        const successCriteria = list(params.successCriteria, 'successCriteria', 12, 500);
        if (params.expectedRevision && params.expectedRevision !== 'missing')
            throw new Error('A new idea must use expectedRevision=missing');
        const workshopId = params.workshopId ? normalizeScopeId(params.workshopId, 'workshopId') : undefined;
        const requestedIdeaId = params.ideaId ? normalizeScopeId(params.ideaId, 'ideaId') : undefined;
        const request = preparePublicCreateRequest({
            principal, requestId: params.requestId, action: 'idea.create', generatedPrefix: 'idea',
            ...(requestedIdeaId && { requestedTargetId: requestedIdeaId }),
            payload: { ideaId: requestedIdeaId, title, seed, problem, constraints, successCriteria, workshopId, references: params.references },
        });
        const ideaId = request?.targetId || requestedIdeaId || `idea-${randomUUID().slice(0, 12)}`;
        const path = ideaPath(ideaId);
        let references = [];
        let guards = [];
        return runPublicCreate({
            fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['initiate'], topicMetadata: { title },
            revalidate: async () => {
                guards = [];
                if (workshopId) {
                    const workshop = await this.readTyped(workshopPath(workshopId), 'workshop');
                    if (workshop.frontmatter.status === 'closed' || workshop.frontmatter.phase === 'closed')
                        throw new Error('This workshop is closed');
                    guards.push({ path: workshopPath(workshopId), expectedRevision: workshop.revision });
                }
                references = await this.references.validateAndNormalize(params.references, path, principal, seed);
                return { parentPaths: guards.map(guard => guard.path) };
            },
            create: async (participationGuard) => {
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
                return { success: true, ideaId, path, status: 'seed', revision: receipt.revision };
            },
            replay: note => {
                if (note.frontmatter.mcpvault_type !== 'idea' || note.frontmatter.idea_id !== ideaId)
                    throw new Error('Public request result is unavailable');
                return { success: true, ideaId, path, status: 'seed', revision: note.revision };
            },
        });
    }
    async readTyped(path, type) {
        const note = await this.fileSystem.readNote(path);
        if (note.frontmatter.mcpvault_type !== type)
            throw new Error(`Expected ${type} at ${path}`);
        if (isModerationHidden(note.frontmatter) || note.frontmatter.content_status === 'deleted')
            throw new Error(`${type} is unavailable`);
        return note;
    }
    async listIdeas(params) {
        const filters = { mcpvault_type: 'idea' };
        if (params.status)
            filters.status = enumValue(params.status, 'status', IDEA_STATUSES, 'exploring');
        if (params.workshopId)
            filters.workshop_id = normalizeScopeId(params.workshopId, 'workshopId');
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
    async readIdea(params) {
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
    async branchIdea(params) {
        const principal = requireLogin(params.principal);
        if (!params.expectedParentRevision)
            throw new Error('expectedParentRevision is required; read the parent idea first');
        const parentId = normalizeScopeId(params.parentIdeaId, 'parentIdeaId');
        const parent = await this.readTyped(ideaPath(parentId), 'idea');
        if (parent.revision !== params.expectedParentRevision)
            throw new Error('The parent idea changed; reread it before branching');
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
    async updateIdeaStatus(params) {
        const principal = requireLogin(params.principal);
        const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
        const status = enumValue(params.status, 'status', IDEA_STATUSES, 'exploring');
        const reason = text(params.reason, 'reason', 500, true);
        const note = await this.readTyped(ideaPath(ideaId), 'idea');
        if (note.revision !== params.expectedRevision)
            throw new Error('The idea changed; reread it before changing status');
        const timestamp = now();
        await this.fileSystem.writeNote({
            path: ideaPath(ideaId), content: note.content,
            frontmatter: { ...note.frontmatter, status, status_reason: reason, status_changed_by: identity(principal), status_changed_at: timestamp, updated_at: timestamp },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(ideaPath(ideaId));
        return { success: true, ideaId, status, reason, revision: updated.revision };
    }
    async contributeIdea(params) {
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
        let references = [];
        let guards = [];
        return runPublicCreate({
            fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['respond', 'explore'],
            revalidate: async () => {
                const idea = await this.readTyped(ideaPath(ideaId), 'idea');
                if (['rejected', 'promoted'].includes(String(idea.frontmatter.status)))
                    throw new Error('This idea is closed for new contributions');
                guards = [{ path: ideaPath(ideaId), expectedRevision: idea.revision }];
                if (replyTo) {
                    const parentPath = ideaContributionPath(ideaId, replyTo);
                    const parent = await this.readTyped(parentPath, 'idea_contribution');
                    if (parent.frontmatter.idea_id !== ideaId)
                        throw new Error('Reply target is unavailable');
                    guards.push({ path: parentPath, expectedRevision: parent.revision });
                }
                references = await this.references.validateAndNormalize(params.references, path, principal, content);
                return { parentPaths: guards.map(guard => guard.path) };
            },
            create: async (participationGuard) => {
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
                return { success: true, ideaId, contributionId, kind, path, revision: receipt.revision };
            },
            replay: note => {
                if (note.frontmatter.mcpvault_type !== 'idea_contribution' || note.frontmatter.idea_id !== ideaId || note.frontmatter.contribution_id !== contributionId) {
                    throw new Error('Public request result is unavailable');
                }
                return { success: true, ideaId, contributionId, kind, path, revision: note.revision };
            },
        });
    }
    async evaluateIdea(params) {
        const principal = requireLogin(params.principal);
        const ideaId = normalizeScopeId(params.ideaId, 'ideaId');
        await this.readTyped(ideaPath(ideaId), 'idea');
        const evaluator = normalizeScopeId(identity(principal), 'evaluatorId');
        const path = ideaEvaluationPath(ideaId, evaluator);
        const exists = await this.fileSystem.noteExists(path);
        const current = exists ? await this.readTyped(path, 'idea_evaluation') : undefined;
        const expectedRevision = params.expectedRevision || (exists ? '' : 'missing');
        if (!expectedRevision)
            throw new Error('expectedRevision is required when updating an existing evaluation');
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
    async createWorkshop(params) {
        const principal = requireLogin(params.principal);
        const title = text(params.title, 'title', 180, true);
        const prompt = text(params.prompt, 'prompt', MAX_LONG_TEXT_CHARS, true);
        const agenda = list(params.agenda, 'agenda', 12, 500);
        const ideaIds = list(params.ideaIds, 'ideaIds', 20, 64).map(value => normalizeScopeId(value, 'ideaId'));
        const timeboxMinutes = params.timeboxMinutes === undefined ? undefined : Math.min(Math.max(Number(params.timeboxMinutes), 1), 10080);
        if (timeboxMinutes !== undefined && !Number.isInteger(timeboxMinutes))
            throw new Error('timeboxMinutes must be an integer');
        const maxContributionsPerAgent = params.maxContributionsPerAgent === undefined ? 3 : Math.min(Math.max(Number(params.maxContributionsPerAgent), 1), 20);
        if (!Number.isInteger(maxContributionsPerAgent))
            throw new Error('maxContributionsPerAgent must be an integer');
        const requestedWorkshopId = params.workshopId ? normalizeScopeId(params.workshopId, 'workshopId') : undefined;
        const reservedResearchId = requestedWorkshopId ? /^research-[a-f0-9]{48}$/.test(requestedWorkshopId) : false;
        if (reservedResearchId && !params.researchWork)
            throw new Error('A reserved research workshop requires its current researchWork claim');
        if (params.researchWork && !reservedResearchId)
            throw new Error('researchWork is available only for an exact reserved research workshop id');
        const researchWork = params.researchWork ? {
            taskId: normalizeScopeId(params.researchWork.taskId, 'researchWork.taskId'),
            expectedRevision: String(params.researchWork.expectedRevision || '').trim().toLowerCase(),
            expectedGeneration: Number(params.researchWork.expectedGeneration),
        } : undefined;
        if (researchWork && (researchWork.taskId !== requestedWorkshopId || !/^[a-f0-9]{64}$/.test(researchWork.expectedRevision)
            || !Number.isSafeInteger(researchWork.expectedGeneration) || researchWork.expectedGeneration < 0)) {
            throw new Error('researchWork must identify the matching task, current revision, and non-negative claim generation');
        }
        const request = preparePublicCreateRequest({
            principal, requestId: params.requestId, action: 'workshop.create', generatedPrefix: 'workshop',
            ...(requestedWorkshopId && { requestedTargetId: requestedWorkshopId }),
            payload: { workshopId: requestedWorkshopId, title, prompt, agenda, ideaIds, timeboxMinutes, maxContributionsPerAgent, references: params.references, researchWork, facilitation: params.facilitation },
        });
        const workshopId = request?.targetId || requestedWorkshopId || `workshop-${randomUUID().slice(0, 12)}`;
        const path = workshopPath(workshopId);
        let references = [];
        let guards = [];
        let facilitation = params.facilitation === undefined ? undefined : initialFacilitation(params.facilitation);
        if (facilitation && facilitation.facilitatorAccountId !== principal.accountId)
            throw new Error('facilitation.facilitatorAccountId must be the authenticated creator account');
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
                        throw new Error('Research task claim changed; refresh the work packet before creating or replaying this workshop');
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
            create: async (participationGuard) => {
                if (facilitation)
                    await revalidateManagedActor(principal, params.revalidateActor);
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
                return { success: true, workshopId, path, phase: 'diverge', revision: receipt.revision };
            },
            replay: note => {
                if (note.frontmatter.mcpvault_type !== 'workshop' || note.frontmatter.workshop_id !== workshopId)
                    throw new Error('Public request result is unavailable');
                return { success: true, workshopId, path, phase: 'diverge', revision: note.revision };
            },
        });
    }
    async listWorkshops(params) {
        const filters = { mcpvault_type: 'workshop' };
        if (params.phase)
            filters.phase = enumValue(params.phase, 'phase', WORKSHOP_PHASES, 'diverge');
        if (params.status)
            filters.status = params.status === 'closed' ? 'closed' : 'open';
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
    async readWorkshop(params) {
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
    getWorkshopMethods(params = {}) {
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
        const methodId = params.methodId === undefined ? undefined : String(params.methodId).trim();
        const selected = methodId === undefined ? undefined : FACILITATION_METHODS.find(method => method.methodId === methodId);
        if (methodId !== undefined && !selected)
            throw new Error('methodId is not a supported managed facilitation method');
        if (params.stepId !== undefined) {
            const step = selected?.steps.find(s => s.id === params.stepId);
            if (!step)
                throw new Error('stepId must belong to the selected methodId');
            const response = { methodId: selected.methodId, stepId: step.id, required: step.required, finishCondition: step.finishCondition, ...workshopInputGuide(step.id), truncated: false };
            if (Array.from(JSON.stringify(response)).length > maxChars)
                throw new Error('Increase maxChars for the complete input guide (maximum 12000)');
            return response;
        }
        const start = selected || params.cursor === undefined ? 0 : Number(params.cursor);
        if (!Number.isSafeInteger(start) || start < 0 || start >= FACILITATION_METHODS.length)
            throw new Error('cursor must be a valid list_workshop_methods continuation');
        const source = selected ? [selected] : FACILITATION_METHODS.slice(start);
        const methods = source.map(method => ({ methodId: method.methodId, version: method.version, title: method.title,
            adaptation: method.adaptation, steps: method.steps.map(step => ({ id: step.id, title: step.title, required: step.required,
                finishCondition: step.finishCondition, adaptation: step.adaptation, inputAction: { endpointId: 'workshop.methods', arguments: { methodId: method.methodId, stepId: step.id } }, ...(step.minimumAccounts ? { minimumAccounts: step.minimumAccounts } : {}) })) }));
        const bounded = boundItems(methods, maxChars - 240);
        if (!selected && bounded.items.length === 0) {
            if (maxChars >= 12000)
                throw new Error('A method cannot fit the maximum catalog budget; request an exact methodId');
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
    async validateFacilitationSources(facilitation, principal, containerPath) {
        const sourceGuards = await validateWorkshopReferences(this.fileSystem, this.references, { sourceRevisions: facilitation.sourceRevisions }, containerPath, principal);
        if (sourceGuards.length !== facilitation.sourceRevisions.length)
            throw new Error('Managed facilitation sources are unavailable or changed');
        await validateWorkshopReferences(this.fileSystem, this.references, facilitation, containerPath, principal);
        return facilitation;
    }
    /** Re-open every contribution before it affects a managed workflow. Raw
     * query rows are advisory: deleted, hidden, cross-scope, malformed, stale,
     * revoked, duplicate-ballot, and wrong-workshop rows never reach a count or
     * page cursor. */
    async managedWorkshopContributions(workshopId, facilitation, principal, after, incoming, excludePath) {
        const configuredSteps = new Map(facilitation.methods.flatMap(method => method.steps).map(step => [step.id, step]));
        const currentIndex = [...configuredSteps.keys()].indexOf(facilitation.currentStepId);
        const eligible = (item) => item.path !== excludePath && item.frontmatter.workshop_id === workshopId && !isModerationHidden(item.frontmatter)
            && item.frontmatter.content_status !== 'deleted' && facilitation.participants.includes(item.frontmatter.account_id)
            && (item.frontmatter.facilitation_round ?? 1) === facilitation.round;
        const required = new Set([facilitation.currentStepId]);
        const cycling = facilitation.currentStepId === 'brainwriting-build' && (facilitation.brainwritingCycle ?? 1) > 1;
        const currentCycle = (fm) => !cycling || fm.structured?.cycle === facilitation.brainwritingCycle;
        for (const step of required)
            for (const dependency of workshopLineagePrerequisites(step))
                if (configuredSteps.has(dependency) && [...configuredSteps.keys()].indexOf(dependency) <= currentIndex)
                    required.add(dependency);
        const queried = await this.fileSystem.queryNotes({
            pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' },
            sortBy: 'created_at', sortOrder: 'asc', limit: MAX_MANAGED_CONTRIBUTION_SCAN, ...(after ? { after } : {}), includeContent: false, includeTotal: true,
        }, () => true, item => eligible(item) && item.frontmatter.facilitation_step_id === facilitation.currentStepId && currentCycle(item.frontmatter));
        let incomplete = queried.truncated;
        const candidates = [...queried.notes];
        const ideaFilter = !cycling && (facilitation.currentStepId === 'brainwriting-build' || facilitation.currentStepId.startsWith('scamper-'));
        const wanted = new Set();
        const collectIds = (value) => { for (const id of Array.isArray(value?.parentIdeaIds) ? value.parentIdeaIds : [])
            if (typeof id === 'string')
                wanted.add(id); for (const idea of Array.isArray(value?.ideaIds) ? value.ideaIds : [])
            for (const id of [idea?.ideaId, idea?.parentIdeaId])
                if (typeof id === 'string')
                    wanted.add(id); };
        if (cycling) {
            const previous = await this.fileSystem.queryNotes({ pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' }, sortBy: 'created_at', sortOrder: 'asc', limit: 128, includeContent: false, includeTotal: true }, () => true, item => eligible(item) && item.frontmatter.facilitation_step_id === 'brainwriting-build' && Number(item.frontmatter.structured?.cycle) < facilitation.brainwritingCycle);
            incomplete ||= previous.truncated;
            candidates.push(...previous.notes);
        }
        for (const row of candidates)
            collectIds(row.frontmatter.structured);
        collectIds(incoming);
        // Read only prerequisite stages; old unrelated transcript pages cannot
        // starve current-step admission. Parent lookups use exact referenced IDs.
        for (const step of [...required].reverse()) {
            if (step === facilitation.currentStepId)
                continue;
            const prior = await this.fileSystem.queryNotes({ pathPrefix: `${WORKSHOP_ROOT}/${workshopId}/Contributions`, filters: { mcpvault_type: 'workshop_contribution' }, sortBy: 'created_at', sortOrder: 'asc', limit: 128, includeContent: false, includeTotal: true }, () => true, item => eligible(item) && item.frontmatter.facilitation_step_id === step && (!ideaFilter || (Array.isArray(item.frontmatter.structured?.ideaIds) && item.frontmatter.structured.ideaIds.some((i) => wanted.has(i.ideaId)))));
            incomplete ||= prior.truncated;
            candidates.push(...prior.notes);
            for (const row of prior.notes)
                collectIds(row.frontmatter.structured);
            if (candidates.length > 256) {
                incomplete = true;
                break;
            }
        }
        candidates.sort((a, b) => [...configuredSteps.keys()].indexOf(a.frontmatter.facilitation_step_id) - [...configuredSteps.keys()].indexOf(b.frontmatter.facilitation_step_id)
            || (cycling ? Number(a.frontmatter.structured?.cycle ?? 1) - Number(b.frontmatter.structured?.cycle ?? 1) : 0)
            || String(a.frontmatter.created_at || '').localeCompare(String(b.frontmatter.created_at || '')) || a.path.localeCompare(b.path));
        const accepted = [];
        for (const source of facilitation.sourceRevisions) {
            const seedId = `source-${hashPayload(source.path).slice(0, 16)}`;
            accepted.push({ note: { path: source.path, revision: source.revision, frontmatter: {} }, submission: { accountId: facilitation.facilitatorAccountId, stepId: 'source-origin', structured: { ideaIds: [{ ideaId: seedId, origin: 'Pinned public source' }] } }, guards: [{ path: source.path, expectedRevision: source.revision }] });
        }
        for (const candidate of candidates.slice(0, 256)) {
            try {
                const note = await this.fileSystem.readNote(candidate.path);
                if (note.frontmatter.mcpvault_type !== 'workshop_contribution' || note.frontmatter.workshop_id !== workshopId
                    || isModerationHidden(note.frontmatter) || note.frontmatter.content_status === 'deleted')
                    continue;
                const accountId = typeof note.frontmatter.account_id === 'string' ? note.frontmatter.account_id : '';
                const stepId = typeof note.frontmatter.facilitation_step_id === 'string' ? note.frontmatter.facilitation_step_id : '';
                const workshopRevision = typeof note.frontmatter.workshop_revision === 'string' ? note.frontmatter.workshop_revision : '';
                const structured = note.frontmatter.structured;
                if (!eligible({ path: candidate.path, frontmatter: note.frontmatter }) || !stepId || !structured || typeof structured !== 'object' || Array.isArray(structured))
                    continue;
                const stepIndex = [...configuredSteps.keys()].indexOf(stepId);
                if (stepIndex < 0 || stepIndex > currentIndex)
                    continue;
                const guards = await validateWorkshopReferences(this.fileSystem, this.references, { structured,
                    ...(note.frontmatter.references === undefined ? {} : { references: note.frontmatter.references }) }, candidate.path, principal);
                const validation = validateFacilitationSubmission({ ...facilitation, currentStepId: stepId, ...(cycling ? { brainwritingCycle: Number(structured.cycle ?? 1) } : {}) }, {
                    accountId, stepId, workshopRevision, structured,
                    existingSubmissions: accepted.map(item => item.submission),
                });
                accepted.push({ note: { path: candidate.path, frontmatter: note.frontmatter, revision: note.revision }, submission: { accountId, stepId, structured: validation.structured }, guards: [...guards, { path: candidate.path, expectedRevision: note.revision }] });
            }
            catch {
                // A malformed or no-longer-visible public contribution cannot block or
                // impersonate a current participant. It is excluded before pagination.
            }
        }
        return { rows: accepted, incomplete };
    }
    facilitationCursorOffset(rows, cursor) {
        if (!cursor)
            return 0;
        const index = rows.findIndex(row => row.note.path === cursor.path
            && (cursor.missing === true ? row.note.frontmatter.created_at === undefined : cursor.value === row.note.frontmatter.created_at));
        if (index < 0)
            throw new Error('cursor no longer identifies an emitted managed contribution');
        return index + 1;
    }
    async readWorkshopFacilitation(params) {
        const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
        const note = await this.readTyped(workshopPath(workshopId), 'workshop');
        let facilitation = managedFacilitation(note);
        if (!facilitation)
            return { workshopId, managed: false, revision: note.revision, nextAction: { kind: 'legacy', message: 'This legacy workshop uses phase-based contributions.' } };
        const limit = Math.min(Math.max(Number(params.limit ?? 12), 1), 50);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 6000), 512), 12000);
        const after = params.cursor === undefined ? undefined : facilitationCursor(params.cursor);
        try {
            facilitation = await this.validateFacilitationSources(facilitation, params.principal, workshopPath(workshopId));
        }
        catch {
            return { workshopId, managed: true, revision: note.revision, blocked: true, facilitation: { version: facilitation.version, currentStepId: facilitation.currentStepId, round: facilitation.round }, submissions: [], submissionTotal: 0, nextAction: { kind: 'blocked', stepId: facilitation.currentStepId, message: 'Managed sources are unavailable or changed; refresh authorized sources before continuing.' }, truncated: false };
        }
        const aggregate = await this.managedWorkshopContributions(workshopId, facilitation, params.principal);
        // Pagination is a view over a complete bounded current-step admission scan,
        // so a continuation cannot forget frozen alternatives or count duplicates.
        const page = aggregate;
        const rows = page.rows.filter(row => row.submission.stepId === facilitation.currentStepId && ((facilitation.brainwritingCycle ?? 1) <= 1 || row.submission.structured.cycle === facilitation.brainwritingCycle));
        const offset = this.facilitationCursorOffset(rows, after);
        const candidates = rows.slice(offset, offset + limit);
        const action = note.frontmatter.phase === 'closed' ? { kind: 'closed', message: 'Meeting closed. Review linked outputs; no execution permission is granted.' } : aggregate.incomplete
            ? { kind: 'blocked', stepId: facilitation.currentStepId, required: ['complete managed contribution scan'], finishCondition: 'A bounded scan must cover every eligible current-step contribution before completion is assessed.', adaptation: 'Read a narrower current source window or resolve the workshop backlog; no completion is inferred.' }
            : nextFacilitationAction(facilitation, aggregate.rows.map(row => row.submission));
        const project = (row) => ({ contributionId: row.note.frontmatter.contribution_id, accountId: row.submission.accountId,
            stepId: row.submission.stepId, structured: row.submission.structured, createdAt: row.note.frontmatter.created_at });
        const currentStep = facilitation.methods.flatMap(method => method.steps).find(step => step.id === facilitation.currentStepId);
        const sourcePins = facilitation.sourceRevisions.slice(0, 2);
        const publicFacilitation = { version: facilitation.version, purpose: facilitation.purpose, scope: facilitation.scope,
            successCriteria: facilitation.successCriteria, currentStepId: facilitation.currentStepId, round: facilitation.round,
            ...(facilitation.brainwritingCycle && { brainwritingCycle: facilitation.brainwritingCycle, cycleInstruction: '6-3-5: six actual accounts each submit three extensions of peers from the previous cycle; variant 6-3-5, cycle equals brainwritingCycle, cycleMinutes 5. Declared timing is not verified attendance.' }),
            facilitatorAccountId: facilitation.facilitatorAccountId, currentStep: { title: currentStep.title, required: currentStep.required,
                finishCondition: currentStep.finishCondition, adaptation: currentStep.adaptation, input: workshopInputGuide(currentStep.id, params.principal?.accountId, sourcePins[0]) }, sourcePins,
            sourceOrigins: sourcePins.map(source => ({ path: source.path, ideaId: `source-${hashPayload(source.path).slice(0, 16)}`, revision: source.revision })),
            sourcePinsTruncated: facilitation.sourceRevisions.length > sourcePins.length,
            ...(facilitation.sourceRevisions.length > sourcePins.length ? { sourceDetailAction: { endpointId: 'notes.read', arguments: { path: workshopPath(workshopId), expectedRevision: note.revision, maxChars: 4000 } } } : {}) };
        const outputAuthority = 'not_execution_authority';
        const responseFor = (items) => {
            const more = offset + items.length < rows.length || page.incomplete;
            const last = items.at(-1)?.note;
            const cursor = more && last ? { path: last.path,
                ...(last.frontmatter.created_at === undefined ? { missing: true } : { value: last.frontmatter.created_at }) } : undefined;
            return { workshopId, managed: true, revision: note.revision, facilitation: publicFacilitation, outputAuthority, nextAction: action,
                submissions: items.map(project), submissionTotal: rows.length,
                ...(note.frontmatter.workshop_output_pending && { pendingOutput: { state: 'pending', guidance: 'Reread the same reserved output ID and payload to recover. If no output exists, the current facilitator may use cancel_output with outputId and reason; no created output is deleted.', nextAction: { endpointId: 'notes.read', arguments: { path: workshopPath(workshopId), expectedRevision: note.revision, maxChars: 4000 } } } }),
                completionUnknown: aggregate.incomplete, ...(cursor ? { cursor } : {}), truncated: more };
        };
        let emitted = candidates;
        while (emitted.length && Array.from(JSON.stringify(responseFor(emitted))).length > maxChars)
            emitted = emitted.slice(0, -1);
        const response = responseFor(emitted);
        if (Array.from(JSON.stringify(response)).length > maxChars || (candidates.length > 0 && emitted.length === 0)) {
            throw new Error('maxChars is too small for required context and one contribution; increase it (maximum 12000). Cursor was not advanced.');
        }
        return response;
    }
    async updateWorkshopFacilitation(params) {
        return coordinate(async () => {
            const principal = requireLogin(params.principal);
            const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
            const requestId = text(params.requestId, 'requestId', 128, true);
            const operation = enumValue(params.operation, 'operation', ['configure', 'submit', 'advance', 'handoff', 'revoke', 'pause', 'resume', 'redo', 'synthesize', 'record_output', 'delegate', 'execute_output', 'cancel_output', 'close'], 'configure');
            const path = workshopPath(workshopId);
            const note = await this.readTyped(path, 'workshop');
            const payloadHash = hashPayload({ operation, payload: params.payload, stepId: params.stepId, structured: params.structured, content: params.content, kind: params.kind, references: params.references });
            const requestKey = hashPayload({ accountId: principal.accountId, requestId });
            const owner = String(note.frontmatter.facilitator_account_id || '');
            let facilitation = managedFacilitation(note);
            const previousBlock = facilitation ? managedFacilitationMarkdown(facilitation) : undefined;
            const completionGuards = [];
            if (facilitation) {
                if (operation !== 'cancel_output')
                    facilitation = await this.validateFacilitationSources(facilitation, principal, path);
                if (operation === 'submit') {
                    if (!facilitation.participants.includes(principal.accountId))
                        throw new Error('Only an explicitly configured participant account may submit to managed facilitation');
                }
                else if (operation !== 'execute_output') {
                    requireFacilitator(principal, facilitation);
                }
            }
            else if (operation === 'configure') {
                if (!owner)
                    throw new Error('This legacy workshop has no account-bound facilitator and cannot be converted to managed facilitation');
                if (principal.accountId !== owner)
                    throw new Error('Only the creator account may configure managed facilitation');
            }
            const receipts = facilitationReceipts(note);
            const prior = receipts.find(receipt => receipt.request_key === requestKey);
            if (prior) {
                if (prior.operation !== operation || prior.payload_hash !== payloadHash)
                    throw new Error('requestId was already used for a different facilitation mutation or payload');
                await revalidateManagedActor(principal, params.revalidateActor);
                return { success: true, workshopId, replayed: true, ...(prior.result && typeof prior.result === 'object' && !Array.isArray(prior.result) ? prior.result : {}), revision: note.revision };
            }
            if (operation === 'cancel_output') {
                if (!facilitation || !this.outputService)
                    throw new Error('Managed output adapter is unavailable');
                if (note.revision !== params.expectedRevision)
                    throw new Error('Workshop revision changed; reread before cancellation');
                return this.outputService.cancel(path, note, principal, params.payload, async () => { await revalidateManagedActor(principal, params.revalidateActor); }, { requestKey, payloadHash });
            }
            if (operation === 'execute_output') {
                if (!facilitation || !this.outputService)
                    throw new Error('Managed output adapter is unavailable');
                if (note.revision !== params.expectedRevision)
                    throw new Error('Workshop revision changed; reread before output');
                if (facilitation.waitingReason)
                    throw new Error('Workshop is paused; resume explicitly before producing outputs');
                if (note.frontmatter.phase !== 'decide' || !facilitation.outputs.some(o => o.type === 'facilitation_synthesis' && (o.round ?? 1) === facilitation.round))
                    throw new Error('Record the reviewed synthesis before delegated outputs');
                const guards = combineManagedGuards(await validateWorkshopReferences(this.fileSystem, this.references, params.payload, path, principal), await validateWorkshopReferences(this.fileSystem, this.references, facilitation, path, principal));
                return this.outputService.execute(path, note, principal, params.payload, async () => { await revalidateManagedActor(principal, params.revalidateActor); }, guards);
            }
            if (operation === 'delegate') {
                if (!facilitation || !this.outputService)
                    throw new Error('Managed output adapter is unavailable');
                if (note.frontmatter.phase === 'closed')
                    throw new Error('Workshop is closed');
                if (note.revision !== params.expectedRevision)
                    throw new Error('Workshop revision changed; reread before delegation');
                return this.outputService.delegate(path, note, principal, params.payload, async () => { await revalidateManagedActor(principal, params.revalidateActor); }, { requestKey, payloadHash });
            }
            if (note.frontmatter.phase === 'closed')
                throw new Error('Workshop is closed; create a linked follow-up instead of silently reopening');
            if (note.revision !== params.expectedRevision)
                throw new Error('The workshop changed; reread it before this facilitation mutation');
            if (operation === 'submit') {
                if (!facilitation)
                    throw new Error('Configure managed facilitation before submitting a managed step');
                const content = text(params.content, 'content', MAX_CONTRIBUTION_CHARS, true);
                const kind = enumValue(params.kind, 'kind', WORKSHOP_CONTRIBUTION_KINDS, 'idea');
                return this.contributeWorkshop({ principal, workshopId, kind, content, references: params.references, expectedRevision: params.expectedRevision,
                    stepId: text(params.stepId, 'stepId', 160, true), structured: params.structured, requestId, ...(params.revalidateActor ? { revalidateActor: params.revalidateActor } : {}) });
            }
            if (operation === 'configure') {
                if (facilitation)
                    throw new Error('Managed facilitation is already configured; use a specific facilitation operation');
                facilitation = initialFacilitation(params.payload?.facilitation);
                if (facilitation.facilitatorAccountId !== principal.accountId)
                    throw new Error('facilitatorAccountId must be the current authenticated creator account');
                facilitation = await this.validateFacilitationSources(facilitation, principal, path);
            }
            else {
                if (!facilitation)
                    throw new Error('This workshop has no managed facilitation configuration');
                const payload = params.payload === undefined ? {} : (params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload) ? params.payload : (() => { throw new Error('payload must be an object'); })());
                if (operation === 'redo') {
                    if (note.frontmatter.workshop_output_pending)
                        throw new Error('Recover the pending delegated output before re-discussion');
                    if (facilitation.ordinaryRedoCount >= 1)
                        throw new Error('Ordinary re-discussion is limited to once; create a linked follow-up');
                    if ((note.frontmatter.workshop_outputs || []).length)
                        throw new Error('Existing delegated outputs require a linked follow-up, not silent re-discussion');
                    const currentMethod = facilitation.methods.find(m => m.steps.some(s => s.id === facilitation.currentStepId));
                    facilitation = { ...facilitation, ordinaryRedoCount: 1, round: facilitation.round + 1, brainwritingCycle: 1, currentStepId: currentMethod.steps[0].id, resumeCondition: text(payload.reason, 'payload.reason', 500, true) };
                    delete facilitation.waitingReason;
                }
                else if (operation === 'pause') {
                    facilitation = { ...facilitation, waitingReason: text(payload.reason, 'payload.reason', 500, true), resumeCondition: text(payload.resumeCondition, 'payload.resumeCondition', 500, true) };
                }
                else if (operation === 'close') {
                    if (note.frontmatter.workshop_output_pending)
                        throw new Error('Recover the pending delegated output before closing');
                    const submissions = await this.managedWorkshopContributions(workshopId, facilitation, principal);
                    if (submissions.incomplete || nextFacilitationAction(facilitation, submissions.rows.map(r => r.submission)).kind !== 'record_output')
                        throw new Error('Finish the final method step before closing');
                    if (!facilitation.outputs.some(o => o.type === 'facilitation_synthesis' && (o.round ?? 1) === facilitation.round))
                        throw new Error('Record synthesis with minority, uncertainty and revisit before closing');
                    text(payload.reason, 'payload.reason', 500, true);
                    completionGuards.push(...submissions.rows.flatMap(row => row.guards));
                }
                else if (operation === 'advance') {
                    const submissions = await this.managedWorkshopContributions(workshopId, facilitation, principal);
                    if (submissions.incomplete)
                        throw new Error('Managed contribution scan is incomplete; completion cannot be inferred');
                    completionGuards.push(...submissions.rows.flatMap(row => row.guards));
                    const action = nextFacilitationAction(facilitation, submissions.rows.map(item => item.submission));
                    if (action.kind !== 'advance')
                        throw new Error(`Facilitation step is incomplete: ${action.resumeCondition || action.finishCondition}`);
                    facilitation = advanceFacilitation(facilitation, text(payload.reason, 'payload.reason', 500, true), submissions.rows.map(r => r.submission));
                }
                else if (operation === 'handoff') {
                    const nextAccountId = text(payload.facilitatorAccountId, 'payload.facilitatorAccountId', 160, true);
                    const participants = Array.from(new Set([...facilitation.participants, nextAccountId]));
                    facilitation = { ...facilitation, facilitatorAccountId: nextAccountId, facilitatorGeneration: facilitation.facilitatorGeneration + 1, participants };
                }
                else if (operation === 'revoke') {
                    const accountId = text(payload.accountId, 'payload.accountId', 160, true);
                    if (accountId === facilitation.facilitatorAccountId)
                        throw new Error('Hand off facilitation before revoking the current facilitator');
                    const decisionAuthority = facilitation.decisionAuthority.delegatedAccountId === accountId
                        ? (facilitation.decisionAuthority.approverAccountId ? { approverAccountId: facilitation.decisionAuthority.approverAccountId } : {})
                        : facilitation.decisionAuthority;
                    facilitation = { ...facilitation, participants: facilitation.participants.filter(item => item !== accountId),
                        decisionAuthority };
                }
                else if (operation === 'resume') {
                    facilitation = { ...facilitation, ...(payload.waitingReason === undefined ? {} : { waitingReason: text(payload.waitingReason, 'payload.waitingReason', 500, true) }),
                        ...(payload.resumeCondition === undefined ? {} : { resumeCondition: text(payload.resumeCondition, 'payload.resumeCondition', 500, true) }) };
                    if (payload.waitingReason === undefined)
                        delete facilitation.waitingReason;
                }
                else if (operation === 'synthesize') {
                    const submissions = await this.managedWorkshopContributions(workshopId, facilitation, principal);
                    if (submissions.incomplete)
                        throw new Error('Managed contribution scan is incomplete; completion cannot be inferred');
                    completionGuards.push(...submissions.rows.flatMap(row => row.guards));
                    const action = nextFacilitationAction(facilitation, submissions.rows.map(item => item.submission));
                    if (action.kind !== 'record_output')
                        throw new Error(`Final facilitation step is incomplete: ${action.resumeCondition || action.finishCondition}`);
                    const synthesis = text(payload.synthesis, 'payload.synthesis', MAX_LONG_TEXT_CHARS, true);
                    const structuredSynthesis = validateFacilitationSynthesis(payload.structured);
                    for (const field of ['adopted', 'rejected', 'minority', 'uncertainty', 'revisit']) {
                        if (!Object.hasOwn(structuredSynthesis, field) || typeof structuredSynthesis[field] === 'boolean')
                            throw new Error(`Managed synthesis requires explicit typed ${field}`);
                    }
                    await validateWorkshopReferences(this.fileSystem, this.references, { structured: structuredSynthesis,
                        ...(params.references === undefined ? {} : { references: params.references }), synthesis }, path, principal);
                    const synthesisReferences = await this.references.validateAndNormalize(params.references, path, principal, `${synthesis}\n${JSON.stringify(structuredSynthesis)}`, { strictBodyLinks: true });
                    if (facilitation.outputs.length >= 16)
                        throw new Error('Managed facilitation has reached its bounded output limit');
                    facilitation = { ...facilitation, outputs: [...facilitation.outputs, { type: 'facilitation_synthesis', round: facilitation.round, synthesis, structured: structuredSynthesis, references: synthesisReferences, status: 'proposed' }] };
                }
                else if (operation === 'record_output') {
                    const output = payload.output;
                    if (!output || typeof output !== 'object' || Array.isArray(output))
                        throw new Error('payload.output must be an object');
                    const typed = output;
                    const type = text(typed.type, 'payload.output.type', 80, true);
                    if (!['decision_plan', 'work_task_plan', 'facilitation_receipt'].includes(type))
                        throw new Error('Output type must be decision_plan, work_task_plan, or facilitation_receipt; outputs never implement work');
                    if (typed.status !== undefined && typed.status !== 'proposed' && typed.status !== 'unverified')
                        throw new Error('Managed output status must be proposed or unverified until an authorized output bridge verifies it');
                    await validateWorkshopReferences(this.fileSystem, this.references, typed, path, principal);
                    if (facilitation.outputs.length >= 16)
                        throw new Error('Managed facilitation has reached its bounded output limit');
                    facilitation = { ...facilitation, outputs: [...facilitation.outputs, { ...typed, status: typed.status || 'unverified' }] };
                }
            }
            // Re-parse the whole persisted value before writing so direct-object
            // payloads cannot create a state that a later read will reject.
            facilitation = createFacilitation(facilitation);
            const result = { operation, currentStepId: facilitation.currentStepId, facilitatorAccountId: facilitation.facilitatorAccountId,
                ...(operation === 'record_output' ? { outputRecorded: true } : {}),
                ...(operation === 'synthesize' ? { synthesisStatus: 'proposed', decisionOutput: 'Use the recorded synthesis as input to wiki.decision_record; it is not an approval or implementation.' } : {}),
                nextAction: nextFacilitationAction(facilitation, []),
            };
            const nextReceipts = [...receipts, { request_key: requestKey, operation, payload_hash: payloadHash, result }].slice(-workshopFacilitationReceiptLimit);
            const synthesisOutput = operation === 'synthesize' ? facilitation.outputs.at(-1) : undefined;
            const content = replaceFacilitationBlock(note.content, previousBlock, managedFacilitationMarkdown(facilitation)) + (synthesisOutput ? `\n\n## Synthesis\n${String(synthesisOutput.synthesis || '')}\n` : '');
            const allGuards = [...await validateWorkshopReferences(this.fileSystem, this.references, facilitation, path, principal), ...completionGuards];
            const uniqueGuards = new Map();
            for (const guard of allGuards) {
                const key = guard.path.toLowerCase();
                const prior = uniqueGuards.get(key);
                if (prior && prior.expectedRevision !== guard.expectedRevision)
                    throw new Error('Completion evidence changed during validation');
                uniqueGuards.set(key, guard);
            }
            const relatedGuards = [...uniqueGuards.values()].filter(guard => guard.path !== path);
            if (relatedGuards.length > 128)
                throw new Error('Completion exceeds 128 revision guards; narrow this step without discarding its evidence');
            await revalidateManagedActor(principal, params.revalidateActor);
            await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt({ path, content, frontmatter: { ...note.frontmatter, facilitation,
                    facilitator_account_id: facilitation.facilitatorAccountId, facilitator_generation: facilitation.facilitatorGeneration,
                    facilitation_mutation_receipts: nextReceipts, ...(operation === 'synthesize' ? { synthesis_status: 'proposed', phase: 'decide', next_action: 'Review this bounded synthesis, then use wiki.decision_record or task generation through their normal authorization.' } : {}),
                    ...(operation === 'close' ? { phase: 'closed', status: 'closed', facilitation_closed_at: now(), next_action: 'Meeting closed; outputs do not authorize external execution.' } : {}), updated_at: now(), }, expectedRevision: params.expectedRevision }, relatedGuards, { maxGuards: 128 });
            const updated = await this.fileSystem.readNote(path);
            return { success: true, workshopId, ...result, revision: updated.revision };
        });
    }
    async contributeWorkshop(params) {
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
            let phase = 'diverge';
            let facilitation;
            let structured;
            let references = [];
            let guards = [];
            let managedReferenceGuards = [];
            return runPublicCreate({
                fileSystem: this.fileSystem, principal, request, targetPath: path, participationActions: ['respond', 'explore'],
                revalidate: async () => {
                    const workshop = await this.readTyped(workshopPath(workshopId), 'workshop');
                    if (workshop.frontmatter.status === 'closed' || workshop.frontmatter.phase === 'closed')
                        throw new Error('This workshop is closed for contributions');
                    phase = enumValue(workshop.frontmatter.phase, 'phase', WORKSHOP_PHASES, 'diverge');
                    if (expectedPhase && expectedPhase !== phase)
                        throw new Error(`Workshop phase changed to ${phase}; reread it before contributing`);
                    facilitation = managedFacilitation(workshop);
                    if (facilitation) {
                        facilitation = await this.validateFacilitationSources(facilitation, principal, workshopPath(workshopId));
                        if (!params.expectedRevision || params.expectedRevision !== workshop.revision)
                            throw new Error('Managed facilitation contributions require the exact current workshop revision');
                        if (!params.stepId)
                            throw new Error('Managed facilitation contributions require stepId');
                        const existing = await this.managedWorkshopContributions(workshopId, facilitation, principal, undefined, params.structured, path);
                        if (existing.incomplete)
                            throw new Error('Managed predecessor scan is incomplete; lineage or duplicate admission cannot be inferred');
                        structured = validateFacilitationSubmission(facilitation, {
                            accountId: principal.accountId, stepId: params.stepId, workshopRevision: params.expectedRevision, structured: params.structured,
                            existingSubmissions: existing.rows.map(item => item.submission),
                        }).structured;
                        managedReferenceGuards = combineManagedGuards(existing.rows.flatMap(row => row.guards), await validateWorkshopReferences(this.fileSystem, this.references, {
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
                create: async (participationGuard) => {
                    if (facilitation)
                        await revalidateManagedActor(principal, params.revalidateActor);
                    const body = `${content}\n`;
                    const frontmatter = attachPublicCreateRequest(request, {
                        mcpvault_type: 'workshop_contribution', contribution_id: contributionId, workshop_id: workshopId, phase, kind,
                        ...(ideaId && { idea_id: ideaId }), author: identity(principal), account_id: principal.accountId,
                        ...(facilitation && { facilitation_step_id: facilitation.currentStepId, facilitation_round: facilitation.round, workshop_revision: params.expectedRevision, structured }), references, created_at: now(),
                    }, body);
                    const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt({ path, content: body, frontmatter, expectedRevision: 'missing' }, combineManagedGuards(guards, managedReferenceGuards, participationGuard ? [participationGuard] : []), { maxGuards: 128 });
                    return { success: true, workshopId, contributionId, phase, kind, ...(facilitation && { stepId: facilitation.currentStepId }), path, revision: receipt.revision };
                },
                replay: note => {
                    if (note.frontmatter.mcpvault_type !== 'workshop_contribution' || note.frontmatter.workshop_id !== workshopId || note.frontmatter.contribution_id !== contributionId) {
                        throw new Error('Public request result is unavailable');
                    }
                    const storedPhase = enumValue(note.frontmatter.phase, 'phase', WORKSHOP_PHASES, 'diverge');
                    return { success: true, workshopId, contributionId, phase: storedPhase, kind, ...(note.frontmatter.facilitation_step_id && { stepId: note.frontmatter.facilitation_step_id }), path, revision: note.revision };
                },
            });
        });
    }
    async updateWorkshopPhase(params) {
        const principal = requireLogin(params.principal);
        const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
        const phase = enumValue(params.phase, 'phase', WORKSHOP_PHASES, 'diverge');
        const reason = text(params.reason, 'reason', 500, true);
        const note = await this.readTyped(workshopPath(workshopId), 'workshop');
        if (managedFacilitation(note))
            throw new Error('Managed workshops advance only through workshop.facilitation_update so required step contributions are checked');
        if (note.revision !== params.expectedRevision)
            throw new Error('The workshop changed; reread it before advancing the phase');
        const status = phase === 'closed' ? 'closed' : 'open';
        const timestamp = now();
        await this.fileSystem.writeNote({ path: workshopPath(workshopId), content: note.content, frontmatter: { ...note.frontmatter, phase, status, phase_reason: reason, phase_changed_by: identity(principal), phase_changed_at: timestamp, updated_at: timestamp }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(workshopPath(workshopId));
        return { success: true, workshopId, phase, status, reason, revision: updated.revision };
    }
    async synthesizeWorkshop(params) {
        const principal = requireLogin(params.principal);
        const workshopId = normalizeScopeId(params.workshopId, 'workshopId');
        const synthesis = text(params.synthesis, 'synthesis', MAX_LONG_TEXT_CHARS, true);
        const note = await this.readTyped(workshopPath(workshopId), 'workshop');
        if (managedFacilitation(note))
            throw new Error('Managed workshops record synthesis only through workshop.facilitation_update so the current facilitation gate cannot be bypassed');
        if (note.revision !== params.expectedRevision)
            throw new Error('The workshop changed; reread it before recording synthesis');
        const references = await this.references.validateAndNormalize(params.references ?? note.frontmatter.references, workshopPath(workshopId), principal, synthesis);
        const title = titleFrom(note);
        const agenda = Array.isArray(note.frontmatter.agenda) ? note.frontmatter.agenda.map(String) : [];
        await this.fileSystem.writeNote({ path: workshopPath(workshopId), content: `${workshopBody({ title, prompt: String(note.frontmatter.prompt || ''), agenda, synthesis })}\n`, frontmatter: { ...note.frontmatter, references, synthesis_status: 'proposed', synthesis_by: identity(principal), synthesis_at: now(), phase: 'decide', updated_at: now(), next_action: 'Review the synthesis and create wiki.decision_record or an agent task.' }, expectedRevision: params.expectedRevision });
        const updated = await this.fileSystem.readNote(workshopPath(workshopId));
        return { success: true, workshopId, phase: 'decide', synthesisStatus: 'proposed', nextAction: 'Review the synthesis and create wiki.decision_record or an agent task.', revision: updated.revision };
    }
}
