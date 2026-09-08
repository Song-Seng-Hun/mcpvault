import { guidanceError } from './guidance-runtime.js';
/**
 * Pure, persisted workshop facilitation catalogue. This module deliberately
 * does not read files, authenticate callers, write notes, call models, or
 * advance time. The IdeationService supplies those boundaries.
 */
import { validateWorkshopLineage, workshopLineagePrerequisites, type WorkshopLineagePrerequisiteCoverage } from './workshop-lineage.js';

export const FACILITATION_METHOD_IDS = [
  'page-led', 'checklist', 'how-might-we', 'brainwriting', 'six-hats', 'scamper',
  'crazy8s', '1-2-4-all', 'affinity-kj', 'mind-map', 'ngt', 'dot-voting', 'daci',
  'premortem', 'retrospective', 'blameless-postmortem',
] as const;
export type FacilitationMethodId = typeof FACILITATION_METHOD_IDS[number];

export interface FacilitationStep {
  id: string;
  title: string;
  required: readonly string[];
  requiredFields: readonly string[];
  finishCondition: string;
  adaptation: string;
  minimumAccounts?: number;
}

export interface FacilitationMethod {
  methodId: FacilitationMethodId;
  version: 1;
  title: string;
  adaptation: string;
  steps: readonly FacilitationStep[];
}

type StepSeed = Omit<FacilitationStep, 'id'> & { key: string };
const method = (methodId: FacilitationMethodId, title: string, adaptation: string, steps: readonly StepSeed[]): FacilitationMethod => ({
  methodId, version: 1, title, adaptation,
  steps: steps.map(({ key, ...step }) => ({ id: `${methodId}-${key}`, ...step })),
});
const fieldHints: ReadonlyArray<readonly [RegExp, string]> = [
  [/source revisions?/i, 'sourceRevisions'], [/acknowledg/i, 'acknowledgement'], [/check/i, 'checks'], [/map nodes?/i, 'mapNodes'], [/map edges?|cross-links?/i, 'mapEdges'],
  [/ballot/i, 'ballot'], [/groups?/i, 'groups'], [/names?/i, 'names'], [/\bideas?\b|alternatives?/i, 'ideaIds'], [/parent idea/i, 'parentIdeaIds'],
  [/question/i, 'questions'], [/observed problem|observations?/i, 'observations'], [/evidence/i, 'evidence'], [/benefits?/i, 'benefits'], [/risks?/i, 'risks'],
  [/uncertainty/i, 'uncertainty'], [/revisit|review conditions?/i, 'revisit'], [/synthesis|group synthesis/i, 'synthesis'], [/participant accounts?/i, 'participantAccounts'],
  [/driver|approver|contributors|informed|roles?/i, 'roles'], [/mitigation/i, 'mitigation'], [/early signal/i, 'earlySignal'], [/owner action/i, 'ownerAction'],
  [/timeline/i, 'timeline'], [/impact/i, 'impact'], [/contributing factors?/i, 'contributingFactors'], [/helpful response/i, 'helpfulResponse'], [/prevention/i, 'prevention'],
  [/experiment/i, 'experiment'], [/failure scenario|assume failure/i, 'failureScenario'], [/ranking/i, 'ranking'], [/criteria/i, 'criteria'], [/reason/i, 'reason'],
  [/start, stop|liked, learned|longed-for/i, 'observations'],
];
function fieldsFor(required: readonly string[]): string[] {
  const combined = required.join(' ');
  return Array.from(new Set(fieldHints.filter(([pattern]) => pattern.test(combined)).map(([, field]) => field)));
}
const submit = (required: string[], finishCondition: string, adaptation: string, minimumAccounts?: number): Omit<StepSeed, 'key' | 'title'> => ({ required, requiredFields: fieldsFor(required), finishCondition, adaptation, ...(minimumAccounts ? { minimumAccounts } : {}) });

