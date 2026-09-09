import { guidanceError } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';
import { STORY_KINDS, STORY_LAYERS } from './story-model.js';

type Schema = Record<string, any>;
const text = (maxLength: number, minLength = 0): Schema => ({ type: 'string', minLength, maxLength });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, ...(required.length && { required }) });
const array = (items: Schema, maxItems: number): Schema => ({ type: 'array', items, maxItems });
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum });
const id = { ...text(64, 1), pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
const account = { ...text(64, 1), pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' };
const revision = { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 };
const branchId = { ...id, default: 'main' };
const ids = (max = 100) => ({ ...array(id, max), uniqueItems: true });
const selectedEvents = { ...ids(32), minItems: 1 };
const visualIntent: Schema = { oneOf: [
  object({ type: { const: 'move_entity' }, eventIds: selectedEvents, actorId: id, locationId: id }, ['type', 'eventIds', 'actorId', 'locationId']),
  object({ type: { const: 'set_action' }, eventIds: selectedEvents, action: text(300, 1) }, ['type', 'eventIds', 'action']),
  object({ type: { const: 'reorder_events' }, eventIds: { ...selectedEvents, minItems: 2 } }, ['type', 'eventIds']),
] };
const visual = object({ events: array(object({ id, actorId: id, targetId: id, locationId: id, action: text(300, 1),
  basis: enumeration('stated', 'inferred', 'uncertain'),
  passage: object({ start: integer(0, 20000), end: integer(1, 20000), quote: text(2000, 1) }, ['start', 'end', 'quote']),
}, ['id', 'actorId', 'action', 'basis', 'passage']), 64) }, ['events']);
const visualProposal = object({ modelId: id, modelRevision: revision, intent: visualIntent, fingerprint: revision, projectRevision: revision, actorAccountId: account,
  changes: array(object({ eventId: id, start: integer(0, 20000), end: integer(1, 20000), before: text(2000, 1), after: text(20000) },
    ['eventId', 'start', 'end', 'before', 'after']), 32),
}, ['modelId', 'modelRevision', 'intent', 'fingerprint', 'projectRevision', 'actorAccountId', 'changes']);
const branchKey = { ...text(128, 1), pattern: '^(?!\\s)(?!.*\\s$)[^\\u0000-\\u001f\\u007f]+$' };
const branchValue = { anyOf: [{ type: 'boolean' }, { type: 'number' }, text(4096)] };
const graph = object({
  revision: branchKey, startNodeId: branchKey,
  variables: array(object({ id: branchKey, type: enumeration('boolean', 'number', 'string'), initialValue: branchValue }, ['id', 'type', 'initialValue']), 128),
  nodes: { ...array(object({ id: branchKey, end: { type: 'boolean' }, choices: array(object({
    id: branchKey, label: text(1024, 1), targetId: branchKey,
    conditions: array(object({ variableId: branchKey, operator: enumeration('eq', 'ne', 'gt', 'gte', 'lt', 'lte'), value: branchValue }, ['variableId', 'operator', 'value']), 32),
    effects: array(object({ variableId: branchKey, operation: enumeration('set', 'add'), value: branchValue }, ['variableId', 'operation', 'value']), 32),
  }, ['id', 'label', 'targetId']), 64) }, ['id', 'choices']), 256), minItems: 1 },
}, ['revision', 'startNodeId', 'variables', 'nodes']);
const data = object({
  ...Object.fromEntries(['purpose', 'pov', 'tension', 'startState', 'endState', 'reveal', 'targetLength', 'chronologyLabel', 'camera', 'action', 'dialogue', 'sound'].map(key => [key, text(2000)])),
  knownBy: ids(32), setupIds: ids(32), payoffIds: ids(32), layer: enumeration(...STORY_LAYERS),
  sourceSceneId: id, sourceSceneRevision: revision,
  order: integer(0, 1000000), durationSeconds: { type: 'number', minimum: 0, maximum: 86400 },
  blocks: array(object({ type: enumeration('heading', 'action', 'character', 'dialogue', 'transition'), text: text(8000, 1) }, ['type', 'text']), 200),
  images: array(object({ path: text(500, 1), revision }, ['path']), 12), graph, visual, visualProposal,
});
const common = {
  projectId: id, requestId: id,
  expectedRevision: { type: 'string', pattern: '^(missing|[a-f0-9]{64})$', maxLength: 64 }, expectedProjectRevision: revision,
  maxChars: { ...integer(512, 12000), default: 4000 }, limit: { ...integer(1, 100), default: 20 }, cursor: text(1000),
  field: { ...text(51, 1), pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,50}$' }, accessToken: text(4096, 1),
};

/** Shared operation table drives dispatch aliases and advisory discovery. */
export const STORY_OPERATIONS: Record<string, { tool: string; defaultOp: string; reads: readonly string[]; writes: readonly string[] }> = {
  project: { tool: 'manage_story_project', defaultOp: 'read', reads: ['read'], writes: ['create', 'update'] },
  artifact: { tool: 'manage_story_artifact', defaultOp: 'read', reads: ['read', 'list'], writes: ['create', 'update'] },
  sequence: { tool: 'manage_story_sequence', defaultOp: 'read', reads: ['read'], writes: ['update'] },
  context: { tool: 'read_story_context', defaultOp: 'read', reads: ['read'], writes: [] },
  review: { tool: 'manage_story_review', defaultOp: 'read', reads: ['read', 'list'], writes: ['create'] },
  adopt: { tool: 'adopt_story_artifact', defaultOp: 'adopt', reads: [], writes: ['adopt'] },
  session: { tool: 'manage_story_session', defaultOp: 'read', reads: ['read', 'list'], writes: ['start', 'submit', 'review', 'pause', 'resume', 'decide', 'rehearse'] },
  export: { tool: 'manage_story_export', defaultOp: 'preview', reads: ['read', 'preview', 'health'], writes: ['write'] },
  visual: { tool: 'manage_story_visual', defaultOp: 'read', reads: ['read', 'preview'], writes: ['propose'] },
};
export const STORY_MUTATING_TOOLS = new Set(Object.values(STORY_OPERATIONS).filter(spec => spec.writes.length).map(spec => spec.tool));
export function storyReadAlias(tool: string, op: unknown): string | undefined {
  const entry = Object.entries(STORY_OPERATIONS).find(([, spec]) => spec.tool === tool);
  if (!entry || !STORY_MUTATING_TOOLS.has(tool)) return;
  const [endpoint, spec] = entry;
  if (spec.reads.includes(op === undefined ? spec.defaultOp : op as string)) return `read_story_${endpoint}`;
  return undefined;
}
export function storyEndpointForTool(tool: string): string | undefined {
  return Object.keys(STORY_OPERATIONS).find(endpoint => STORY_OPERATIONS[endpoint]!.tool === tool
    || (STORY_OPERATIONS[endpoint]!.reads.length > 0 && tool === `read_story_${endpoint}`));
}
export function assertStoryOperation(endpoint: string, op: unknown): void {
  const spec = STORY_OPERATIONS[endpoint]!;
  if (![...spec.reads, ...spec.writes].includes(op === undefined ? spec.defaultOp : op as string)) throw guidanceError(new Error('Invalid story operation'), 'guid-890b48acb1c3dfa8');
}

const fields: Record<string, Record<string, Schema>> = {
  project: { title: text(180, 1), brief: object({ medium: enumeration('novel', 'screenplay', 'interactive'),
    ...Object.fromEntries(['audience', 'genre', 'theme', 'style', 'targetLength'].map(key => [key, text(1000)])), forbidden: array(text(200, 1), 20) }, ['medium']),
    participants: array(account, 50), showrunnerAccountId: account, enabled: { type: 'boolean' }, maxSteps: integer(1, 128) },
  artifact: { artifactId: id, kind: enumeration(...STORY_KINDS), title: text(180, 1), content: text(20000), branchId, data,
    sources: array(object({ artifactId: id, revision }, ['artifactId', 'revision']), 32), references: array(text(500, 1), 50) },
  sequence: { branchId, presentation: ids(), chronology: ids(), shots: ids() },
  context: { branchId, artifactId: id, characterId: id, query: text(500) },
  review: { reviewId: id, artifactId: id, branchId, sourceRevision: revision, content: text(12000, 1),
    findings: array(object({ classification: enumeration('confirmed_conflict', 'possible_conflict', 'intentional_exception', 'unknown', 'suggestion'), text: text(2000, 1) }, ['classification', 'text']), 20),
    pass: { ...enumeration('structure', 'line', 'continuity', 'reader'), default: 'structure' } },
  adopt: { artifactId: id, sourceRevision: revision, reviewIds: ids(8), reason: text(2000, 1) },
  session: { sessionId: id, artifactId: id, writerAccountId: account, editorAccountId: account, sourceRevision: revision, reviewId: id,
    decision: enumeration('ready', 'changes_requested', 'adopt', 'reject', 'hold', 'adjust_scope'), reason: text(2000, 1),
    choiceIds: array(branchKey, 4096), initialState: { type: 'object', additionalProperties: false, maxProperties: 128,
      patternProperties: { '^(?!(__proto__|prototype|constructor)$)(?!\\s)(?!.*\\s$)[^\\u0000-\\u001f\\u007f]{1,128}$': branchValue } }, maxSteps: { ...integer(1, 128), description: 'Rehearsal steps; defaults to and cannot exceed the current project maxSteps budget.' } },
  export: { exportId: id, branchId, format: enumeration('markdown', 'fountain', 'storyboard', 'canvas'), selection: { ...enumeration('adopted', 'draft'), default: 'adopted' } },
  visual: { modelId: { ...id, description: 'The visual_model artifact ID, not the authentication model family.' }, branchId,
    view: { ...enumeration('timeline', 'interactions', 'locations'), default: 'timeline' }, eventIds: ids(64), sourceRevision: revision,
    intent: visualIntent, fingerprint: revision, artifactId: id, title: text(180, 1),
    replacements: { ...array(object({ eventId: id, content: text(20000) }, ['eventId', 'content']), 32), minItems: 1 } },
};
const descriptions: Record<string, string> = {
  project: 'Read, create or update a Creative Workspace project. Creation opts in per project and verifies registered participants. Mutations require task/write capability; only the owner changes settings.',
  artifact: 'Read/list or revision-safely create/update fictional manuscript artifacts. Default branch is main. Pin sources by artifactId and exact revision. Scene/shot/graph metadata is declarative; no scripts or model execution.',
  sequence: 'Read or update explicit scene presentation, chronology and shot order. Updates require the current showrunner and project revision.',
  context: 'Read bounded story context with branch, character knowledge, source revision and stale-source separation. Public visibility rules still apply.',
  review: 'Read/list editorial reviews or create a new revision-pinned advisory review. Reviews preserve uncertainty and intentional exceptions.',
  adopt: 'Adopt an exact artifact revision into an immutable snapshot. Requires the current showrunner, project revision and a reason. Always mutating.',
  session: 'Read/list a writer session or start, submit, review, pause, resume, decide or rehearse. Mutations use registered accounts and Work assignments. No agents are spawned; rehearsal stays a proposal.',
  export: 'Preview (default), read or check export health without mutation. Only write persists a derived markdown, Fountain, storyboard or Canvas export. Source revisions and explicit sequences remain authoritative.',
  visual: 'Read partial source-linked event/interaction/location projections, preview a selected edit intent, or propose a separate alternative. Requires authored visual_model annotations with exact scene revision and Unicode passage offsets. Proposals require current preview fingerprint, membership, and source/project revisions. No model execution, automatic scene replacement, or Canvas interception.',
};
export function getStoryTools(): Tool[] {
  return Object.entries(STORY_OPERATIONS).map(([endpoint, spec]) => ({ name: spec.tool, description: descriptions[endpoint]!,
    inputSchema: object({ ...common, op: { ...enumeration(...spec.reads, ...spec.writes), default: spec.defaultOp }, ...fields[endpoint] }, ['projectId']) as Tool['inputSchema'] }));
}
