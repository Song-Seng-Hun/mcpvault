import { createHash } from 'node:crypto';

/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export const NOTE_KINDS = ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'] as const;
export const LIFECYCLES = ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'] as const;
export const TASK_STATUSES = ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'] as const;
export const REVIEW_POLICIES = ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit'] as const;
export const REVIEW_OUTCOMES = ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'] as const;
export const QUESTION_STATUSES = ['open', 'answered', 'blocked', 'abandoned'] as const;
export const HYPOTHESIS_STATUSES = ['proposed', 'supported', 'refuted', 'inconclusive'] as const;
export const ASSUMPTION_STATUSES = ['active', 'verified', 'invalidated', 'replaced'] as const;
export const KNOWLEDGE_POLARITIES = ['positive', 'negative'] as const;
export const NEGATIVE_KINDS = ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'] as const;
/** GTD horizons from concrete action up to purpose; these are optional focus metadata. */
export const FOCUS_HORIZONS = ['ground', 'project', 'area', 'goal', 'vision', 'purpose'] as const;
/** GTD clarification outcomes. These are workflow metadata, not deletion commands. */
export const CLARIFY_DISPOSITIONS = ['knowledge', 'reference', 'project', 'someday', 'discard', 'delegate'] as const;
/** Typed relationships are navigation metadata, never an access grant. */
export const RELATION_FIELDS = ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'related'] as const;
export const ORGANIZATION_LIST_FIELDS = ['aliases', 'key_points', 'open_questions', 'next_actions', 'project_support', ...RELATION_FIELDS] as const;

export type NoteKind = typeof NOTE_KINDS[number];
export type Lifecycle = typeof LIFECYCLES[number];

const noteKindSet = new Set<string>(NOTE_KINDS);
const lifecycleSet = new Set<string>(LIFECYCLES);
const taskStatusSet = new Set<string>(TASK_STATUSES);
const reviewPolicySet = new Set<string>(REVIEW_POLICIES);
const reviewOutcomeSet = new Set<string>(REVIEW_OUTCOMES);
const questionStatusSet = new Set<string>(QUESTION_STATUSES);
const hypothesisStatusSet = new Set<string>(HYPOTHESIS_STATUSES);
const assumptionStatusSet = new Set<string>(ASSUMPTION_STATUSES);
const knowledgePolaritySet = new Set<string>(KNOWLEDGE_POLARITIES);
const negativeKindSet = new Set<string>(NEGATIVE_KINDS);
const clarifyDispositionSet = new Set<string>(CLARIFY_DISPOSITIONS);
const relationFieldSet = new Set<string>(RELATION_FIELDS);
const focusHorizonSet = new Set<string>(FOCUS_HORIZONS);