export const FACILITATION_METHODS: readonly FacilitationMethod[] = [
  method('page-led', 'Page-led discussion', 'Async readers acknowledge a revision in text before discussion; no unread page is inferred as agreement.', [
    { key: 'frame', title: 'Frame purpose, scope, outcome, and questions', ...submit(['purpose, scope, outcome, questions, source revisions'], 'Frame names a bounded outcome and current sources.', 'Use a short Markdown brief with revision pins.') },
    { key: 'read', title: 'Read acknowledgement and questions', ...submit(['acknowledgement or question'], 'Each required reader explicitly acknowledges or asks a question.', 'Async readers may respond in any order.', 2) },
    { key: 'discuss', title: 'Discuss current questions', ...submit(['observation, extension, or challenge'], 'Open questions are answered, retained, or explicitly deferred.', 'Threaded text discussion replaces a live meeting.') },
  ]),
  method('checklist', 'Checklist review', 'Unknown is a valid state; async actors record evidence, reason, and actor rather than guessing.', [
    { key: 'prepare', title: 'Preparation checks', ...submit(['checks with unknown/pass/fail/not_applicable, evidence, reason, actor'], 'Every preparation item has an explicit state.', 'Share the checklist in Markdown.') },
    { key: 'progress', title: 'Progress checks', ...submit(['checks with evidence and reason'], 'Open failures and unknowns have an owner or waiting reason.', 'Use a bounded status update instead of a meeting.') },
    { key: 'close', title: 'Closing checks', ...submit(['checks and unresolved exceptions'], 'All closing checks are pass, not_applicable, or explicitly carried forward.', 'Do not convert unknown into pass.') },
  ]),
  method('how-might-we', 'How might we', 'Text-only workshops retain observed problems and open questions before refining wording.', [
    { key: 'observe', title: 'Observe the problem', ...submit(['observed problem and evidence'], 'At least one observed problem is recorded without a solution.', 'Async contributors may add distinct observations.') },
    { key: 'question', title: 'Open questions', ...submit(['open questions'], 'Questions are open-ended and tied to observed problems.', 'Use comments or short submissions.') },
    { key: 'refine', title: 'Refine questions', ...submit(['refined questions and challenges'], 'Too-broad and solution-forcing questions are explicitly refined or rejected.', 'Keep rejected wording for provenance.') },
  ]),
  method('brainwriting', 'Brainwriting', 'For 6-3-5 use six actual accounts, three ideas each round, and an explicit five-minute cycle; async or small groups use a declared adaptation.', [
    { key: 'independent', title: 'Independent ideas', ...submit(['idea IDs and origin'], 'Each participating account records independent ideas.', 'Generic brainwriting accepts independent text submissions.', 2) },
    { key: 'build', title: 'Build on others', ...submit(['extension and parent idea IDs'], 'Each extension names an existing idea ID.', 'Async participants build in a later explicit round.', 2) },
  ]),
  method('six-hats', 'Six hats', 'This product default is setup, information, alternatives, benefits, risks, tentative intuition/preferences, then synthesis; it is not asserted as a universal official order.', [
    { key: 'setup', title: 'Setup', ...submit(['question and constraints'], 'Question and constraints are explicit.', 'The same accounts take sequential views.') },
    { key: 'information', title: 'Information', ...submit(['evidence and unknowns'], 'Information distinguishes evidence from unknowns.', 'Same agents continue; no new agents are invented.') },
    { key: 'alternatives', title: 'Alternatives', ...submit(['idea IDs and origin'], 'Alternatives are distinct.', 'Use text alternatives.') },
    { key: 'benefits', title: 'Benefits', ...submit(['benefits linked to alternatives'], 'Benefits name their alternative.', 'Async sequential view.') },
    { key: 'risks', title: 'Risks', ...submit(['risks and challenges'], 'Risks are preserved for synthesis.', 'Async sequential view.') },
    { key: 'intuition', title: 'Tentative intuition and preferences', ...submit(['tentative preferences and uncertainty'], 'Preferences are labeled tentative.', 'No preference becomes a decision.') },
    { key: 'synthesis', title: 'Synthesis', ...submit(['adopted, rejected, minority, uncertainty, revisit'], 'Synthesis preserves dissent and revisit conditions.', 'A written synthesis ends the round.') },
  ]),
  method('scamper', 'SCAMPER', 'Async contributors may cover one prompt at a time, but each contribution keeps parent-idea links.', [
    { key: 'substitute', title: 'Substitute', ...submit(['idea IDs and parent idea links'], 'Substitutions name their parent ideas.', 'Text prompt adaptation.') },
    { key: 'combine', title: 'Combine', ...submit(['idea IDs and parent idea links'], 'Combinations preserve both parents.', 'Text prompt adaptation.') },
    { key: 'adapt', title: 'Adapt', ...submit(['idea IDs and parent idea links'], 'Adaptations name their parent.', 'Text prompt adaptation.') },
    { key: 'modify', title: 'Modify', ...submit(['idea IDs and parent idea links'], 'Modifications name their parent.', 'Text prompt adaptation.') },
    { key: 'other-use', title: 'Put to other use', ...submit(['idea IDs and parent idea links'], 'Other uses name their parent.', 'Text prompt adaptation.') },
    { key: 'eliminate', title: 'Eliminate', ...submit(['idea IDs and parent idea links'], 'Eliminations name their parent.', 'Text prompt adaptation.') },
    { key: 'reverse', title: 'Reverse', ...submit(['idea IDs and parent idea links'], 'Reversals name their parent.', 'Text prompt adaptation.') },
  ]),
  method('crazy8s', 'Crazy 8s', 'Text and async adaptation requires eight distinct alternatives rather than eight drawings.', [
    { key: 'eight', title: 'Eight distinct alternatives', ...submit(['eight distinct idea IDs'], 'Eight alternatives are distinct; duplicates are rejected.', 'Use eight short text alternatives.') },
    { key: 'select', title: 'Selection', ...submit(['ranking and reason'], 'Selection names criteria and remains a proposal.', 'Async review replaces a gallery walk.') },
  ]),
  method('1-2-4-all', '1-2-4-All', 'If fewer actual accounts are available, wait or record an explicit reduced variant; never fabricate participants.', [
    { key: 'one', title: 'Individual reflection', ...submit(['ideas and origin'], 'Actual participants provide individual input.', 'Async individual responses.', 2) },
    { key: 'two', title: 'Pairs', ...submit(['extensions and participant accounts'], 'Pairs contain two actual accounts or a declared reduced variant.', 'Wait for a second account or select reduced variant.', 2) },
    { key: 'four', title: 'Fours', ...submit(['group synthesis and participant accounts'], 'Groups contain four actual accounts or a declared reduced variant.', 'Wait for four accounts or select reduced variant.', 4) },
    { key: 'all', title: 'All', ...submit(['synthesis, minority, uncertainty, participant accounts'], 'All current groups are represented without invented attendees.', 'Async all-hands summary.') },
  ]),
  method('affinity-kj', 'Affinity / KJ', 'Async grouping preserves ungrouped items and permits multiple memberships.', [
    { key: 'collect', title: 'Collect', ...submit(['idea IDs and origin'], 'Original items remain addressable.', 'Collect short notes asynchronously.') },
    { key: 'group', title: 'Group', ...submit(['groups preserving original IDs'], 'Ungrouped and multiple-membership items remain explicit.', 'Markdown groups replace sticky notes.') },
    { key: 'name', title: 'Name groups', ...submit(['group names and uncertainty'], 'Names describe rather than erase disagreements.', 'Async labels are reviewable.') },
  ]),
  method('mind-map', 'Mind map', 'Markdown records explicit nodes and cross-links for a later Canvas projection; it does not create Canvas itself.', [
    { key: 'root', title: 'Root question', ...submit(['root question'], 'One root question is explicit.', 'Markdown root node.') },
    { key: 'branches', title: 'Branches', ...submit(['map nodes for questions, alternatives, constraints, evidence'], 'Every branch has a typed node.', 'Text tree adaptation.') },
    { key: 'crosslinks', title: 'Explained cross-links', ...submit(['map edges with reasons'], 'Cross-links state a reason and endpoint IDs.', 'Markdown relations await later Canvas projection.') },
  ]),
  method('ngt', 'Nominal group technique', 'Ranking counts votes, not verbosity; async round-robin preserves one turn per actual account.', [
    { key: 'independent', title: 'Independent ideas', ...submit(['idea IDs and origin'], 'Ideas are independent before discussion.', 'Async submissions.', 2) },
    { key: 'roundrobin', title: 'Round-robin share', ...submit(['idea IDs and account'], 'Each actual account shares without a fabricated turn.', 'One bounded turn per account.', 2) },
    { key: 'clarify', title: 'Clarify', ...submit(['questions and clarifications'], 'Clarification does not delete an original idea.', 'Threaded clarification.') },
    { key: 'rank', title: 'Ranking', ...submit(['ballot and ranking reason'], 'Ranking is counted by ballot, not contribution length.', 'Async ballots.') },
  ]),
  method('dot-voting', 'Dot voting', 'Public workshops are not secret ballots; one authenticated account receives one ballot across sessions and roles.', [
    { key: 'freeze', title: 'Freeze alternatives and criteria', ...submit(['alternatives and criteria'], 'Alternatives and criteria are fixed before any ballot.', 'Publish a Markdown freeze record.') },
    { key: 'vote', title: 'Vote', ...submit(['one account ballot and ranking'], 'One ballot per authenticated account; ranking is neither truth nor approval.', 'Async public ballot.', 2) },
  ]),
  method('daci', 'DACI', 'Roles are explicit and account-based; delegated decision authority remains separate from facilitation.', [
    { key: 'roles', title: 'Roles', ...submit(['driver, approver, contributors, informed'], 'Each role maps to authenticated accounts.', 'Markdown role table.') },
    { key: 'alternatives', title: 'Alternatives', ...submit(['alternatives and evidence'], 'Alternatives retain their evidence.', 'Async proposals.') },
    { key: 'reason', title: 'Reason', ...submit(['reason, uncertainty, minority'], 'Reason identifies authority and dissent.', 'No automatic approval.') },
    { key: 'review', title: 'Review conditions', ...submit(['review conditions and revisit'], 'Review conditions are explicit.', 'Async review trigger.') },
  ]),
  method('premortem', 'Premortem', 'Assume a future failure without blaming people; async participants add independently before prioritization.', [
    { key: 'failure', title: 'Assume failure', ...submit(['failure scenario'], 'A plausible failure is stated.', 'Text scenario.') },
    { key: 'causes', title: 'Causes', ...submit(['causes and evidence'], 'Causes are not blame assertions.', 'Async independent causes.') },
    { key: 'prioritize', title: 'Prioritized risks', ...submit(['ranking and risk rationale'], 'Risks have explicit priority rationale.', 'Async ranking.') },
    { key: 'mitigate', title: 'Mitigation', ...submit(['mitigation, early signal, owner action'], 'Every selected risk has a mitigation, signal, and owner action.', 'Markdown action list.') },
  ]),
  method('retrospective', 'Retrospective', 'Use Start/Stop/Continue or 4Ls, then turn observations into one bounded improvement experiment.', [
    { key: 'observe', title: 'Observations', ...submit(['start, stop, continue or liked, learned, lacked, longed-for'], 'Observations retain their chosen variant.', 'Async notes.') },
    { key: 'experiment', title: 'Improvement experiment', ...submit(['next improvement experiment, owner, review'], 'One next experiment is testable and reviewable.', 'Markdown experiment card.') },
  ]),
  method('blameless-postmortem', 'Blameless postmortem', 'Record system conditions and helpful response without assertions of personal blame.', [
    { key: 'timeline', title: 'Timeline and impact', ...submit(['timeline and impact'], 'Timeline separates observed facts from uncertainty.', 'Async evidence collection.') },
    { key: 'factors', title: 'Contributing factors and helpful response', ...submit(['contributing factors and helpful response'], 'No blame assertion is accepted.', 'Text analysis.') },
    { key: 'prevention', title: 'Prevention', ...submit(['prevention, owner action, review'], 'Prevention has an owner action and review condition.', 'Markdown follow-up.') },
  ]),
];

const catalogue = new Map(FACILITATION_METHODS.map(value => [value.methodId, value]));
const MAX_METHODS = 4;
const MAX_STEPS = 32;
const MAX_ARRAY_ITEMS = 16;
const MAX_TEXT = 500;
const revisionPattern = /^[a-f0-9]{64}$/i;

