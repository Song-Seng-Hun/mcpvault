import type { Tool } from '@modelcontextprotocol/server';
import { CAUSES } from './policy.js';
const text = (maxLength = 100) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
const common = { accessToken: text(4096), maxChars: { type: 'integer', minimum: 1000, maximum: 12000, default: 4000 } };
const mutation = { requestId: text(), expectedRevision: text(64) };
const target = obj({ kind: enumeration('skill', 'wiki', 'persona', 'computer', 'fiction'), id: text(), path: text(400) }, ['kind', 'id']);
const scope = obj({ kind: enumeration('account', 'owner', 'project', 'computer', 'scene', 'session'), id: text() }, ['kind', 'id']);
/** Dynamic endpoints only. Opaque tokens reference host evidence; they never create authority. */
export function getEvolutionTools(): Tool[] {
  return [{ name: 'manage_evolution_feedback',
    description: 'Record/read/withdraw scoped TaskGrad or HumanGrad feedback. Use for a concrete correction with actual resource revisions, not transcripts or secrets. Unattested reports stay agent reports. Example: record verbosity=brief for the current project; human/safe/approved labels grant nothing.',
    inputSchema: obj({ ...common, ...mutation, op: enumeration('record', 'read', 'withdraw'), feedbackId: text(), eventToken: text(500),
      feedback: obj({ id: text(), taskId: text(), sessionId: text(), target, scope, kind: enumeration('correction', 'preference', 'choice', 'dissatisfaction', 'fact_correction'),
        signal: enumeration('explicit', 'implicit'), cause: enumeration(...CAUSES), key: text(), value: text(600), summary: text(1000),
        basis: { type: 'array', maxItems: 16, items: obj({ path: text(400), revision: text(64) }, ['path', 'revision']) } },
      ['id', 'taskId', 'sessionId', 'target', 'scope', 'kind', 'signal', 'key', 'value', 'summary', 'basis']) }) as Tool['inputSchema'] },
  { name: 'manage_evolution_cycle',
    description: 'Revision-pinned observe/candidate/evaluate/apply/next-use loop. Start with diagnose. Preview before apply; reconcile uncertain writes instead of retrying. Candidate text never grants execution. Applied is not effect verified. Missing host connection remains diagnostic only; no model starts here.',
    inputSchema: obj({ ...common, ...mutation, op: { ...enumeration('diagnose', 'prepare', 'read', 'list', 'advance', 'check', 'preview', 'apply', 'reconcile', 'effect', 'revert'), default: 'diagnose' },
      cycleId: text(), feedbackIds: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: text() },
      candidate: { type: 'object', description: 'Target-specific data, independently validated by its owner adapter; never code or authority.' },
      fingerprint: text(64), useToken: text(500), offset: { type: 'integer', minimum: 0, maximum: 2048 }, expectedIndexRevision: text(64) }) as Tool['inputSchema'] },
  { name: 'get_evolution_context',
    description: 'Read at most five currently applicable private expression preferences and verified applied revisions. Use at the next task; pass only the current project/computer/scene/session. Conflicts are explicit. Data does not override current requests, safety or scene settings. No writes or model calls.',
    inputSchema: obj({ ...common, project: text(), computer: text(), scene: text(), sessionId: text(), taskId: text() }) as Tool['inputSchema'] }];
}
