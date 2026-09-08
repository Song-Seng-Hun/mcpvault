import { guidanceError } from './guidance-runtime.js';
const textSchema = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const idSchema = { ...textSchema(64), pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' };
const basisSchema = { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: idSchema };
const objectSchema = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const KNOWLEDGE_SYNTHESIS_SCHEMA = {
    ...objectSchema({
        question: textSchema(500),
        inputs: { type: 'array', minItems: 2, maxItems: 8, items: { ...objectSchema({ id: idSchema, path: textSchema(500), revision: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' }, role: { type: 'string', enum: ['premise', 'historical_context'], description: 'Default premise. Explicit historical_context is required for retired, rejected or disputed inputs; this permits discussion of failure, not endorsement.' } }), required: ['id', 'path', 'revision'] } },
        explanations: { type: 'array', minItems: 2, maxItems: 4, items: objectSchema({ id: idSchema, explanation: textSchema(600), appliesWhen: textSchema(500), limitations: textSchema(500), basis: basisSchema }) },
        choices: { type: 'array', maxItems: 6, items: objectSchema({ when: textSchema(500), explanationId: idSchema, basis: basisSchema, reason: textSchema(600) }) },
        counterexamples: { type: 'array', maxItems: 6, items: objectSchema({ description: textSchema(600), basis: basisSchema }) },
        unresolvedQuestions: { type: 'array', maxItems: 6, items: textSchema(500) },
    }),
    description: 'Optional attributed conditional synthesis, at most 12000 JSON characters. Pin 2–8 current inputs, preserve competing explanations, conditions, limitations and dissent. Combined with knowledgeApplications and prose links, at most eight distinct related notes per publication (shared paths count once). Basis values refer to input IDs; choices refer to explanation IDs. Structural checks do not certify conclusions. Omission preserves the previous record without refreshing its input revisions. Use existing source-backed publication; never auto-merge originals.',
};
function record(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw guidanceError(Error(`${name} must be an object`), 'guid-fb22bd2cde0b504a');
    const result = value;
    if (Object.keys(result).some(key => !keys.includes(key)))
        throw guidanceError(Error(`${name} contains an unknown field`), 'guid-b50ae71997c2280c');
    return result;
}
function text(value, max, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw guidanceError(Error(`${name} must contain 1–${max} characters`), 'guid-d11efbd7b2b079c4');
    return value.trim();
}
function array(value, min, max, name) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
        throw guidanceError(Error(`${name} must contain ${min}–${max} entries`), 'guid-b74bc9db03ee0ddc');
    return value;
}
function id(value, name) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value))
        throw guidanceError(Error(`${name} must be a lowercase ID`), 'guid-afe5c7caab33457e');
    return value;
}
function exactPath(value) {
    const path = text(value, 500, 'input.path');
    if (path !== value || /[\u0000-\u001f\u007f#^]/.test(path) || path.includes('[[') || path.includes(']]'))
        throw guidanceError(Error('input.path must be exact'), 'guid-7999bdf7a733abae');
    const normalized = path.replace(/\\/g, '/');
    const scope = /^scope:\/\/(?:global\/|(?:model|agent|community)\/[a-z0-9][a-z0-9._-]{0,63}\/)(.+)$/.exec(normalized);
    const relative = scope ? scope[1] : normalized;
    if (relative.startsWith('/') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..'))
        throw guidanceError(Error('input.path must be a relative note path or supported scope URI'), 'guid-4dbbeb227065df67');
    return normalized;
}
/** Checks shape and declared support only; contradictory or malicious prose remains untrusted data. */
export function normalizeKnowledgeSynthesis(value) {
    const root = record(value, ['question', 'inputs', 'explanations', 'choices', 'counterexamples', 'unresolvedQuestions'], 'knowledge synthesis');
    let size;
    try {
        size = JSON.stringify(root).length;
    }
    catch {
        throw guidanceError(Error('knowledge synthesis must be JSON serializable'), 'guid-1c849863777d6fba');
    }
    if (size > 12000)
        throw guidanceError(Error('knowledge synthesis exceeds 12000 JSON characters'), 'guid-5dec969ce4d3dad6');
    const inputIds = new Set(), paths = new Set(), explanationIds = new Set();
    const inputs = array(root.inputs, 2, 8, 'inputs').map(entry => {
        const row = record(entry, ['id', 'path', 'revision', 'role'], 'input');
        const inputId = id(row.id, 'input.id'), path = exactPath(row.path);
        if (inputIds.has(inputId) || paths.has(path.toLowerCase()))
            throw guidanceError(Error('duplicate input ID or path'), 'guid-8be863afa52788c1');
        inputIds.add(inputId);
        paths.add(path.toLowerCase());
        if (typeof row.revision !== 'string' || !/^[a-f0-9]{64}$/i.test(row.revision))
            throw guidanceError(Error('input.revision must be exactly 64 hexadecimal characters'), 'guid-746adc5e831b2d8e');
        if (row.role !== undefined && row.role !== 'premise' && row.role !== 'historical_context')
            throw guidanceError(Error('input.role must be premise or historical_context'), 'guid-af472f70aa4b1833');
        return { id: inputId, path, revision: row.revision.toLowerCase(), ...(row.role !== undefined && { role: row.role }) };
    });
    const basis = (value) => {
        const ids = array(value, 1, 8, 'basis').map(item => id(item, 'basis ID'));
        if (new Set(ids).size !== ids.length || ids.some(key => !inputIds.has(key)))
            throw guidanceError(Error('basis must contain unique known input IDs'), 'guid-3321082807e334e5');
        return ids;
    };
    const explanations = array(root.explanations, 2, 4, 'explanations').map(entry => {
        const row = record(entry, ['id', 'explanation', 'appliesWhen', 'limitations', 'basis'], 'explanation');
        const explanationId = id(row.id, 'explanation.id');
        if (explanationIds.has(explanationId))
            throw guidanceError(Error('duplicate explanation ID'), 'guid-8c61b1d25d8b125a');
        explanationIds.add(explanationId);
        return { id: explanationId, explanation: text(row.explanation, 600, 'explanation'), appliesWhen: text(row.appliesWhen, 500, 'appliesWhen'), limitations: text(row.limitations, 500, 'limitations'), basis: basis(row.basis) };
    });
    const choices = array(root.choices, 0, 6, 'choices').map(entry => {
        const row = record(entry, ['when', 'explanationId', 'basis', 'reason'], 'choice');
        const explanationId = id(row.explanationId, 'choice.explanationId');
        if (!explanationIds.has(explanationId))
            throw guidanceError(Error('choice must reference a known explanation'), 'guid-2658ec0e01f2ddd0');
        return { when: text(row.when, 500, 'choice.when'), explanationId, basis: basis(row.basis), reason: text(row.reason, 600, 'choice.reason') };
    });
    const counterexamples = array(root.counterexamples, 0, 6, 'counterexamples').map(entry => {
        const row = record(entry, ['description', 'basis'], 'counterexample');
        return { description: text(row.description, 600, 'counterexample.description'), basis: basis(row.basis) };
    });
    const unresolvedQuestions = array(root.unresolvedQuestions, 0, 6, 'unresolvedQuestions').map(value => text(value, 500, 'unresolved question'));
    if (!choices.length && !unresolvedQuestions.length)
        throw guidanceError(Error('Record at least one conditional choice or an unresolved question'), 'guid-05f50e4a8846ba12');
    return { question: text(root.question, 500, 'question'), inputs, explanations, choices, counterexamples, unresolvedQuestions };
}