export interface FacilitationSourceRevision { path: string; revision: string }
export interface FacilitationMethodState { methodId: FacilitationMethodId; version: 1; steps: readonly FacilitationStep[] }
export interface WorkshopFacilitation {
  version: 1;
  purpose: string;
  scope: string;
  successCriteria: string[];
  sourceRevisions: FacilitationSourceRevision[];
  methods: FacilitationMethodState[];
  currentStepId: string;
  round: number;
  brainwritingCycle?: number;
  facilitatorAccountId: string;
  facilitatorGeneration: number;
  participants: string[];
  decisionAuthority: { approverAccountId?: string; delegatedAccountId?: string; delegationReason?: string };
  checks: Array<Record<string, unknown>>;
  waitingReason?: string;
  resumeCondition?: string;
  outputs: Array<Record<string, unknown>>;
  ordinaryRedoCount: number;
}

export interface FacilitationSubmission {
  accountId: string;
  stepId: string;
  structured: Record<string, unknown>;
}
export interface FacilitationCompletion {
  complete: boolean;
  unmet: string[];
  minimumAccounts?: number;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw guidanceError(new Error(`${field} must be an object`), 'guid-fb22bd2cde0b504a');
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw guidanceError(new Error(`${field} contains unknown fields: ${unknown.join(', ')}`), 'guid-75bd2fbbffa05d95');
}
function short(value: unknown, field: string, required = true): string {
  if (typeof value !== 'string') throw guidanceError(new Error(`${field} must be a string`), 'guid-9a47fff07b9e2cc5');
  const result = value.trim();
  if (required && !result) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  if (Array.from(result).length > MAX_TEXT) throw guidanceError(new Error(`${field} exceeds ${MAX_TEXT} characters`), 'guid-73eabe6107db8274');
  return result;
}
function strings(value: unknown, field: string, max = MAX_ARRAY_ITEMS): string[] {
  if (!Array.isArray(value) || value.length > max) throw guidanceError(new Error(`${field} must be an array with at most ${max} items`), 'guid-ce6c9d3c87a4fbc6');
  return Array.from(new Set(value.map(item => short(item, field))));
}
function methodId(value: unknown): FacilitationMethodId {
  if (typeof value !== 'string' || !catalogue.has(value as FacilitationMethodId)) throw guidanceError(new Error(`methodId must be one of: ${FACILITATION_METHOD_IDS.join(', ')}`), 'guid-0b1b11119cc83cfd');
  return value as FacilitationMethodId;
}
function currentStep(methods: readonly FacilitationMethodState[], stepId: string): FacilitationStep {
  for (const state of methods) {
    const step = state.steps.find(candidate => candidate.id === stepId);
    if (step) return step;
  }
  throw guidanceError(new Error('currentStepId is not a catalogue step'), 'guid-a43d2f6a08b12b6c');
}
function exactSteps(id: FacilitationMethodId, value: unknown): readonly FacilitationStep[] {
  const known = catalogue.get(id)!;
  if (value === undefined) return known.steps;
  const matches = (step: unknown, index: number): boolean => {
    const current = known.steps[index]!;
    if (JSON.stringify(step) === JSON.stringify(current)) return true;
    // The original v1 persisted its display hints. Accept only that exact
    // historical shape; submission/attendance validation remains current.
    if (id !== '1-2-4-all' || current.id !== '1-2-4-all-all') return false;
    const required = ['synthesis, minority, uncertainty'];
    return JSON.stringify(step) === JSON.stringify({ ...current, required, requiredFields: fieldsFor(required) });
  };
  if (!Array.isArray(value) || value.length !== known.steps.length || value.some((step, index) => !matches(step, index))) {
    throw guidanceError(new Error('Managed facilitation steps must match the current versioned catalogue'), 'guid-8f472b42b2ddeb02');
  }
  return known.steps;
}

/** Validates user input as well as persisted Markdown frontmatter. */
export function createFacilitation(value: unknown): WorkshopFacilitation {
  const raw = object(value, 'facilitation');
  onlyKeys(raw, 'facilitation', ['version', 'purpose', 'scope', 'successCriteria', 'sourceRevisions', 'methods', 'currentStepId', 'round', 'brainwritingCycle', 'facilitatorAccountId', 'facilitatorGeneration', 'participants', 'decisionAuthority', 'checks', 'waitingReason', 'resumeCondition', 'outputs', 'ordinaryRedoCount']);
  if (raw.version !== 1) throw guidanceError(new Error('facilitation.version must be 1'), 'guid-4d2f018ec8aa4ce4');
  const rawMethods = raw.methods;
  if (!Array.isArray(rawMethods) || rawMethods.length < 1 || rawMethods.length > MAX_METHODS) throw guidanceError(new Error(`facilitation.methods must contain 1 to ${MAX_METHODS} methods`), 'guid-fd75a674451a8d3a');
  const methods = rawMethods.map((entry, index) => {
    const item = typeof entry === 'string' ? { methodId: entry } : object(entry, `methods[${index}]`);
    onlyKeys(item, `methods[${index}]`, ['methodId', 'version', 'steps']);
    const id = methodId(item.methodId);
    if (item.version !== undefined && item.version !== 1) throw guidanceError(new Error('Only facilitation method version 1 is supported'), 'guid-880816298ea312ce');
    return { methodId: id, version: 1 as const, steps: exactSteps(id, item.steps) };
  });
  if (new Set(methods.map(item => item.methodId)).size !== methods.length) throw guidanceError(new Error('facilitation.methods may not repeat a method'), 'guid-48b30f013e1ab338');
  if (methods.reduce((total, item) => total + item.steps.length, 0) > MAX_STEPS) throw guidanceError(new Error(`facilitation has more than ${MAX_STEPS} steps`), 'guid-42299b8c2836a2dd');
  const sourceRevisions = (raw.sourceRevisions === undefined ? [] : (() => {
    if (!Array.isArray(raw.sourceRevisions) || raw.sourceRevisions.length > 8) throw guidanceError(new Error('sourceRevisions must contain at most 8 guarded sources'), 'guid-c5c5d5cfed6a1523');
    return raw.sourceRevisions.map((entry, index) => {
      const source = object(entry, `sourceRevisions[${index}]`);
      onlyKeys(source, `sourceRevisions[${index}]`, ['path', 'revision']);
      const path = short(source.path, 'sourceRevisions.path');
      const revision = short(source.revision, 'sourceRevisions.revision');
      if (!revisionPattern.test(revision)) throw guidanceError(new Error('sourceRevisions.revision must be a SHA-256 revision'), 'guid-94bfb32f79a84481');
      return { path, revision };
    });
  })());
  if (sourceRevisions.length < 1) throw guidanceError(new Error('sourceRevisions must contain at least one current source path and revision'), 'guid-71ee8e48f80bd0b6');
  const participants = strings(raw.participants ?? [], 'participants', 64).map((item, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(item)) throw guidanceError(new Error(`participants[${index}] must be a bounded account identifier`), 'guid-55830940868c196d');
    return item;
  });
  const facilitatorAccountId = short(raw.facilitatorAccountId, 'facilitatorAccountId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(facilitatorAccountId)) throw guidanceError(new Error('facilitatorAccountId must be a bounded account identifier'), 'guid-8c6e2014bcb327e1');
  if (!participants.includes(facilitatorAccountId)) participants.unshift(facilitatorAccountId);
  const authority = object(raw.decisionAuthority ?? {}, 'decisionAuthority');
  onlyKeys(authority, 'decisionAuthority', ['approverAccountId', 'delegatedAccountId', 'delegationReason']);
  const decisionAuthority = {
    ...(authority.approverAccountId === undefined ? {} : { approverAccountId: identifier(authority.approverAccountId, 'decisionAuthority.approverAccountId') }),
    ...(authority.delegatedAccountId === undefined ? {} : { delegatedAccountId: identifier(authority.delegatedAccountId, 'decisionAuthority.delegatedAccountId') }),
    ...(authority.delegationReason === undefined ? {} : { delegationReason: short(authority.delegationReason, 'decisionAuthority.delegationReason') }),
  };
  for (const accountId of [decisionAuthority.approverAccountId, decisionAuthority.delegatedAccountId]) {
    if (accountId !== undefined && !participants.includes(accountId)) throw guidanceError(new Error('decisionAuthority accounts must be explicitly configured actual participants'), 'guid-115c844391cc1111');
  }
  const defaultStep = methods[0]!.steps[0]!.id;
  const currentStepId = raw.currentStepId === undefined ? defaultStep : short(raw.currentStepId, 'currentStepId');
  currentStep(methods, currentStepId);
  const checks = raw.checks === undefined ? [] : arrayObjects(raw.checks, 'checks', ['itemId', 'status', 'evidence', 'reason', 'actor']);
  for (const [index, check] of checks.entries()) {
    for (const field of ['itemId', 'status', 'evidence', 'reason', 'actor']) if (check[field] !== undefined) validateNested(check[field], `checks[${index}].${field}`, 0);
  }
  const outputs = raw.outputs === undefined ? [] : arrayObjects(raw.outputs, 'outputs', ['type', 'status', 'synthesis', 'structured', 'references', 'alternatives', 'evidence', 'reason', 'reviewConditions', 'createdAt','round']);
  for (const [index, output] of outputs.entries()) {
    if(output.round!==undefined)number(output.round,`outputs[${index}].round`,1,64);
    if (output.type !== undefined) short(output.type, `outputs[${index}].type`);
    if (output.status !== 'proposed' && output.status !== 'unverified') {
      throw guidanceError(new Error(`outputs[${index}].status must be proposed or unverified until an authorized output bridge verifies it`), 'guid-77624e4a78a20209');
    }
    if (output.synthesis !== undefined) {
      if (typeof output.synthesis !== 'string' || !output.synthesis.trim() || Array.from(output.synthesis).length > 4000) throw guidanceError(new Error(`outputs[${index}].synthesis must be non-empty text of at most 4000 characters`), 'guid-3ec3e4f22d61ec98');
    }
    if (output.structured !== undefined) validateStructured(output.structured);
    for (const field of ['references', 'alternatives', 'evidence', 'reason', 'reviewConditions', 'createdAt']) if (output[field] !== undefined) validateNested(output[field], `outputs[${index}].${field}`, 0);
  }
  const round = raw.round === undefined ? 1 : number(raw.round, 'round', 1, 64);
  const facilitatorGeneration = raw.facilitatorGeneration === undefined ? 0 : number(raw.facilitatorGeneration, 'facilitatorGeneration', 0, Number.MAX_SAFE_INTEGER);
  const ordinaryRedoCount = raw.ordinaryRedoCount === undefined ? 0 : number(raw.ordinaryRedoCount, 'ordinaryRedoCount', 0, 1);
  return {
    version: 1, purpose: short(raw.purpose, 'purpose'), scope: short(raw.scope, 'scope'), successCriteria: strings(raw.successCriteria, 'successCriteria'),
    sourceRevisions, methods, currentStepId, round, facilitatorAccountId, facilitatorGeneration, participants, decisionAuthority, checks, outputs, ordinaryRedoCount,
    ...(raw.brainwritingCycle===undefined?{}:{brainwritingCycle:number(raw.brainwritingCycle,'brainwritingCycle',1,6)}),
    ...(raw.waitingReason === undefined ? {} : { waitingReason: short(raw.waitingReason, 'waitingReason') }),
    ...(raw.resumeCondition === undefined ? {} : { resumeCondition: short(raw.resumeCondition, 'resumeCondition') }),
  };
}

