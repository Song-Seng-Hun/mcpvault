export interface KnowledgeInvestigation {
  question: string;
  targets: Array<{ path: string; revision: string }>;
  conditions: string;
  alternatives: string[];
  decisionRules: Array<{ observation: string; interpretation: 'supports' | 'challenges' | 'inconclusive'; consequence: string }>;
  executionBoundary: string;
  result?: {
    planRevision: string;
    observed: string;
    outcome: 'supports' | 'challenges' | 'inconclusive';
    interpretation: string;
    limitations: string;
    evidence: Array<{ path: string; revision: string }>;
  };
}

const textSchema = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const revisionSchema = { type: 'string', pattern: '^[0-9a-fA-F]{64}$' };
const pathPattern = '^(?!\\s)(?!.*\\s$)(?!.*[\\u0000-\\u001F\\u007F#^])(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.?(?:/|$))(?:scope://(?:global|(?:model|agent|community)/[a-z0-9][a-z0-9._-]{0,63})/.+|.+)$';
const pathSchema = { type: 'string', minLength: 1, maxLength: 500, pattern: pathPattern };
const closed = <T extends Record<string, unknown>>(properties: T, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const interpretationSchema = { type: 'string', enum: ['supports', 'challenges', 'inconclusive'] };
const referenceSchema = closed({ path: pathSchema, revision: revisionSchema });

export const KNOWLEDGE_INVESTIGATION_SCHEMA = {
  ...closed({
    question: textSchema(500),
    targets: { type: 'array', minItems: 1, maxItems: 4, items: referenceSchema },
    conditions: textSchema(1000),
    alternatives: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: textSchema(500) },
    decisionRules: { type: 'array', minItems: 1, maxItems: 4, items: closed({ observation: textSchema(600), interpretation: interpretationSchema, consequence: textSchema(600) }) },
    executionBoundary: { ...textSchema(600), description: 'Declared limits only; this field never grants user authority.' },
    result: closed({
      planRevision: revisionSchema,
      observed: textSchema(1000),
      outcome: interpretationSchema,
      interpretation: textSchema(1000),
      limitations: textSchema(600),
      evidence: { type: 'array', minItems: 1, maxItems: 4, items: referenceSchema },
    }),
  }, ['question', 'targets', 'conditions', 'alternatives', 'decisionRules', 'executionBoundary']),
  description: 'Bounded pure investigation plan/result contract. The raw JSON must be at most 12000 characters. Meaning is advisory record data: declared execution limits never grant authority, prose is not evaluated, and a result planRevision pins the previously published plan; changing judgment requires at least one challenging or inconclusive decision rule.',
};

function record(value: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${name} must be an object`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw Error(`${name} contains an unknown field`);
  return result;
}

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name} must contain 1–${max} characters`);
  return value.trim();
}

function list(value: unknown, min: number, max: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw Error(`${name} must contain ${min}–${max} entries`);
  return value;
}

function revision(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) throw Error(`${name} must be exactly 64 hexadecimal characters`);
  return value.toLowerCase();
}

function exactPath(value: unknown, name: string): string {
  const original = text(value, 500, name);
  if (original !== value || /[\u0000-\u001f\u007f#^]/.test(original) || original.includes('[[') || original.includes(']]')) throw Error(`${name} must be exact`);
  const path = original.replace(/\\/g, '/');
  const scoped = /^scope:\/\/(?:global\/|(?:model|agent|community)\/[a-z0-9][a-z0-9._-]{0,63}\/)(.+)$/.exec(path);
  const relative = scoped ? scoped[1]! : path;
  if (relative.startsWith('/') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw Error(`${name} must be a relative note path or supported scope URI`);
  if (scoped === null && path.startsWith('scope://')) throw Error(`${name} must use a supported scope URI`);
  return path;
}

export function normalizeKnowledgeInvestigation(value: unknown): KnowledgeInvestigation {
  const root = record(value, ['question', 'targets', 'conditions', 'alternatives', 'decisionRules', 'executionBoundary', 'result'], 'knowledge investigation');
  let rawSize: number;
  try { rawSize = JSON.stringify(root).length; } catch { throw Error('knowledge investigation must be JSON serializable'); }
  if (rawSize > 12000) throw Error('knowledge investigation exceeds 12000 JSON characters');

  const references = (value: unknown, min: number, max: number, name: string) => {
    const paths = new Set<string>();
    return list(value, min, max, name).map(entry => {
      const row = record(entry, ['path', 'revision'], name.slice(0, -1));
      const path = exactPath(row.path, `${name}.path`);
      const key = path.toLowerCase();
      if (paths.has(key)) throw Error('duplicate normalized path');
      paths.add(key);
      return { path, revision: revision(row.revision, `${name}.revision`) };
    });
  };

  const targets = references(root.targets, 1, 4, 'targets');
  const alternatives = list(root.alternatives, 2, 4, 'alternatives').map(value => text(value, 500, 'alternative'));
  if (new Set(alternatives).size !== alternatives.length) throw Error('alternatives must be distinct');
  const decisionRules: KnowledgeInvestigation['decisionRules'] = list(root.decisionRules, 1, 4, 'decisionRules').map(entry => {
    const row = record(entry, ['observation', 'interpretation', 'consequence'], 'decision rule');
    if (row.interpretation !== 'supports' && row.interpretation !== 'challenges' && row.interpretation !== 'inconclusive') throw Error('decision rule interpretation is invalid');
    return { observation: text(row.observation, 600, 'decision rule observation'), interpretation: row.interpretation, consequence: text(row.consequence, 600, 'decision rule consequence') };
  });
  if (decisionRules.every(rule => rule.interpretation === 'supports')) throw Error('decision rules must permit changing judgment');

  const result: KnowledgeInvestigation['result'] = root.result === undefined ? undefined : (() => {
    const row = record(root.result, ['planRevision', 'observed', 'outcome', 'interpretation', 'limitations', 'evidence'], 'result');
    if (row.outcome !== 'supports' && row.outcome !== 'challenges' && row.outcome !== 'inconclusive') throw Error('result outcome is invalid');
    const evidence = references(row.evidence, 1, 4, 'evidence');
    return { planRevision: revision(row.planRevision, 'result.planRevision'), observed: text(row.observed, 1000, 'result.observed'), outcome: row.outcome, interpretation: text(row.interpretation, 1000, 'result.interpretation'), limitations: text(row.limitations, 600, 'result.limitations'), evidence };
  })();
  return { question: text(root.question, 500, 'question'), targets, conditions: text(root.conditions, 1000, 'conditions'), alternatives, decisionRules, executionBoundary: text(root.executionBoundary, 600, 'executionBoundary'), ...(result === undefined ? {} : { result }) };
}