function normalizedList(value: unknown, field: string, maximumItems: number, maximumChars: number): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  const result = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${field}[${index}] must be a non-empty string`);
    const text = item.trim();
    if (Array.from(text).length > maximumChars) throw new Error(`${field}[${index}] must be ${maximumChars} Unicode characters or fewer`);
    return text;
  });
  return Array.from(new Set(result)).slice(0, maximumItems);
}

function normalizedRelationMap(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('relations must be an object of typed link arrays');
  const result: Record<string, string[]> = {};
  for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!relationFieldSet.has(field)) throw new Error(`Unsupported relation field: ${field}`);
    const normalized = normalizedList(raw, field, 30, 500);
    if (normalized?.length) result[field] = normalized;
  }
  return result;
}

export function normalizeTaskStatus(value: unknown, fallback?: typeof TASK_STATUSES[number]): typeof TASK_STATUSES[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!taskStatusSet.has(normalized)) throw new Error(`taskStatus must be one of: ${TASK_STATUSES.join(', ')}`);
  return normalized as typeof TASK_STATUSES[number];
}

export function normalizeReviewPolicy(value: unknown, fallback?: typeof REVIEW_POLICIES[number]): typeof REVIEW_POLICIES[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!reviewPolicySet.has(normalized)) throw new Error(`reviewPolicy must be one of: ${REVIEW_POLICIES.join(', ')}`);
  return normalized as typeof REVIEW_POLICIES[number];
}

export function normalizeReviewOutcome(value: unknown, fallback?: typeof REVIEW_OUTCOMES[number]): typeof REVIEW_OUTCOMES[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!reviewOutcomeSet.has(normalized)) throw new Error(`reviewOutcome must be one of: ${REVIEW_OUTCOMES.join(', ')}`);
  return normalized as typeof REVIEW_OUTCOMES[number];
}

export function normalizeEpistemicStatus(value: unknown, noteKind: NoteKind, fallback?: string): string | undefined {
  const supplied = value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim().toLowerCase();
  if (!supplied) return undefined;
  const allowed = noteKind === 'question' ? questionStatusSet : noteKind === 'hypothesis' ? hypothesisStatusSet : noteKind === 'assumption' ? assumptionStatusSet : undefined;
  if (!allowed) throw new Error('epistemicStatus is only valid for noteKind question, hypothesis, or assumption');
  if (!allowed.has(supplied)) {
    const choices = noteKind === 'question' ? QUESTION_STATUSES : noteKind === 'hypothesis' ? HYPOTHESIS_STATUSES : ASSUMPTION_STATUSES;
    throw new Error(`epistemicStatus for ${noteKind} must be one of: ${choices.join(', ')}`);
  }
  return supplied;
}

export function normalizeKnowledgePolarity(value: unknown, fallback?: typeof KNOWLEDGE_POLARITIES[number]): typeof KNOWLEDGE_POLARITIES[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!knowledgePolaritySet.has(normalized)) throw new Error(`polarity must be one of: ${KNOWLEDGE_POLARITIES.join(', ')}`);
  return normalized as typeof KNOWLEDGE_POLARITIES[number];
}

export function normalizeNegativeKind(value: unknown, fallback?: typeof NEGATIVE_KINDS[number]): typeof NEGATIVE_KINDS[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!negativeKindSet.has(normalized)) throw new Error(`negativeType must be one of: ${NEGATIVE_KINDS.join(', ')}`);
  return normalized as typeof NEGATIVE_KINDS[number];
}

export function normalizeClarifyDisposition(value: unknown, fallback?: typeof CLARIFY_DISPOSITIONS[number]): typeof CLARIFY_DISPOSITIONS[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!clarifyDispositionSet.has(normalized)) throw new Error(`disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}`);
  return normalized as typeof CLARIFY_DISPOSITIONS[number];
}

export function normalizeNoteKind(value: unknown, fallback?: NoteKind): NoteKind | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!noteKindSet.has(normalized)) throw new Error(`noteKind must be one of: ${NOTE_KINDS.join(', ')}`);
  return normalized as NoteKind;
}

export function normalizeLifecycle(value: unknown, fallback?: Lifecycle): Lifecycle | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!lifecycleSet.has(normalized)) throw new Error(`lifecycle must be one of: ${LIFECYCLES.join(', ')}`);
  return normalized as Lifecycle;
}

export function normalizeFocusHorizon(value: unknown, fallback?: typeof FOCUS_HORIZONS[number]): typeof FOCUS_HORIZONS[number] | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!focusHorizonSet.has(normalized)) throw new Error(`focusHorizon must be one of: ${FOCUS_HORIZONS.join(', ')}`);
  return normalized as typeof FOCUS_HORIZONS[number];
}

interface SummaryHighlight {
  text: string;
  startLine?: number;
  endLine?: number;
  quoteHash?: string;
}

function normalizedHighlights(value: unknown, field: string): SummaryHighlight[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of highlight objects`);
  const result = value.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${field}[${index}] must be an object`);
    const raw = item as Record<string, unknown>;
    const text = optionalText(raw.text, `${field}[${index}].text`, 600);
    if (!text) throw new Error(`${field}[${index}].text is required`);
    const startLine = raw.startLine === undefined ? undefined : Number(raw.startLine);
    const endLine = raw.endLine === undefined ? undefined : Number(raw.endLine);
    if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1)) throw new Error(`${field}[${index}].startLine must be a positive integer`);
    if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1)) throw new Error(`${field}[${index}].endLine must be a positive integer`);
    if (startLine !== undefined && endLine !== undefined && endLine < startLine) throw new Error(`${field}[${index}].endLine must be greater than or equal to startLine`);
    const quoteHash = raw.quoteHash === undefined ? undefined : optionalText(raw.quoteHash, `${field}[${index}].quoteHash`, 128);
    if (quoteHash && !/^[a-f0-9]{64}$/i.test(quoteHash)) throw new Error(`${field}[${index}].quoteHash must be a SHA-256 hexadecimal digest`);
    return { text, ...(startLine !== undefined && { startLine }), ...(endLine !== undefined && { endLine }), ...(quoteHash && { quoteHash }) };
  });
  return result.length ? result : undefined;
}

export function lifecycleForKnowledgeStatus(status: string): Lifecycle {
  switch (status.trim().toLowerCase()) {
    case 'verified': return 'evergreen';
    case 'superseded': return 'superseded';
    case 'disputed': return 'review';
    default: return 'review';
  }
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const text = String(value).trim();
  if (Array.from(text).length > maximum) throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
  return text;
}

export function normalizeReviewAt(value: unknown): string | undefined {
  const date = optionalText(value, 'reviewAt', 40);
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error('reviewAt must be an ISO date or date-time');
  }
  return date;
}

export function normalizeIsoDate(value: unknown, field: string): string | undefined {
  const date = optionalText(value, field, 40);
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`${field} must be an ISO date or date-time`);
  return date;
}

export interface KnowledgeOrganizationInput {
  existing?: Record<string, any>;
  noteKind?: unknown;
  lifecycle?: unknown;
  moc?: unknown;
  project?: unknown;
  reviewAt?: unknown;
  status: string;
  aliases?: unknown;
  summary?: unknown;
  keyPoints?: unknown;
  openQuestions?: unknown;
  summaryLayer?: unknown;
  summaryHighlights?: unknown;
  nextActions?: unknown;
  nextAction?: unknown;
  waitingFor?: unknown;
  desiredOutcome?: unknown;
  projectPurpose?: unknown;
  projectSupport?: unknown;
  taskContext?: unknown;
  dueAt?: unknown;
  scheduledAt?: unknown;
  deferUntil?: unknown;
  stableId?: unknown;
  relations?: unknown;
  taskStatus?: unknown;
  reviewPolicy?: unknown;
  reviewOutcome?: unknown;
  reviewedBy?: unknown;
  reviewedAt?: unknown;
  reviewNote?: unknown;
  epistemicStatus?: unknown;
  polarity?: unknown;
  negativeType?: unknown;
  attempted?: unknown;
  observed?: unknown;
  failureCondition?: unknown;
  affectedScope?: unknown;
  reproduction?: unknown;
  whyRejected?: unknown;
  reusableLesson?: unknown;
  replacementPath?: unknown;
  clarifyDisposition?: unknown;
  clarifiedBy?: unknown;
  clarifiedAt?: unknown;
  clarifyNote?: unknown;
  triageTarget?: unknown;
  mocPurpose?: unknown;
  mocScope?: unknown;
  mocQuestions?: unknown;
  mocParent?: unknown;
  focusHorizon?: unknown;
  focusParent?: unknown;
  focusSupports?: unknown;
  contentDigest?: unknown;
}

export function knowledgeOrganization(input: KnowledgeOrganizationInput): Record<string, unknown> {
  const existing = input.existing || {};
  const existingKind = normalizeNoteKind(existing.note_kind);
  const existingLifecycle = normalizeLifecycle(existing.lifecycle);
  const kind = normalizeNoteKind(input.noteKind, existingKind || 'knowledge') || 'knowledge';
  const lifecycle = normalizeLifecycle(input.lifecycle, existingLifecycle || lifecycleForKnowledgeStatus(input.status)) || lifecycleForKnowledgeStatus(input.status);
  const moc = input.moc === undefined ? optionalText(existing.moc, 'moc', 500) : optionalText(input.moc, 'moc', 500);
  const project = input.project === undefined ? optionalText(existing.project, 'project', 500) : optionalText(input.project, 'project', 500);
  const reviewAt = input.reviewAt === undefined ? normalizeReviewAt(existing.review_at) : normalizeReviewAt(input.reviewAt);
  const aliases = input.aliases === undefined ? normalizedList(existing.aliases, 'aliases', 30, 200) : normalizedList(input.aliases, 'aliases', 30, 200);
  const summary = input.summary === undefined ? optionalText(existing.summary, 'summary', 2000) : optionalText(input.summary, 'summary', 2000);
  const keyPoints = input.keyPoints === undefined ? normalizedList(existing.key_points, 'key_points', 20, 600) : normalizedList(input.keyPoints, 'key_points', 20, 600);
  const openQuestions = input.openQuestions === undefined ? normalizedList(existing.open_questions, 'open_questions', 20, 600) : normalizedList(input.openQuestions, 'open_questions', 20, 600);
  const summaryLayer = input.summaryLayer === undefined
    ? (existing.summary_layer === undefined ? undefined : Number(existing.summary_layer))
    : Number(input.summaryLayer);
  if (summaryLayer !== undefined && (!Number.isInteger(summaryLayer) || summaryLayer < 0 || summaryLayer > 4)) throw new Error('summaryLayer must be an integer from 0 to 4');
  const summaryHighlights = input.summaryHighlights === undefined ? normalizedHighlights(existing.summary_highlights, 'summaryHighlights') : normalizedHighlights(input.summaryHighlights, 'summaryHighlights');
  const nextActions = input.nextActions === undefined ? normalizedList(existing.next_actions, 'next_actions', 20, 600) : normalizedList(input.nextActions, 'next_actions', 20, 600);
  const nextAction = input.nextAction === undefined ? optionalText(existing.next_action, 'nextAction', 500) : optionalText(input.nextAction, 'nextAction', 500);
  const waitingFor = input.waitingFor === undefined ? optionalText(existing.waiting_for, 'waiting_for', 500) : optionalText(input.waitingFor, 'waiting_for', 500);
  const desiredOutcome = input.desiredOutcome === undefined ? optionalText(existing.desired_outcome, 'desiredOutcome', 1000) : optionalText(input.desiredOutcome, 'desiredOutcome', 1000);
  const projectPurpose = input.projectPurpose === undefined ? optionalText(existing.project_purpose, 'projectPurpose', 1000) : optionalText(input.projectPurpose, 'projectPurpose', 1000);
  const projectSupport = input.projectSupport === undefined ? normalizedList(existing.project_support, 'projectSupport', 30, 500) : normalizedList(input.projectSupport, 'projectSupport', 30, 500);
  const taskContext = input.taskContext === undefined ? optionalText(existing.task_context, 'taskContext', 300) : optionalText(input.taskContext, 'taskContext', 300);
  const dueAt = input.dueAt === undefined ? normalizeIsoDate(existing.due_at, 'dueAt') : normalizeIsoDate(input.dueAt, 'dueAt');
  const scheduledAt = input.scheduledAt === undefined ? normalizeIsoDate(existing.scheduled_at, 'scheduledAt') : normalizeIsoDate(input.scheduledAt, 'scheduledAt');
  const deferUntil = input.deferUntil === undefined ? normalizeIsoDate(existing.defer_until, 'deferUntil') : normalizeIsoDate(input.deferUntil, 'deferUntil');
  const stableId = input.stableId === undefined ? optionalText(existing.stable_id, 'stable_id', 80) : optionalText(input.stableId, 'stable_id', 80);
  if (stableId && !/^[a-z0-9][a-z0-9._-]*$/i.test(stableId)) throw new Error('stableId may contain only letters, numbers, dots, underscores, and hyphens');
  const relationsInput = input.relations === undefined
    ? Object.fromEntries(RELATION_FIELDS.map(field => [field, existing[field]]).filter(([, value]) => value !== undefined))
    : input.relations;
  const relations = normalizedRelationMap(relationsInput);
  const taskStatus = input.taskStatus === undefined
    ? normalizeTaskStatus(existing.task_status)
    : normalizeTaskStatus(input.taskStatus);
  const reviewPolicy = input.reviewPolicy === undefined
    ? normalizeReviewPolicy(existing.review_policy)
    : normalizeReviewPolicy(input.reviewPolicy);
  const reviewOutcome = input.reviewOutcome === undefined ? normalizeReviewOutcome(existing.last_review_outcome) : normalizeReviewOutcome(input.reviewOutcome);
  const reviewedBy = input.reviewedBy === undefined ? optionalText(existing.last_reviewed_by, 'reviewedBy', 200) : optionalText(input.reviewedBy, 'reviewedBy', 200);
  const reviewedAt = input.reviewedAt === undefined ? normalizeIsoDate(existing.last_reviewed_at, 'reviewedAt') : normalizeIsoDate(input.reviewedAt, 'reviewedAt');
  const reviewNote = input.reviewNote === undefined ? optionalText(existing.review_note, 'reviewNote', 1000) : optionalText(input.reviewNote, 'reviewNote', 1000);
  const epistemicStatus = normalizeEpistemicStatus(input.epistemicStatus, kind, existing.epistemic_status);
  const polarity = input.polarity === undefined
    ? normalizeKnowledgePolarity(existing.knowledge_polarity)
    : normalizeKnowledgePolarity(input.polarity);
  const negativeType = input.negativeType === undefined
    ? normalizeNegativeKind(existing.negative_type)
    : normalizeNegativeKind(input.negativeType);
  const attempted = input.attempted === undefined ? optionalText(existing.negative_attempted, 'attempted', 1200) : optionalText(input.attempted, 'attempted', 1200);
  const observed = input.observed === undefined ? optionalText(existing.negative_observed, 'observed', 1200) : optionalText(input.observed, 'observed', 1200);
  const failureCondition = input.failureCondition === undefined ? optionalText(existing.negative_failure_condition, 'failureCondition', 1200) : optionalText(input.failureCondition, 'failureCondition', 1200);
  const affectedScope = input.affectedScope === undefined ? optionalText(existing.negative_affected_scope, 'affectedScope', 500) : optionalText(input.affectedScope, 'affectedScope', 500);
  const reproduction = input.reproduction === undefined ? optionalText(existing.negative_reproduction, 'reproduction', 1200) : optionalText(input.reproduction, 'reproduction', 1200);
  const whyRejected = input.whyRejected === undefined ? optionalText(existing.negative_why_rejected, 'whyRejected', 1200) : optionalText(input.whyRejected, 'whyRejected', 1200);
  const reusableLesson = input.reusableLesson === undefined ? optionalText(existing.negative_reusable_lesson, 'reusableLesson', 1200) : optionalText(input.reusableLesson, 'reusableLesson', 1200);
  const replacementPath = input.replacementPath === undefined ? optionalText(existing.negative_replacement_path, 'replacementPath', 500) : optionalText(input.replacementPath, 'replacementPath', 500);
  const clarifyDisposition = input.clarifyDisposition === undefined ? normalizeClarifyDisposition(existing.triage_disposition) : normalizeClarifyDisposition(input.clarifyDisposition);
  const clarifiedBy = input.clarifiedBy === undefined ? optionalText(existing.clarified_by, 'clarifiedBy', 200) : optionalText(input.clarifiedBy, 'clarifiedBy', 200);
  const clarifiedAt = input.clarifiedAt === undefined ? normalizeIsoDate(existing.clarified_at, 'clarifiedAt') : normalizeIsoDate(input.clarifiedAt, 'clarifiedAt');
  const clarifyNote = input.clarifyNote === undefined ? optionalText(existing.clarify_note, 'clarifyNote', 1000) : optionalText(input.clarifyNote, 'clarifyNote', 1000);
  const triageTarget = input.triageTarget === undefined ? optionalText(existing.triage_target, 'triageTarget', 500) : optionalText(input.triageTarget, 'triageTarget', 500);
  const mocPurpose = input.mocPurpose === undefined ? optionalText(existing.moc_purpose, 'mocPurpose', 1000) : optionalText(input.mocPurpose, 'mocPurpose', 1000);
  const mocScope = input.mocScope === undefined ? optionalText(existing.moc_scope, 'mocScope', 500) : optionalText(input.mocScope, 'mocScope', 500);
  const mocQuestions = input.mocQuestions === undefined ? normalizedList(existing.moc_questions, 'mocQuestions', 12, 500) : normalizedList(input.mocQuestions, 'mocQuestions', 12, 500);
  const mocParent = input.mocParent === undefined ? optionalText(existing.moc_parent, 'mocParent', 500) : optionalText(input.mocParent, 'mocParent', 500);
  const focusHorizon = input.focusHorizon === undefined ? normalizeFocusHorizon(existing.focus_horizon) : normalizeFocusHorizon(input.focusHorizon);
  const focusParent = input.focusParent === undefined ? optionalText(existing.focus_parent, 'focusParent', 500) : optionalText(input.focusParent, 'focusParent', 500);
  const focusSupports = input.focusSupports === undefined ? normalizedList(existing.focus_supports, 'focusSupports', 20, 500) : normalizedList(input.focusSupports, 'focusSupports', 20, 500);
  if (negativeType && polarity !== 'negative') throw new Error('negativeType requires polarity=negative');
  if (polarity === 'negative' && !negativeType) throw new Error('polarity=negative requires negativeType');
  const summaryFieldsPresent = Boolean(summary || keyPoints?.length || openQuestions?.length || summaryLayer !== undefined || summaryHighlights?.length);
  const summaryDigest = summaryFieldsPresent && input.contentDigest !== undefined
    ? optionalText(input.contentDigest, 'summary_of_content_sha256', 128)
    : optionalText(existing.summary_of_content_sha256, 'summary_of_content_sha256', 128);
  return {
    note_kind: kind,
    lifecycle,
    ...(moc && { moc }),
    ...(project && { project }),
    ...(reviewAt && { review_at: reviewAt }),
    ...(aliases && { aliases }),
    ...(summary && { summary }),
    ...(keyPoints && { key_points: keyPoints }),
    ...(openQuestions && { open_questions: openQuestions }),
    ...(summaryLayer !== undefined && { summary_layer: summaryLayer }),
    ...(summaryHighlights && { summary_highlights: summaryHighlights }),
    ...(nextActions && { next_actions: nextActions }),
    ...(nextAction && { next_action: nextAction }),
    ...(waitingFor && { waiting_for: waitingFor }),
    ...(desiredOutcome && { desired_outcome: desiredOutcome }),
    ...(projectPurpose && { project_purpose: projectPurpose }),
    ...(projectSupport && { project_support: projectSupport }),
    ...(taskContext && { task_context: taskContext }),
    ...(dueAt && { due_at: dueAt }),
    ...(scheduledAt && { scheduled_at: scheduledAt }),
    ...(deferUntil && { defer_until: deferUntil }),
    ...(stableId && { stable_id: stableId }),
    ...(taskStatus && { task_status: taskStatus }),
    ...(reviewPolicy && { review_policy: reviewPolicy }),
    ...(reviewOutcome && { last_review_outcome: reviewOutcome }),
    ...(reviewedBy && { last_reviewed_by: reviewedBy }),
    ...(reviewedAt && { last_reviewed_at: reviewedAt }),
    ...(reviewNote && { review_note: reviewNote }),
    ...(epistemicStatus && { epistemic_status: epistemicStatus }),
    ...(polarity && { knowledge_polarity: polarity }),
    ...(negativeType && { negative_type: negativeType }),
    ...(attempted && { negative_attempted: attempted }),
    ...(observed && { negative_observed: observed }),
    ...(failureCondition && { negative_failure_condition: failureCondition }),
    ...(affectedScope && { negative_affected_scope: affectedScope }),
    ...(reproduction && { negative_reproduction: reproduction }),
    ...(whyRejected && { negative_why_rejected: whyRejected }),
    ...(reusableLesson && { negative_reusable_lesson: reusableLesson }),
    ...(replacementPath && { negative_replacement_path: replacementPath }),
    ...(clarifyDisposition && { triage_disposition: clarifyDisposition }),
    ...(clarifiedBy && { clarified_by: clarifiedBy }),
    ...(clarifiedAt && { clarified_at: clarifiedAt }),
    ...(clarifyNote && { clarify_note: clarifyNote }),
    ...(triageTarget && { triage_target: triageTarget }),
    ...(mocPurpose && { moc_purpose: mocPurpose }),
    ...(mocScope && { moc_scope: mocScope }),
    ...(mocQuestions && { moc_questions: mocQuestions }),
    ...(mocParent && { moc_parent: mocParent }),
    ...(focusHorizon && { focus_horizon: focusHorizon }),
    ...(focusParent && { focus_parent: focusParent }),
    ...(focusSupports && { focus_supports: focusSupports }),
    ...(summaryDigest && { summary_of_content_sha256: summaryDigest }),
    ...(relations || {}),
  };
}

export interface OrganizationLintIssue {
  code: string;
  detail: string;
}

export function organizationLintIssues(path: string, frontmatter: Record<string, any>, content: string, nowMs = Date.now()): OrganizationLintIssue[] {
  const issues: OrganizationLintIssue[] = [];
  const type = String(frontmatter.llm_wiki_type || '').trim().toLowerCase();
  const kindValue = frontmatter.note_kind;
  const lifecycleValue = frontmatter.lifecycle;
  const kind = kindValue === undefined ? undefined : String(kindValue).trim().toLowerCase();
  const lifecycle = lifecycleValue === undefined ? undefined : String(lifecycleValue).trim().toLowerCase();

  if (kindValue !== undefined && !noteKindSet.has(kind || '')) {
    issues.push({ code: 'invalid_note_kind', detail: `note_kind must be one of: ${NOTE_KINDS.join(', ')}` });
  }
  if (lifecycleValue !== undefined && !lifecycleSet.has(lifecycle || '')) {
    issues.push({ code: 'invalid_lifecycle', detail: `lifecycle must be one of: ${LIFECYCLES.join(', ')}` });
  }
  if (frontmatter.triage_disposition !== undefined && !clarifyDispositionSet.has(String(frontmatter.triage_disposition).trim().toLowerCase())) {
    issues.push({ code: 'invalid_triage_disposition', detail: `triage_disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}` });
  }
  for (const [field, label] of [['clarified_at', 'clarifiedAt'] as const]) {
    if (frontmatter[field] !== undefined) {
      try { normalizeIsoDate(frontmatter[field], label); } catch (error) { issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be an ISO date or date-time` }); }
    }
  }
  for (const [field, label, maxItems] of [['moc_questions', 'mocQuestions', 12] as const]) {
    if (frontmatter[field] !== undefined) {
      try { normalizedList(frontmatter[field], label, maxItems, 500); } catch (error) { issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be a string array` }); }
    }
  }
  for (const field of ORGANIZATION_LIST_FIELDS) {
    const value = frontmatter[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
      issues.push({ code: `invalid_${field}`, detail: `${field} must be a non-empty string array.` });
      continue;
    }
    const duplicates = value.length !== new Set(value.map(item => item.trim())).size;
    if (duplicates) issues.push({ code: `duplicate_${field}`, detail: `${field} contains duplicate values; keep each property value once.` });
    if (RELATION_FIELDS.includes(field as typeof RELATION_FIELDS[number])) {
      for (const item of value) {
        if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(item) || item.includes('..')) {
          issues.push({ code: `unsafe_${field}`, detail: `${field} contains an absolute or traversal-like path; references must remain scope-safe.` });
          break;
        }
      }
    }
  }
  if (frontmatter.summary !== undefined && (typeof frontmatter.summary !== 'string' || Array.from(frontmatter.summary).length > 2000)) {
    issues.push({ code: 'invalid_summary', detail: 'summary must be a text property of 2000 Unicode characters or fewer.' });
  }
  if (frontmatter.stable_id !== undefined && (typeof frontmatter.stable_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(frontmatter.stable_id))) {
    issues.push({ code: 'invalid_stable_id', detail: 'stable_id must contain only letters, numbers, dots, underscores, and hyphens.' });
  }
  if (frontmatter.focus_horizon !== undefined && !focusHorizonSet.has(String(frontmatter.focus_horizon).trim().toLowerCase())) {
    issues.push({ code: 'invalid_focus_horizon', detail: `focus_horizon must be one of: ${FOCUS_HORIZONS.join(', ')}` });
  }
  if (frontmatter.focus_supports !== undefined) {
    try { normalizedList(frontmatter.focus_supports, 'focusSupports', 20, 500); } catch (error) { issues.push({ code: 'invalid_focus_supports', detail: error instanceof Error ? error.message : 'focus_supports must be a string array.' }); }
  }
  if (frontmatter.summary_layer !== undefined) {
    const layer = Number(frontmatter.summary_layer);
    if (!Number.isInteger(layer) || layer < 0 || layer > 4) issues.push({ code: 'invalid_summary_layer', detail: 'summary_layer must be an integer from 0 to 4.' });
  }
  if (frontmatter.summary_highlights !== undefined) {
    try {
      const highlights = normalizedHighlights(frontmatter.summary_highlights, 'summaryHighlights') || [];
      const lines = content.split('\n');
      for (const highlight of highlights) {
        if (highlight.startLine === undefined || highlight.endLine === undefined) continue;
        if (highlight.endLine > lines.length) {
          issues.push({ code: 'summary_highlight_out_of_range', detail: 'A summary highlight line range exceeds the current note body.' });
          continue;
        }
        if (highlight.quoteHash) {
          const digest = createHash('sha256').update(lines.slice(highlight.startLine - 1, highlight.endLine).join('\n'), 'utf8').digest('hex');
          if (digest !== highlight.quoteHash) issues.push({ code: 'stale_summary_highlight', detail: 'A summary highlight quoteHash no longer matches its selected body lines.' });
        }
      }
    } catch (error) { issues.push({ code: 'invalid_summary_highlights', detail: error instanceof Error ? error.message : 'summary_highlights must be bounded highlight objects.' }); }
  }
  if (frontmatter.task_status !== undefined && !taskStatusSet.has(String(frontmatter.task_status).trim().toLowerCase())) {
    issues.push({ code: 'invalid_task_status', detail: `task_status must be one of: ${TASK_STATUSES.join(', ')}` });
  }
  if (frontmatter.review_policy !== undefined && !reviewPolicySet.has(String(frontmatter.review_policy).trim().toLowerCase())) {
    issues.push({ code: 'invalid_review_policy', detail: `review_policy must be one of: ${REVIEW_POLICIES.join(', ')}` });
  }
  if (frontmatter.last_review_outcome !== undefined && !reviewOutcomeSet.has(String(frontmatter.last_review_outcome).trim().toLowerCase())) {
    issues.push({ code: 'invalid_review_outcome', detail: `last_review_outcome must be one of: ${REVIEW_OUTCOMES.join(', ')}` });
  }
  for (const [field, value] of [['due_at', frontmatter.due_at], ['scheduled_at', frontmatter.scheduled_at], ['defer_until', frontmatter.defer_until], ['last_reviewed_at', frontmatter.last_reviewed_at]] as const) {
    if (value !== undefined && (!/^(?:\d{4}-\d{2}-\d{2})(?:T[^\s]+)?$/.test(String(value).trim()) || Number.isNaN(Date.parse(String(value).trim())))) {
      issues.push({ code: `invalid_${field}`, detail: `${field} should be an ISO date or date-time.` });
    }
  }
  const polarity = frontmatter.knowledge_polarity === undefined ? undefined : String(frontmatter.knowledge_polarity).trim().toLowerCase();
  const negativeType = frontmatter.negative_type === undefined ? undefined : String(frontmatter.negative_type).trim().toLowerCase();
  if (polarity !== undefined && !knowledgePolaritySet.has(polarity)) {
    issues.push({ code: 'invalid_knowledge_polarity', detail: `knowledge_polarity must be one of: ${KNOWLEDGE_POLARITIES.join(', ')}` });
  }
  if (negativeType !== undefined && !negativeKindSet.has(negativeType)) {
    issues.push({ code: 'invalid_negative_type', detail: `negative_type must be one of: ${NEGATIVE_KINDS.join(', ')}` });
  }
  if (negativeType && polarity !== 'negative') issues.push({ code: 'negative_type_without_negative_polarity', detail: 'negative_type requires knowledge_polarity: negative.' });
  if (polarity === 'negative' && !negativeType) issues.push({ code: 'negative_polarity_without_type', detail: 'Negative knowledge should state whether it is a failure, rejection, counterexample, or non-reproducible result.' });
  const epistemicStatus = frontmatter.epistemic_status === undefined ? undefined : String(frontmatter.epistemic_status).trim().toLowerCase();
  if (kind === 'question' || kind === 'hypothesis' || kind === 'assumption') {
    if (epistemicStatus === undefined) issues.push({ code: 'epistemic_status_missing', detail: `${kind} notes should declare epistemic_status so their uncertainty state is visible.` });
    try { normalizeEpistemicStatus(epistemicStatus, kind, kind === 'question' ? 'open' : kind === 'hypothesis' ? 'proposed' : 'active'); }
    catch (error) { issues.push({ code: 'invalid_epistemic_status', detail: error instanceof Error ? error.message : 'Invalid epistemic status.' }); }
  } else if (epistemicStatus !== undefined) {
    issues.push({ code: 'epistemic_status_wrong_kind', detail: 'epistemic_status is only valid for question, hypothesis, or assumption notes.' });
  }
  if (polarity === 'negative') {
    if (!frontmatter.negative_reusable_lesson) issues.push({ code: 'negative_lesson_missing', detail: 'Negative knowledge should preserve a reusable lesson so future agents do not repeat the failed path.' });
    if (negativeType === 'failure' && !frontmatter.negative_reproduction) issues.push({ code: 'negative_reproduction_missing', detail: 'A failure note should record a bounded reproduction or observation recipe when possible.' });
  }
  const summaryPresent = typeof frontmatter.summary === 'string' || Array.isArray(frontmatter.key_points) || Array.isArray(frontmatter.open_questions) || frontmatter.summary_layer !== undefined || Array.isArray(frontmatter.summary_highlights);
  if (summaryPresent && frontmatter.summary_of_content_sha256 === undefined) {
    issues.push({ code: 'summary_fingerprint_missing', detail: 'Progressive summary fields should record summary_of_content_sha256 so stale summaries can be detected after body edits.' });
  } else if (summaryPresent && typeof frontmatter.summary_of_content_sha256 === 'string') {
    if (!/^[a-f0-9]{64}$/i.test(frontmatter.summary_of_content_sha256)) {
      issues.push({ code: 'invalid_summary_fingerprint', detail: 'summary_of_content_sha256 must be a SHA-256 hexadecimal digest of the current Markdown body.' });
    } else {
      const digest = createHash('sha256').update(content, 'utf8').digest('hex');
      if (frontmatter.summary_of_content_sha256 !== digest) issues.push({ code: 'stale_summary', detail: 'The note body changed after its stored progressive summary; regenerate the summary before relying on it.' });
    }
  }
  if (kind === 'project' && lifecycle === 'active' && !frontmatter.next_action && !frontmatter.waiting_for) {
    issues.push({ code: 'active_project_without_next_action', detail: 'An active project should declare next_action or waiting_for so another agent can move it forward.' });
  }
  if (kind === 'project' && lifecycle === 'active' && !frontmatter.project_purpose && !frontmatter.desired_outcome) {
    issues.push({ code: 'active_project_without_outcome', detail: 'An active project should state its purpose or desired_outcome so planning and review can distinguish it from an area.' });
  }
  if (frontmatter.triage_disposition !== undefined && !clarifyDispositionSet.has(String(frontmatter.triage_disposition).trim().toLowerCase())) {
    issues.push({ code: 'invalid_triage_disposition', detail: `triage_disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}` });
  }
  for (const [field, maximum] of [['clarified_by', 200], ['clarify_note', 1000], ['triage_target', 500], ['moc_purpose', 1000], ['moc_scope', 500], ['moc_parent', 500], ['project_purpose', 1000] ] as const) {
    const value = frontmatter[field];
    if (value !== undefined && (typeof value !== 'string' || Array.from(value).length > maximum)) {
      issues.push({ code: `invalid_${field}`, detail: `${field} must be text of ${maximum} Unicode characters or fewer.` });
    }
  }
  if (frontmatter.clarified_at !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(String(frontmatter.clarified_at).trim()) || Number.isNaN(Date.parse(String(frontmatter.clarified_at).trim())))) {
    issues.push({ code: 'invalid_clarified_at', detail: 'clarified_at should be an ISO date or date-time.' });
  }
  if (frontmatter.moc_questions !== undefined && (!Array.isArray(frontmatter.moc_questions) || frontmatter.moc_questions.some((item: unknown) => typeof item !== 'string' || !item.trim() || Array.from(item as string).length > 500))) {
    issues.push({ code: 'invalid_moc_questions', detail: 'moc_questions must be a non-empty string array with entries of 500 Unicode characters or fewer.' });
  }
  if (type !== 'knowledge') return issues;

  if (!kind) issues.push({ code: 'knowledge_note_kind_missing', detail: 'Knowledge notes should declare note_kind so agents can distinguish atomic claims, MOCs, decisions, and other work.' });
  if (!lifecycle) issues.push({ code: 'knowledge_lifecycle_missing', detail: 'Knowledge notes should declare lifecycle: inbox, active, review, evergreen, superseded, or archived.' });

  const reviewAt = frontmatter.review_at;
  if (reviewAt !== undefined) {
    const reviewText = String(reviewAt).trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(reviewText) || Number.isNaN(Date.parse(reviewText))) {
      issues.push({ code: 'invalid_review_at', detail: 'review_at should be an ISO date or date-time.' });
    } else if (Date.parse(reviewText) <= nowMs && lifecycle !== 'archived' && lifecycle !== 'superseded') {
      issues.push({ code: 'knowledge_review_due', detail: `Knowledge review is due (${reviewText}). Re-check evidence and either update, dispute, or reschedule it.` });
    }
  } else if (lifecycle === 'review') {
    issues.push({ code: 'review_date_missing', detail: 'Notes in review should set review_at so the next agent can find them again.' });
  }

  if (kind === 'moc' && !/\[\[[^\]]+\]\]/.test(content)) {
    issues.push({ code: 'moc_without_links', detail: 'A MOC should link to at least one related note with Obsidian [[wikilinks]].' });
  }
  if (kind === 'moc') {
    if (!frontmatter.moc_purpose) issues.push({ code: 'moc_purpose_missing', detail: 'A MOC should state what navigation or question it is meant to serve.' });
    if (!Array.isArray(frontmatter.moc_questions) || frontmatter.moc_questions.length === 0) issues.push({ code: 'moc_questions_missing', detail: 'A MOC should list representative questions so its coverage stays intentional.' });
  }
  if (kind === 'atomic' && content.split(/\n\s*\n/).filter(block => block.trim() && !block.trim().startsWith('#')).length > 8) {
    issues.push({ code: 'atomic_note_may_be_too_broad', detail: 'An atomic note contains many paragraphs; consider splitting durable claims and linking the resulting notes.' });
  }
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)inbox\//.test(normalizedPath) && lifecycle !== 'inbox') {
    issues.push({ code: 'inbox_lifecycle_mismatch', detail: 'Notes under Inbox should remain lifecycle: inbox until clarified and moved or reclassified.' });
  }
  return issues;
}