function arrayObjects(value: unknown, field: string, allowed: readonly string[]): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) throw guidanceError(new Error(`${field} must be an array with at most ${MAX_ARRAY_ITEMS} items`), 'guid-ce6c9d3c87a4fbc6');
  return value.map((item, index) => {
    const result = object(item, `${field}[${index}]`);
    onlyKeys(result, `${field}[${index}]`, allowed);
    return result;
  });
}
function number(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw guidanceError(new Error(`${field} must be an integer from ${minimum} to ${maximum}`), 'guid-144a3726511692e2');
  return Number(value);
}

const allowedSubmissionKeys = new Set([
  'ideaIds', 'origin', 'extension', 'challenge', 'parentIdeaIds', 'observations', 'questions', 'acknowledgement', 'checks', 'groups', 'names',
  'mapNodes', 'mapEdges', 'ballot', 'ranking', 'criteria', 'alternatives', 'evidence', 'risks', 'benefits', 'uncertainty', 'revisit',
  'adopted', 'rejected', 'minority', 'synthesis', 'participantAccounts', 'roles', 'reason', 'reviewConditions', 'mitigation', 'earlySignal',
  'ownerAction', 'timeline', 'impact', 'contributingFactors', 'helpfulResponse', 'prevention', 'experiment', 'variant', 'reducedVariant',
  'purpose', 'scope', 'outcome', 'sourceRevisions', 'failureScenario', 'constraints', 'preferences', 'operator', 'extensions',
  'unassignedIdeaIds', 'account', 'clarifications', 'causes', 'retrospectiveVariant', 'repairs', 'unresolvedExceptions', 'cycle', 'cycleMinutes',
]);
const allowedNestedKeys = new Set([
  'id', 'ideaId', 'parentIdeaId', 'alternativeId', 'fromId', 'toId', 'itemId', 'accountId', 'rank', 'type', 'label', 'title', 'status',
  'reason', 'evidence', 'actor', 'origin', 'extension', 'challenge', 'path', 'revision', 'ownerAction', 'earlySignal', 'participantAccounts',
  'members', 'name', 'value', 'criteria', 'reviewCondition', 'revisit', 'uncertainty', 'impact', 'timeline', 'mitigation',
  'riskId', 'category', 'driver', 'approver', 'contributors', 'informed',
]);
function validateNested(value: unknown, field: string, depth: number): void {
  if (depth > 4) throw guidanceError(new Error(`${field} exceeds the maximum nesting depth`), 'guid-d6c1f1449e8cb1dd');
  if (typeof value === 'string') { short(value, field); return; }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw guidanceError(new Error(`${field} has too many items`), 'guid-fe8b0f3e7e4cb65a');
    value.forEach((item, index) => validateNested(item, `${field}[${index}]`, depth + 1));
    return;
  }
  const record = object(value, field);
  if (Object.keys(record).length > 12) throw guidanceError(new Error(`${field} item is too large`), 'guid-bca0e8f6871df645');
  for (const [key, item] of Object.entries(record)) {
    if (!allowedNestedKeys.has(key)) throw guidanceError(new Error(`${field}.${key} is unknown`), 'guid-90edf474691ef287');
    if (/^(?:id|.+Id)$/u.test(key) && typeof item === 'string' && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(item)) throw guidanceError(new Error(`${field}.${key} must be a bounded identifier`), 'guid-def9217773e43a76');
    validateNested(item, `${field}.${key}`, depth + 1);
  }
}
function validateStructured(value: unknown): Record<string, unknown> {
  const structured = object(value, 'structured');
  let serialized: string;
  try { serialized = JSON.stringify(structured); } catch { throw guidanceError(new Error('structured must be JSON-serializable'), 'guid-5259a41349f41438'); }
  if (Array.from(serialized).length > 4000) throw guidanceError(new Error('structured exceeds 4000 characters'), 'guid-bce563c7572496b8');
  const keys = Object.keys(structured);
  if (!keys.length) throw guidanceError(new Error('structured must contain a bounded submission'), 'guid-590c19dba8f09c83');
  for (const key of keys) {
    if (!allowedSubmissionKeys.has(key)) throw guidanceError(new Error(`structured.${key} is unknown`), 'guid-942a7cb1aa32ff44');
    validateNested(structured[key], `structured.${key}`, 0);
  }
  return structured;
}

/** Synthesis is a cross-method output, not another submission to the last
 * method's form (a closing checklist need not be duplicated in the synthesis). */
export function validateFacilitationSynthesis(value:unknown):Record<string,unknown> {
  const result=validateStructured(value);
  if(Object.keys(result).some(k=>!['adopted','rejected','minority','uncertainty','revisit'].includes(k)))throw guidanceError(new Error('Unknown synthesis field'), 'guid-77f1b1d2b90b1247');
  for(const field of ['adopted','rejected','minority','uncertainty'])textItems(result[field],`synthesis.${field}`,true);
  short(result.revisit,'synthesis.revisit');
  return result;
}

type ContractContext = { facilitation: WorkshopFacilitation; accountId: string; step: FacilitationStep; existingSubmissions?: readonly FacilitationSubmission[] };

