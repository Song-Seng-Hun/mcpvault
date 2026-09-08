import { guidanceError } from './guidance-runtime.js';
export const APPLICATION_OUTCOMES = ['succeeded', 'failed', 'inconclusive'] as const;

export interface KnowledgeApplication {
  id: string;
  knowledge: { path: string; revision: string };
  environment: string;
  conditions: string;
  outcome: (typeof APPLICATION_OUTCOMES)[number];
  observed: string;
  limitations?: string;
  verification?: { path: string; revision: string };
}

const LOCATOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'revision'],
  properties: {
    path: { type: 'string', minLength: 1, maxLength: 500 },
    revision: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
  },
};

const APPLICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'knowledge', 'environment', 'conditions', 'outcome', 'observed'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
    knowledge: LOCATOR_SCHEMA,
    environment: { type: 'string', minLength: 1, maxLength: 500 },
    conditions: { type: 'string', minLength: 1, maxLength: 1000 },
    outcome: { type: 'string', enum: [...APPLICATION_OUTCOMES] },
    observed: { type: 'string', minLength: 1, maxLength: 1000 },
    limitations: { type: 'string', minLength: 1, maxLength: 500 },
    verification: LOCATOR_SCHEMA,
  },
};

export const KNOWLEDGE_APPLICATIONS_SCHEMA = {
  type: 'array',
  description: 'Optional reported use of knowledge, not truth or task completion evidence. Store at most eight records/eight distinct related notes in an existing capture, knowledge note or task retrospective; [] explicitly clears, omission preserves. Keep historical applied revisions; do not copy private experience into a public record.',
  maxItems: 8,
  items: APPLICATION_SCHEMA,
};

const APPLICATION_KEYS = new Set(['id', 'knowledge', 'environment', 'conditions', 'outcome', 'observed', 'limitations', 'verification']);
const LOCATOR_KEYS = new Set(['path', 'revision']);
const REVISION = /^[0-9a-fA-F]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SCOPE_PATH = /^scope:\/\/(?:global\/|(?:model|agent|community)\/[a-z0-9][a-z0-9._-]{0,63}\/)(.+)$/;

function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw guidanceError(new TypeError(`${name} must be an object`), 'guid-fb22bd2cde0b504a');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw guidanceError(new TypeError(`${name} contains unknown field: ${key}`), 'guid-37d25c397385fa29');
  }
}

function normalizeLocator(value: unknown, name: string): { path: string; revision: string } {
  const locator = objectRecord(value, name);
  exactKeys(locator, LOCATOR_KEYS, name);
  if (typeof locator.path !== 'string' || locator.path.trim().length === 0 || locator.path.length > 500) {
    throw guidanceError(new TypeError(`${name}.path must be a nonempty string of at most 500 characters`), 'guid-a6b54e11564f0b1d');
  }
  if (CONTROL.test(locator.path) || locator.path.includes('#') || locator.path.includes('^') || locator.path.includes('[[') || locator.path.includes(']]')) {
    throw guidanceError(new TypeError(`${name}.path is not an exact note path`), 'guid-89902e027744abb4');
  }
  const scopeMatch = locator.path.match(SCOPE_PATH);
  if (scopeMatch) {
    if (scopeMatch[1]!.startsWith('/') || scopeMatch[1]!.includes(':') || scopeMatch[1]!.split(/[\\/]/).includes('..')) {
      throw guidanceError(new TypeError(`${name}.path contains an invalid scope path`), 'guid-791b52f0f0ba9077');
    }
  } else {
    if (locator.path.includes(':') || /^[\\/]/.test(locator.path)) {
      throw guidanceError(new TypeError(`${name}.path must be relative or a supported scope URI`), 'guid-9a6e8521f9beb7c5');
    }
    if (locator.path.split(/[\\/]/).includes('..')) throw guidanceError(new TypeError(`${name}.path contains traversal`), 'guid-8b05d54b37e01ea1');
  }
  if (typeof locator.revision !== 'string' || !REVISION.test(locator.revision)) {
    throw guidanceError(new TypeError(`${name}.revision must be exactly 64 hexadecimal characters`), 'guid-555fb1110e58fbed');
  }
  return { path: locator.path, revision: locator.revision.toLowerCase() };
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw guidanceError(new TypeError(`${name} must be a nonempty string of at most ${maxLength} characters`), 'guid-4ecaaec969fb9fce');
  }
  return value.trim();
}

export function normalizeKnowledgeApplications(value: unknown): KnowledgeApplication[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw guidanceError(new TypeError('knowledge applications must be an array'), 'guid-eadabfeb28a62156');
  if (value.length > 8) throw guidanceError(new RangeError('knowledge applications may contain at most 8 records'), 'guid-493531d779e25ea9');
  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(value).length;
  } catch {
    throw guidanceError(new TypeError('knowledge applications must be JSON-serializable'), 'guid-1f5f8e8c0eab2881');
  }
  if (serializedLength > 20_000) throw guidanceError(new RangeError('knowledge applications exceed 20000 JSON characters'), 'guid-4e79df89d2b5b844');

  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = objectRecord(entry, `applications[${index}]`);
    exactKeys(record, APPLICATION_KEYS, `applications[${index}]`);
    if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 64) {
      throw guidanceError(new TypeError(`applications[${index}].id must be a nonempty string of at most 64 characters`), 'guid-31e7ba45d4460697');
    }
    const id = record.id;
    if (!ID.test(id)) throw guidanceError(new TypeError(`applications[${index}].id has invalid format`), 'guid-ab9ad7903d0e1aa9');
    if (ids.has(id)) throw guidanceError(new TypeError(`duplicate application id: ${id}`), 'guid-257f27721be90d03');
    ids.add(id);
    const outcome = record.outcome;
    if (typeof outcome !== 'string' || !(APPLICATION_OUTCOMES as readonly string[]).includes(outcome)) {
      throw guidanceError(new TypeError(`applications[${index}].outcome is invalid`), 'guid-6dd43fe0e4edc77e');
    }
    const normalized: KnowledgeApplication = {
      id,
      knowledge: normalizeLocator(record.knowledge, `applications[${index}].knowledge`),
      environment: requiredText(record.environment, `applications[${index}].environment`, 500),
      conditions: requiredText(record.conditions, `applications[${index}].conditions`, 1000),
      outcome: outcome as KnowledgeApplication['outcome'],
      observed: requiredText(record.observed, `applications[${index}].observed`, 1000),
    };
    if (Object.prototype.hasOwnProperty.call(record, 'limitations')) {
      normalized.limitations = requiredText(record.limitations, `applications[${index}].limitations`, 500);
    }
    if (Object.prototype.hasOwnProperty.call(record, 'verification')) {
      normalized.verification = normalizeLocator(record.verification, `applications[${index}].verification`);
    }
    return normalized;
  });
}
