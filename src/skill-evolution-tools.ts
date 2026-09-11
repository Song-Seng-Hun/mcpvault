import type { Tool } from '@modelcontextprotocol/server';
import { operationReadAlias } from './operation-contracts.js';

const string = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const guard = { type: 'object', additionalProperties: false, properties: { path: string(500), revision: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['path', 'revision'] };
const guards = { type: 'array', minItems: 1, maxItems: 8, items: guard };
const common = { skillId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,99}$' },
  maxChars: { type: 'integer', minimum: 1024, maximum: 12000, default: 4000 }, accessToken: { type: 'string' } };
const write = { expectedRevision: string(64), requestId: string(128) };
const recordId = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const promotion = { candidateId: recordId, evaluationId: recordId, mode: { type: 'string', enum: ['auto', 'approved'], default: 'auto' },
  fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' }, reason: string(), ...write };

export const SKILL_MUTATING_TOOLS = ['record_skill_experience', 'manage_skill_candidate', 'evaluate_skill', 'promote_skill', 'rollback_skill'] as const;
/** Used by both the early read-only gate and the common MCP/REST dispatcher. */
export function skillReadAlias(tool: string, op: unknown): string | undefined {
  return (SKILL_MUTATING_TOOLS as readonly string[]).includes(tool) ? operationReadAlias(tool, op) : undefined;
}
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool {
  return { name, description, inputSchema: { type: 'object', additionalProperties: false, properties: { ...common, ...properties }, required: ['skillId', ...required] } };
}
export function getSkillEvolutionTools(): Tool[] {
  return [
    tool('resolve_skill', 'Resolve the current usable procedural skill, exact revision and review drift. Imported source remains available. This does not install tools or grant execution permission.', {}, []),
    tool('record_skill_experience', 'Record an actually applied current or retained verified version of this Skill with explicit shareable success/failure/unknown outcome and exact visible evidence. Historical use does not qualify as current-basis candidate input. Do not copy private task logs. Requires host opt-in and an authenticated writer; retry the identical requestId after uncertain writes.', {
      ...write, usedVersion: guard, applied: { type: 'boolean', const: true }, shareable: { type: 'boolean', const: true },
      outcome: { type: 'string', enum: ['success', 'failure', 'unknown'] }, context: string(), summary: string(), evidence: guards,
    }, ['expectedRevision', 'requestId', 'usedVersion', 'applied', 'shareable', 'outcome', 'context', 'summary', 'evidence']),
    tool('manage_skill_candidate', 'Read/list or create/update/reject an unverified skill improvement candidate. Creation binds current source and used-version revisions plus experience locators. Updates/rejection require the exact candidate revision and original author or a host approval account. Candidates are never automatically recommended.', {
      ...write, op: { type: 'string', enum: ['read', 'list', 'create', 'update', 'reject'], default: 'read' }, candidateId: recordId,
      baseRevision: string(64), expectedCurrentRevision: string(64), content: string(32768), reason: string(), conditions: string(), experiences: guards,
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }, cursor: string(100),
    }, []),
    tool('evaluate_skill', 'Read a recorded host evaluation or run the fixed registered evaluator on the same baseline/candidate cases. No request can supply an evaluator or pass result. Missing profiles, uncertain risk or unverified outcomes stay review_required. No new model or background execution.', {
      ...write, op: { type: 'string', enum: ['read', 'run'], default: 'read' }, candidateId: recordId, evaluationId: recordId,
    }, []),
    tool('promote_skill', 'Preview then apply a fingerprint-bound current-version promotion. Auto mode requires a fixed passing host evaluation with no regression and real improvement; approved mode additionally requires a host-authorized approval account and reason. Apply needs requestId. Reread the same returned target.', {
      ...promotion, op: { type: 'string', enum: ['preview', 'apply'], default: 'preview' },
    }, ['candidateId', 'evaluationId', 'expectedRevision']),
    tool('rollback_skill', 'Host-authorized reviewer previews and applies a revision-safe rollback to the previous preserved skill. A failure claim alone never triggers automatic rollback. Preview fingerprint, current revision and reason are required; apply also needs requestId.', {
      ...write, reason: string(), fingerprint: string(64), op: { type: 'string', enum: ['preview', 'apply'], default: 'preview' },
    }, ['expectedRevision', 'reason']),
  ];
}