function items(value: unknown, field: string, allowEmpty = false): unknown[] {
  if (value === undefined) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > MAX_ARRAY_ITEMS) throw guidanceError(new Error(`${field} must be a non-empty bounded array`), 'guid-cab6bf9eff68c895');
  return value;
}
function textItems(value: unknown, field: string, allowEmpty = false): string[] {
  return items(value, field, allowEmpty).map((item, index) => short(item, `${field}[${index}]`));
}
function identifier(value: unknown, field: string): string {
  const result = short(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(result)) throw guidanceError(new Error(`${field} must be a bounded identifier`), 'guid-2e3f45d86a96375f');
  return result;
}
function record(value: unknown, field: string, allowed: readonly string[]): Record<string, unknown> {
  if (value === undefined) throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
  const result = object(value, field);
  onlyKeys(result, field, allowed);
  return result;
}
function records(value: unknown, field: string, allowed: readonly string[], allowEmpty = false): Record<string, unknown>[] {
  return items(value, field, allowEmpty).map((item, index) => record(item, `${field}[${index}]`, allowed));
}
function account(value: unknown, field: string, context: ContractContext): string {
  const result = identifier(value, field);
  if (!context.facilitation.participants.includes(result)) throw guidanceError(new Error(`${field} must name an explicitly configured actual participant account`), 'guid-8c3c16e911d3542e');
  return result;
}
function participantAccounts(value: unknown, field: string, context: ContractContext, minimum: number, allowReduced: boolean): string[] {
  const result = textItems(value, field);
  const unique = new Set(result);
  if (unique.size !== result.length) throw guidanceError(new Error(`${field} may not repeat an account`), 'guid-35198c222d59c192');
  result.forEach((item, index) => account(item, `${field}[${index}]`, context));
  if (result.length < minimum && !allowReduced) throw guidanceError(new Error(`${field} requires ${minimum} actual participant accounts`), 'guid-9b90c40dabad8c87');
  return result;
}
function exactParticipantAccounts(value: unknown, field: string, context: ContractContext, count: number, allowReduced: boolean): string[] {
  const result = participantAccounts(value, field, context, count, allowReduced);
  if (!allowReduced && result.length !== count) throw guidanceError(new Error(`${field} requires exactly ${count} actual participant accounts`), 'guid-9ccffd281bd9285d');
  return result;
}
function ideaRecords(value: unknown, field: string, parentRequired = false): string[] {
  const result = records(value, field, ['ideaId', 'origin', 'parentIdeaId', 'extension', 'challenge']);
  const ids = result.map((item, index) => {
    const id = identifier(item.ideaId, `${field}[${index}].ideaId`);
    short(item.origin, `${field}[${index}].origin`);
    if (parentRequired) {
      identifier(item.parentIdeaId, `${field}[${index}].parentIdeaId`);
      short(item.extension, `${field}[${index}].extension`);
    }
    if (item.challenge !== undefined) short(item.challenge, `${field}[${index}].challenge`);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw guidanceError(new Error(`${field} may not repeat an idea ID`), 'guid-bb2b40f19de85838');
  return ids;
}
function linkedRecords(value: unknown, field: string, idField: 'alternativeId' | 'riskId', extraField = 'value'): void {
  for (const [index, item] of records(value, field, [idField, extraField, 'reason']).entries()) {
    identifier(item[idField], `${field}[${index}].${idField}`);
    short(item[extraField], `${field}[${index}].${extraField}`);
    if (item.reason !== undefined) short(item.reason, `${field}[${index}].reason`);
  }
}
function validateSourcePins(value: unknown, field: string, context: ContractContext): void {
  const configured = new Set(context.facilitation.sourceRevisions.map(source => JSON.stringify([source.path, source.revision])));
  for (const [index, item] of records(value, field, ['path', 'revision']).entries()) {
    const path = short(item.path, `${field}[${index}].path`);
    const revision = short(item.revision, `${field}[${index}].revision`);
    if (!revisionPattern.test(revision) || !configured.has(JSON.stringify([path, revision]))) throw guidanceError(new Error(`${field} must pin a configured current source revision`), 'guid-8d41ac65f61e63fb');
  }
}
function validateAcknowledgement(value: unknown, context: ContractContext): void {
  const acknowledgement = record(value, 'acknowledgement', ['path', 'revision', 'accountId']);
  const path = short(acknowledgement.path, 'acknowledgement.path');
  const revision = short(acknowledgement.revision, 'acknowledgement.revision');
  if (!context.facilitation.sourceRevisions.some(source => source.path === path && source.revision === revision)) throw guidanceError(new Error('acknowledgement must name a configured current source revision'), 'guid-787316d1b5a8faaf');
  if (account(acknowledgement.accountId, 'acknowledgement.accountId', context) !== context.accountId) throw guidanceError(new Error('acknowledgement must be made by the authenticated submitting account'), 'guid-ab0b8df9a76802d7');
}
function validateOwnerAction(value: unknown, field: string, context: ContractContext): void {
  const action = record(value, field, ['accountId', 'value']);
  account(action.accountId, `${field}.accountId`, context);
  short(action.value, `${field}.value`);
}
function validateBallot(value: unknown, field: string, idField: 'alternativeId' | 'riskId' = 'alternativeId'): string[] {
  const alternatives = new Set<string>();
  for (const [index, entry] of records(value, field, [idField, 'rank']).entries()) {
    const alternative = identifier(entry[idField], `${field}[${index}].${idField}`);
    if (alternatives.has(alternative)) throw guidanceError(new Error('Duplicate ballot alternative'), 'guid-6830f4cf6383b998');
    alternatives.add(alternative);
    number(entry.rank, `${field}[${index}].rank`, 1, MAX_ARRAY_ITEMS);
  }
  return [...alternatives];
}
function frozenAlternativeIds(submissions: readonly FacilitationSubmission[] | undefined): Set<string> {
  let fingerprint: string | undefined;
  let ids = new Set<string>();
  for (const submission of submissions || []) {
    if (submission.stepId !== 'dot-voting-freeze' || !Array.isArray(submission.structured.alternatives)) continue;
    const alternatives: Array<[string, string]> = [];
    for (const item of submission.structured.alternatives) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.label === 'string') alternatives.push([record.id, record.label]);
    }
    const candidate = JSON.stringify({ alternatives, criteria: Array.isArray(submission.structured.criteria) ? submission.structured.criteria : [] });
    if (fingerprint !== undefined && fingerprint !== candidate) throw guidanceError(new Error('Frozen alternatives conflict and cannot be changed or unioned silently'), 'guid-3c767edba72d0c25');
    fingerprint = candidate;
    ids = new Set(alternatives.map(([id]) => id));
  }
  return ids;
}
function validateChecklist(value: unknown, context: ContractContext): void {
  const ids = new Set<string>();
  for (const [index, check] of records(value, 'checks', ['itemId', 'status', 'evidence', 'reason', 'actor']).entries()) {
    const itemId = identifier(check.itemId, `checks[${index}].itemId`);
    if (ids.has(itemId)) throw guidanceError(new Error('Duplicate checklist item'), 'guid-092eef0ce7d1ab55');
    ids.add(itemId);
    const status = short(check.status, `checks[${index}].status`);
    if (!['unknown', 'pass', 'fail', 'not_applicable'].includes(status)) throw guidanceError(new Error('Invalid checklist status'), 'guid-a43338a70349d533');
    if (account(check.actor, `checks[${index}].actor`, context) !== context.accountId) throw guidanceError(new Error('Checklist actor must be the authenticated submitting account'), 'guid-ada649e5e91a5f9a');
    short(check.reason, `checks[${index}].reason`);
    short(check.evidence, `checks[${index}].evidence`);
  }
}
function validateStepContract(structured: Record<string, unknown>, context: ContractContext): void {
  const stepId = context.step.id;
  const requireText = (key: string) => {
    if (structured[key] === undefined) throw guidanceError(new Error(`structured.${key} is required`), 'guid-12f41ff704e194e5');
    return short(structured[key], `structured.${key}`);
  };
  const requireTexts = (key: string, allowEmpty = false) => textItems(structured[key], `structured.${key}`, allowEmpty);
  switch (stepId) {
    case 'page-led-frame':
      requireText('purpose'); requireText('scope'); requireText('outcome'); requireTexts('questions'); validateSourcePins(structured.sourceRevisions, 'structured.sourceRevisions', context); break;
    case 'page-led-read': validateAcknowledgement(structured.acknowledgement, context); break;
    case 'page-led-discuss': requireTexts('observations'); requireText('extension'); requireText('challenge'); break;
    case 'checklist-prepare': case 'checklist-progress': case 'checklist-close': {
      validateChecklist(structured.checks, context);
      const open = (structured.checks as unknown[]).some(item => ['unknown', 'fail'].includes(String((item as Record<string, unknown>).status)));
      if (open && stepId === 'checklist-close' && structured.repairs === undefined && structured.unresolvedExceptions === undefined) throw guidanceError(new Error('Closing checklist exceptions require typed repairs or unresolvedExceptions'), 'guid-84504e370128d7ce');
      if (structured.repairs !== undefined) records(structured.repairs, 'structured.repairs', ['itemId', 'ownerAction', 'reason']).forEach((repair, index) => {
        identifier(repair.itemId, `structured.repairs[${index}].itemId`);
        validateOwnerAction(repair.ownerAction, `structured.repairs[${index}].ownerAction`, context);
        short(repair.reason, `structured.repairs[${index}].reason`);
      });
      if (structured.unresolvedExceptions !== undefined) requireTexts('unresolvedExceptions');
      break;
    }
    case 'how-might-we-observe': requireTexts('observations'); requireTexts('evidence'); break;
    case 'how-might-we-question': requireTexts('questions'); break;
    case 'how-might-we-refine': requireTexts('questions'); requireText('challenge'); break;
    case 'brainwriting-independent': {
      const variant = short(structured.variant, 'structured.variant');
      if (!['6-3-5', 'async', 'small-group'].includes(variant)) throw guidanceError(new Error('Brainwriting requires an honest 6-3-5, async, or small-group variant'), 'guid-f0fda2975c9f7bee');
      const ids = ideaRecords(structured.ideaIds, 'structured.ideaIds');
      if (variant === '6-3-5') {
        if (ids.length !== 3) throw guidanceError(new Error('6-3-5 requires exactly three independent ideas per actual account'), 'guid-9aa24d945c0f7cdc');
        if (number(structured.cycle, 'structured.cycle', 1, 6) !== (context.facilitation.brainwritingCycle??1)) throw guidanceError(new Error('6-3-5 cycle must match the current method cycle'), 'guid-cd30b929619abcb0');
        if (number(structured.cycleMinutes, 'structured.cycleMinutes', 5, 5) !== 5) throw guidanceError(new Error('6-3-5 requires an explicit five-minute cycle'), 'guid-cb0db8e0caef9b31');
      }
      break;
    }
    case 'brainwriting-build': {
      const ideas=ideaRecords(structured.ideaIds, 'structured.ideaIds', true); requireText('extension'); requireTexts('parentIdeaIds');
      if((context.facilitation.brainwritingCycle??1)>1||structured.variant==='6-3-5') {
        const cycle=context.facilitation.brainwritingCycle??1;
        if(structured.variant!=='6-3-5'||structured.cycle!==cycle||structured.cycleMinutes!==5||ideas.length!==3)throw guidanceError(new Error('6-3-5 requires three ideas and explicit current five-minute cycle'), 'guid-4d18446c4727cfc3');
        const previous=(context.existingSubmissions??[]).filter(s=>s.structured.variant==='6-3-5'&&s.structured.cycle===cycle-1&&s.accountId!==context.accountId);
        const parents=new Set(previous.flatMap(s=>Array.isArray(s.structured.ideaIds)?s.structured.ideaIds.map((i:any)=>i.ideaId):[]));
        if((structured.ideaIds as any[]).some(i=>!parents.has(i.parentIdeaId)))throw guidanceError(new Error('6-3-5 builds on actual peers from the immediately previous cycle'), 'guid-a2eaa2e3182fe943');
      }
      break;
    }
    case 'six-hats-setup': requireTexts('questions'); requireTexts('constraints'); break;
    case 'six-hats-information': requireTexts('evidence'); requireTexts('uncertainty'); break;
    case 'six-hats-alternatives': ideaRecords(structured.ideaIds, 'structured.ideaIds'); break;
    case 'six-hats-benefits': linkedRecords(structured.benefits, 'structured.benefits', 'alternativeId'); break;
    case 'six-hats-risks': linkedRecords(structured.risks, 'structured.risks', 'alternativeId'); requireText('challenge'); break;
    case 'six-hats-intuition': requireTexts('preferences'); requireTexts('uncertainty'); break;
    case 'six-hats-synthesis': requireTexts('adopted'); requireTexts('rejected'); requireTexts('minority'); requireTexts('uncertainty'); requireText('revisit'); break;
    case 'scamper-substitute': case 'scamper-combine': case 'scamper-adapt': case 'scamper-modify': case 'scamper-other-use': case 'scamper-eliminate': case 'scamper-reverse':
      if (short(structured.operator, 'structured.operator') !== stepId.slice('scamper-'.length)) throw guidanceError(new Error('SCAMPER operator must match the current method step'), 'guid-13ad3171d4dfeaad');
      ideaRecords(structured.ideaIds, 'structured.ideaIds', true); requireTexts('parentIdeaIds'); break;
    case 'crazy8s-eight': if (ideaRecords(structured.ideaIds, 'structured.ideaIds').length !== 8) throw guidanceError(new Error('Crazy 8s requires exactly eight distinct idea IDs'), 'guid-008cd897ffc0451c'); break;
    case 'crazy8s-select': validateBallot(structured.ranking, 'structured.ranking'); requireTexts('criteria'); requireText('reason'); break;
    case '1-2-4-all-one': ideaRecords(structured.ideaIds, 'structured.ideaIds'); break;
    case '1-2-4-all-two': requireTexts('extensions'); exactParticipantAccounts(structured.participantAccounts, 'structured.participantAccounts', context, 2, structured.reducedVariant !== undefined); if (structured.reducedVariant !== undefined) requireText('reducedVariant'); break;
    case '1-2-4-all-four': requireText('synthesis'); exactParticipantAccounts(structured.participantAccounts, 'structured.participantAccounts', context, 4, structured.reducedVariant !== undefined); if (structured.reducedVariant !== undefined) requireText('reducedVariant'); break;
    case '1-2-4-all-all': requireText('synthesis'); requireTexts('minority'); requireTexts('uncertainty'); participantAccounts(structured.participantAccounts, 'structured.participantAccounts', context, 2, structured.reducedVariant !== undefined); if (structured.reducedVariant !== undefined) requireText('reducedVariant'); break;
    case 'affinity-kj-collect': ideaRecords(structured.ideaIds, 'structured.ideaIds'); break;
    case 'affinity-kj-group': {
      const groups = records(structured.groups, 'structured.groups', ['id', 'members']);
      const groupIds = groups.map((group, index) => identifier(group.id, `structured.groups[${index}].id`));
      if (new Set(groupIds).size !== groupIds.length) throw guidanceError(new Error('Affinity groups may not repeat a group ID'), 'guid-3d38a39b46812201');
      groups.forEach((group, index) => textItems(group.members, `structured.groups[${index}].members`));
      textItems(structured.unassignedIdeaIds, 'structured.unassignedIdeaIds', true);
      break;
    }
    case 'affinity-kj-name': records(structured.names, 'structured.names', ['id', 'name', 'members']).forEach((name, index) => { identifier(name.id, `structured.names[${index}].id`); short(name.name, `structured.names[${index}].name`); textItems(name.members, `structured.names[${index}].members`); }); requireTexts('uncertainty'); break;
    case 'mind-map-root': requireTexts('questions'); break;
    case 'mind-map-branches': records(structured.mapNodes, 'structured.mapNodes', ['id', 'type', 'label']).forEach((node, index) => { identifier(node.id, `structured.mapNodes[${index}].id`); if (!['question', 'alternative', 'constraint', 'evidence'].includes(short(node.type, `structured.mapNodes[${index}].type`))) throw guidanceError(new Error('Mind-map node type is invalid'), 'guid-988d8dcfbdb351ec'); short(node.label, `structured.mapNodes[${index}].label`); }); break;
    case 'mind-map-crosslinks': records(structured.mapEdges, 'structured.mapEdges', ['fromId', 'toId', 'reason']).forEach((edge, index) => { const from = identifier(edge.fromId, `structured.mapEdges[${index}].fromId`); const to = identifier(edge.toId, `structured.mapEdges[${index}].toId`); if (from === to) throw guidanceError(new Error('Mind-map edge endpoints must differ'), 'guid-f6bb2137a25f5809'); short(edge.reason, `structured.mapEdges[${index}].reason`); }); break;
    case 'ngt-independent': ideaRecords(structured.ideaIds, 'structured.ideaIds'); break;
    case 'ngt-roundrobin': ideaRecords(structured.ideaIds, 'structured.ideaIds'); if (account(structured.account, 'structured.account', context) !== context.accountId) throw guidanceError(new Error('NGT round-robin account must be the authenticated submitting account'), 'guid-8ff74bdaa26f8331'); break;
    case 'ngt-clarify': requireTexts('questions'); requireTexts('clarifications'); break;
    case 'ngt-rank': validateBallot(structured.ballot, 'structured.ballot'); requireText('ranking'); requireText('reason'); break;
    case 'dot-voting-freeze': records(structured.alternatives, 'structured.alternatives', ['id', 'label']).forEach((alternative, index) => { identifier(alternative.id, `structured.alternatives[${index}].id`); short(alternative.label, `structured.alternatives[${index}].label`); }); requireTexts('criteria'); break;
    case 'dot-voting-vote': {
      const frozen = frozenAlternativeIds(context.existingSubmissions);
      if (!frozen.size) throw guidanceError(new Error('Dot voting requires frozen alternatives before any ballot'), 'guid-795e92306b2cdaa9');
      for (const alternative of validateBallot(structured.ballot, 'structured.ballot')) if (!frozen.has(alternative)) throw guidanceError(new Error('Dot-voting ballot alternatives must come from the frozen alternatives'), 'guid-1100c20c161b8dfc');
      requireText('ranking'); break;
    }
    case 'daci-roles': {
      const roles = record(structured.roles, 'structured.roles', ['driver', 'approver', 'contributors', 'informed']);
      account(roles.driver, 'structured.roles.driver', context); account(roles.approver, 'structured.roles.approver', context); participantAccounts(roles.contributors, 'structured.roles.contributors', context, 1, false); participantAccounts(roles.informed, 'structured.roles.informed', context, 1, false); break;
    }
    case 'daci-alternatives': records(structured.alternatives, 'structured.alternatives', ['id', 'label']).forEach((alternative, index) => { identifier(alternative.id, `structured.alternatives[${index}].id`); short(alternative.label, `structured.alternatives[${index}].label`); }); requireTexts('evidence'); break;
    case 'daci-reason': requireText('reason'); requireTexts('uncertainty'); requireTexts('minority'); break;
    case 'daci-review': requireTexts('reviewConditions'); requireText('revisit'); break;
    case 'premortem-failure': requireText('failureScenario'); break;
    case 'premortem-causes': requireTexts('causes'); requireTexts('evidence'); break;
    case 'premortem-prioritize': validateBallot(structured.ranking, 'structured.ranking', 'riskId'); linkedRecords(structured.risks, 'structured.risks', 'riskId'); requireText('reason'); break;
    case 'premortem-mitigate': requireText('mitigation'); requireText('earlySignal'); validateOwnerAction(structured.ownerAction, 'structured.ownerAction', context); break;
    case 'retrospective-observe': {
      const variant = short(structured.retrospectiveVariant, 'structured.retrospectiveVariant');
      const expected = variant === 'start-stop-continue' ? ['start', 'stop', 'continue'] : variant === '4ls' ? ['liked', 'learned', 'lacked', 'longed-for'] : [];
      if (!expected.length) throw guidanceError(new Error('Retrospective variant must be start-stop-continue or 4ls'), 'guid-53c5c9017e90fc8d');
      const categories = records(structured.observations, 'structured.observations', ['category', 'value']).map((item, index) => { const category = short(item.category, `structured.observations[${index}].category`); short(item.value, `structured.observations[${index}].value`); return category; });
      if (expected.some(category => !categories.includes(category))) throw guidanceError(new Error('Retrospective observations must preserve every category in the chosen variant'), 'guid-796f692c6051b15d');
      break;
    }
    case 'retrospective-experiment': requireText('experiment'); validateOwnerAction(structured.ownerAction, 'structured.ownerAction', context); requireTexts('reviewConditions'); break;
    case 'blameless-postmortem-timeline': records(structured.timeline, 'structured.timeline', ['id', 'value']).forEach((item, index) => { identifier(item.id, `structured.timeline[${index}].id`); short(item.value, `structured.timeline[${index}].value`); }); requireText('impact'); break;
    case 'blameless-postmortem-factors': requireTexts('contributingFactors'); requireTexts('helpfulResponse'); break;
    case 'blameless-postmortem-prevention': requireText('prevention'); validateOwnerAction(structured.ownerAction, 'structured.ownerAction', context); requireTexts('reviewConditions'); break;
    default: throw guidanceError(new Error(`No structured method contract is registered for ${stepId}`), 'guid-c976e2062815b68d');
  }
}

