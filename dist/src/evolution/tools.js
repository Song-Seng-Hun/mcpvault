import { CAUSES } from './policy.js';
const text = (maxLength = 100) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (...values) => ({ type: 'string', enum: values });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const common = { accessToken: text(4096), maxChars: { type: 'integer', minimum: 1000, maximum: 12000, default: 4000 } };
const mutation = { requestId: text(), expectedRevision: text(64) };
const target = obj({ kind: enumeration('skill', 'wiki', 'persona', 'computer', 'fiction', 'harness'), id: text(), path: text(400) }, ['kind', 'id']);
const scope = obj({ kind: enumeration('account', 'owner', 'project', 'computer', 'scene', 'session'), id: text() }, ['kind', 'id']);
/** Dynamic endpoints only. Opaque tokens reference host evidence; they never create authority. */
export function getEvolutionTools() {
    return [{ name: 'manage_evolution_feedback',
            description: 'Record/read/withdraw scoped TaskGrad or HumanGrad feedback. Use for a concrete correction with actual resource revisions, not transcripts or secrets. Unattested reports stay agent reports. Example: record verbosity=brief for the current project; human/safe/approved labels grant nothing.',
            inputSchema: obj({ ...common, ...mutation, op: enumeration('record', 'read', 'withdraw', 'request_review'), feedbackId: text(), eventToken: text(500),
                feedback: obj({ id: text(), taskId: text(), sessionId: text(), target, scope, kind: enumeration('correction', 'preference', 'choice', 'dissatisfaction', 'fact_correction'),
                    signal: enumeration('explicit', 'implicit'), cause: enumeration(...CAUSES), key: text(), value: text(600), summary: text(1000),
                    basis: { type: 'array', maxItems: 16, items: obj({ path: text(400), revision: text(64) }, ['path', 'revision']) } }, ['id', 'taskId', 'sessionId', 'target', 'scope', 'kind', 'signal', 'key', 'value', 'summary', 'basis']) }) },
        { name: 'manage_evolution_cycle',
            description: 'Revision-pinned observe/candidate/evaluate/apply/next-use loop. Start with diagnose. Preview before apply; reconcile uncertain writes instead of retrying. Candidate text never grants execution. Applied is not effect verified. Missing host connection remains diagnostic only; no model starts here.',
            inputSchema: obj({ ...common, ...mutation, op: { ...enumeration('diagnose', 'prepare', 'read', 'list', 'advance', 'check', 'preview', 'apply', 'reconcile', 'effect', 'revert', 'request_effect_review'), default: 'diagnose' },
                deliveryToken: text(500), responseExcerpt: text(4000), responseSource: enumeration('agent_report'),
                cycleId: text(), feedbackIds: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: text() },
                candidate: { type: 'object', description: 'Target-specific data, independently validated by its owner adapter; never code or authority.' },
                fingerprint: text(64), useToken: text(500), offset: { type: 'integer', minimum: 0, maximum: 2048 }, expectedIndexRevision: text(64) }) },
        { name: 'get_evolution_context',
            description: 'Read at most five current private preferences. begin records a server-issued task and pins its harness; requires write capability. observations reads bounded actual search/read metrics. Client session IDs are reports, not host proof. Example: begin with requestId, sessionId, taskKind and project; pass returned evolutionTask and a unique evolutionRequestId to search/read. No model calls.',
            inputSchema: obj({ ...common, op: { ...enumeration('read', 'begin', 'observations'), default: 'read' }, requestId: text(), expectedRevision: text(64),
                offset: { type: 'integer', minimum: 0, maximum: 64 }, project: text(), computer: text(), scene: text(), sessionId: text(), taskId: text(), taskKind: text() }) }];
}
