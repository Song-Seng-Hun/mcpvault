export const APPLICATION_OUTCOMES = ['succeeded', 'failed', 'inconclusive'];
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
function objectRecord(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
    return value;
}
function exactKeys(value, allowed, name) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            throw new TypeError(`${name} contains unknown field: ${key}`);
    }
}
function normalizeLocator(value, name) {
    const locator = objectRecord(value, name);
    exactKeys(locator, LOCATOR_KEYS, name);
    if (typeof locator.path !== 'string' || locator.path.trim().length === 0 || locator.path.length > 500) {
        throw new TypeError(`${name}.path must be a nonempty string of at most 500 characters`);
    }
    if (CONTROL.test(locator.path) || locator.path.includes('#') || locator.path.includes('^') || locator.path.includes('[[') || locator.path.includes(']]')) {
        throw new TypeError(`${name}.path is not an exact note path`);
    }
    const scopeMatch = locator.path.match(SCOPE_PATH);
    if (scopeMatch) {
        if (scopeMatch[1].startsWith('/') || scopeMatch[1].includes(':') || scopeMatch[1].split(/[\\/]/).includes('..')) {
            throw new TypeError(`${name}.path contains an invalid scope path`);
        }
    }
    else {
        if (locator.path.includes(':') || /^[\\/]/.test(locator.path)) {
            throw new TypeError(`${name}.path must be relative or a supported scope URI`);
        }
        if (locator.path.split(/[\\/]/).includes('..'))
            throw new TypeError(`${name}.path contains traversal`);
    }
    if (typeof locator.revision !== 'string' || !REVISION.test(locator.revision)) {
        throw new TypeError(`${name}.revision must be exactly 64 hexadecimal characters`);
    }
    return { path: locator.path, revision: locator.revision.toLowerCase() };
}
function requiredText(value, name, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
        throw new TypeError(`${name} must be a nonempty string of at most ${maxLength} characters`);
    }
    return value.trim();
}
export function normalizeKnowledgeApplications(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new TypeError('knowledge applications must be an array');
    if (value.length > 8)
        throw new RangeError('knowledge applications may contain at most 8 records');
    let serializedLength;
    try {
        serializedLength = JSON.stringify(value).length;
    }
    catch {
        throw new TypeError('knowledge applications must be JSON-serializable');
    }
    if (serializedLength > 20_000)
        throw new RangeError('knowledge applications exceed 20000 JSON characters');
    const ids = new Set();
    return value.map((entry, index) => {
        const record = objectRecord(entry, `applications[${index}]`);
        exactKeys(record, APPLICATION_KEYS, `applications[${index}]`);
        if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 64) {
            throw new TypeError(`applications[${index}].id must be a nonempty string of at most 64 characters`);
        }
        const id = record.id;
        if (!ID.test(id))
            throw new TypeError(`applications[${index}].id has invalid format`);
        if (ids.has(id))
            throw new TypeError(`duplicate application id: ${id}`);
        ids.add(id);
        const outcome = record.outcome;
        if (typeof outcome !== 'string' || !APPLICATION_OUTCOMES.includes(outcome)) {
            throw new TypeError(`applications[${index}].outcome is invalid`);
        }
        const normalized = {
            id,
            knowledge: normalizeLocator(record.knowledge, `applications[${index}].knowledge`),
            environment: requiredText(record.environment, `applications[${index}].environment`, 500),
            conditions: requiredText(record.conditions, `applications[${index}].conditions`, 1000),
            outcome: outcome,
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