export function validateFacilitationCompletion(facilitation: WorkshopFacilitation, submissions: readonly FacilitationSubmission[]): FacilitationCompletion {
  const step = currentStep(facilitation.methods, facilitation.currentStepId);
  const current = submissions.filter(item => item.stepId === step.id && facilitation.participants.includes(item.accountId) && ((facilitation.brainwritingCycle??1)<=1||!step.id.startsWith('brainwriting-')||item.structured.cycle===facilitation.brainwritingCycle));
  const unmet: string[] = [];
  let minimumAccounts = step.minimumAccounts || 1;
  if(step.id==='brainwriting-build'&&(facilitation.brainwritingCycle??1)>1)minimumAccounts=6;
  if (step.id === 'brainwriting-independent') {
    const variants = new Set(current.map(item => item.structured.variant));
    if (variants.size !== 1) unmet.push('one honest brainwriting variant for the round');
    if (variants.has('6-3-5')) minimumAccounts = 6;
  }
  if ((step.id === '1-2-4-all-two' || step.id === '1-2-4-all-four') && current.some(item => typeof item.structured.reducedVariant === 'string' && item.structured.reducedVariant.trim())) minimumAccounts = 1;
  if (step.id === 'dot-voting-vote' && !frozenAlternativeIds(submissions).size) unmet.push('frozen alternatives');
  const accounts = new Set(current.map(item => item.accountId));
  if (accounts.size < minimumAccounts) unmet.push(`${minimumAccounts - accounts.size} additional actual participant account(s)`);
  return { complete: unmet.length === 0, unmet, ...(minimumAccounts !== (step.minimumAccounts || 1) ? { minimumAccounts } : {}) };
}

export function validateFacilitationSubmission(facilitation: WorkshopFacilitation, params: {
  accountId: string; stepId: string; workshopRevision: string; structured: unknown; existingSubmissions?: readonly FacilitationSubmission[]; prerequisiteCoverage?: readonly WorkshopLineagePrerequisiteCoverage[];
}): { structured: Record<string, unknown>; ballotAccountId?: string; requiredPrerequisiteStepIds: readonly string[] } {
  const accountId = short(params.accountId, 'accountId');
  const stepId = short(params.stepId, 'stepId');
  if(facilitation.waitingReason)throw guidanceError(new Error('Workshop is paused; explicit resume is required'), 'guid-8401b5cad08fa3df');
  if (!facilitation.participants.includes(accountId)) throw guidanceError(new Error('Only an explicitly configured participant account may submit to managed facilitation'), 'guid-9672d34cd4a91774');
  if (!revisionPattern.test(params.workshopRevision)) throw guidanceError(new Error('workshopRevision must be the exact current SHA-256 revision'), 'guid-3195efdba789fbe7');
  if (stepId !== facilitation.currentStepId) throw guidanceError(new Error('This submission targets a stale or different facilitation step'), 'guid-a3b666168459a262');
  const step = currentStep(facilitation.methods, stepId);
  const structured = validateStructured(params.structured);
  if(stepId.startsWith('brainwriting-')&&structured.variant==='6-3-5') {
    if(facilitation.participants.length!==6)throw guidanceError(new Error('6-3-5 requires exactly six configured actual accounts; choose an honest adaptation otherwise'), 'guid-74824bad6bb7018b');
    if((params.existingSubmissions??[]).some(s=>s.accountId===accountId&&s.stepId===stepId&&s.structured.cycle===structured.cycle))throw guidanceError(new Error('One three-idea submission per actual account per method cycle'), 'guid-78ec846a3e0d9d9d');
  }
  validateStepContract(structured, { facilitation, accountId, step, ...(params.existingSubmissions && { existingSubmissions: params.existingSubmissions }) });
  const lineage = validateWorkshopLineage({ stepId, structured, participants: facilitation.participants, ...(params.existingSubmissions&&{priorSubmissions:params.existingSubmissions}), ...(params.prerequisiteCoverage&&{prerequisiteCoverage:params.prerequisiteCoverage}) });
  if (structured.checks !== undefined) {
    if (!Array.isArray(structured.checks) || !structured.checks.length) throw guidanceError(new Error('This facilitation step requires typed checks'), 'guid-6e6c7cb702fdd4ec');
    const ids = new Set<string>();
    for (const value of structured.checks) {
      const check = object(value, 'check');
      const itemId = short(check.itemId, 'check.itemId');
      if (ids.has(itemId)) throw guidanceError(new Error('Duplicate checklist item'), 'guid-092eef0ce7d1ab55');
      ids.add(itemId);
      if (!['unknown', 'pass', 'fail', 'not_applicable'].includes(String(check.status))) throw guidanceError(new Error('Invalid checklist status'), 'guid-a43338a70349d533');
      if (check.actor !== accountId) throw guidanceError(new Error('Checklist actor must be the authenticated submitting account'), 'guid-ada649e5e91a5f9a');
      short(check.reason, 'check.reason');
      short(check.evidence, 'check.evidence');
    }
  }
  if (step.id === 'dot-voting-vote' || step.id === 'ngt-rank') {
    if (!Array.isArray(structured.ballot) || !structured.ballot.length) throw guidanceError(new Error('A ranking ballot is required'), 'guid-a54eadf1f3762cc9');
    const alternatives = new Set<string>();
    for (const value of structured.ballot) {
      const entry = object(value, 'ballot entry');
      const alternative = short(entry.alternativeId, 'ballot.alternativeId');
      if (alternatives.has(alternative)) throw guidanceError(new Error('Duplicate ballot alternative'), 'guid-6830f4cf6383b998');
      alternatives.add(alternative);
      number(entry.rank, 'ballot.rank', 1, MAX_ARRAY_ITEMS);
    }
    if ((params.existingSubmissions || []).some(item => item.accountId === accountId && item.stepId === stepId)) throw guidanceError(new Error('Only one ballot per authenticated account is allowed for this step'), 'guid-7585b7321a7bcf02');
    return { structured, ballotAccountId: accountId, ...lineage };
  }
  return { structured, ...lineage };
}

/** The service must read only these chronological step slices before validation. */
export { workshopLineagePrerequisites, type WorkshopLineagePrerequisiteCoverage };

export function nextFacilitationAction(facilitation: WorkshopFacilitation, submissions: readonly FacilitationSubmission[]): {
  kind: 'submit' | 'wait' | 'advance' | 'record_output'; stepId: string; required: string[]; finishCondition: string; adaptation: string; resumeCondition?: string;
} {
  const step = currentStep(facilitation.methods, facilitation.currentStepId);
  if(facilitation.waitingReason)return {kind:'wait',stepId:step.id,required:[],finishCondition:step.finishCondition,adaptation:step.adaptation,resumeCondition:facilitation.resumeCondition||facilitation.waitingReason};
  const current = submissions.filter(item => item.stepId === step.id && facilitation.participants.includes(item.accountId) && ((facilitation.brainwritingCycle??1)<=1||!step.id.startsWith('brainwriting-')||item.structured.cycle===facilitation.brainwritingCycle));
  // The service supplies chronological, validated submissions. A later explicit
  // report by the same account repairs its own item, never another account's.
  const latestChecks = new Map<string, unknown>();
  for (const item of current) {
    if (!Array.isArray(item.structured.checks)) continue;
    for (const check of item.structured.checks) {
      const value = check && typeof check === 'object' ? check as Record<string, unknown> : {};
      latestChecks.set(JSON.stringify([item.accountId, value.itemId]), value.status);
    }
  }
  const unresolved = [...latestChecks.values()].some(status => !['pass', 'not_applicable'].includes(String(status)));
  if (unresolved) return { kind: 'wait', stepId: step.id, required: step.required.slice(), finishCondition: step.finishCondition, adaptation: step.adaptation, resumeCondition: 'Resolve unknown/failed checklist items; their presence is not completion evidence.' };
  const accounts = new Set(current.map(item => item.accountId));
  const completion = validateFacilitationCompletion(facilitation, submissions);
  const minimum = completion.minimumAccounts || step.minimumAccounts || 1;
  if (accounts.size < minimum) {
    if (accounts.size > 0 && minimum > 1) return {
      kind: 'wait', stepId: step.id, required: ['structured submission'], finishCondition: step.finishCondition, adaptation: step.adaptation,
      resumeCondition: completion.unmet.join('; ') || `${minimum - accounts.size} additional actual participant account(s), or an explicit reduced variant`,
    };
    return { kind: 'submit', stepId: step.id, required: ['structured submission', ...step.required], finishCondition: step.finishCondition, adaptation: step.adaptation };
  }
  if (!completion.complete) return { kind: 'wait', stepId: step.id, required: step.required.slice(), finishCondition: step.finishCondition, adaptation: step.adaptation, resumeCondition: completion.unmet.join('; ') };
  const cycling=step.id==='brainwriting-build'&&(facilitation.brainwritingCycle??1)>1&&facilitation.brainwritingCycle!<6;
  const final = !cycling&&facilitation.methods.flatMap(method => method.steps).at(-1)?.id === step.id;
  return { kind: final ? 'record_output' : 'advance', stepId: step.id, required: step.required.slice(), finishCondition: step.finishCondition, adaptation: step.adaptation };
}

export function advanceFacilitation(facilitation: WorkshopFacilitation, reason: string, submissions:readonly FacilitationSubmission[]=[]): WorkshopFacilitation {
  short(reason, 'reason');
  if(facilitation.currentStepId==='brainwriting-independent'&&submissions.some(s=>s.stepId===facilitation.currentStepId&&s.structured.variant==='6-3-5')) {
    if(!validateFacilitationCompletion(facilitation,submissions).complete)throw guidanceError(new Error('Six actual accounts must complete the cycle'), 'guid-1f7e308ec37cbd19');
    return {...facilitation,currentStepId:'brainwriting-build',brainwritingCycle:2};
  }
  if(facilitation.currentStepId==='brainwriting-build'&&(facilitation.brainwritingCycle??1)>1&&facilitation.brainwritingCycle!<6) {
    if(!validateFacilitationCompletion(facilitation,submissions).complete)throw guidanceError(new Error('Six actual accounts must complete the cycle'), 'guid-1f7e308ec37cbd19');
    return {...facilitation,brainwritingCycle:facilitation.brainwritingCycle!+1};
  }
  const all = facilitation.methods.flatMap(methodState => methodState.steps);
  const index = all.findIndex(step => step.id === facilitation.currentStepId);
  if (index < 0) throw guidanceError(new Error('currentStepId is unavailable'), 'guid-4417164e11aafd73');
  const next = all[index + 1];
  if (!next) throw guidanceError(new Error('All facilitation steps are complete; record an output instead of advancing'), 'guid-c5f6235804796ec4');
  const resumed = { ...facilitation };
  delete resumed.waitingReason;
  delete resumed.resumeCondition;
  return { ...resumed, currentStepId: next.id };
}

export function managedFacilitationMarkdown(facilitation: WorkshopFacilitation): string {
  const current = currentStep(facilitation.methods, facilitation.currentStepId);
  return [
    '## Managed facilitation',
    `- Purpose: ${facilitation.purpose}`,
    `- Scope: ${facilitation.scope}`,
    `- Current step: ${current.id} — ${current.title}`,
    `- Finish condition: ${current.finishCondition}`,
    `- Adaptation: ${current.adaptation}`,
    ...(facilitation.waitingReason ? [`- Waiting: ${facilitation.waitingReason}`] : []),
    ...(facilitation.resumeCondition ? [`- Resume when: ${facilitation.resumeCondition}`] : []),
  ].join('\n');
}
