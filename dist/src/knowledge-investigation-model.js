import { guidanceError } from './guidance-runtime.js';
const textSchema = (maxLength) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const revisionSchema = { type: 'string', pattern: '^[0-9a-fA-F]{64}$' };
const pathPattern = '^(?!\\s)(?!.*\\s$)(?!.*[\\u0000-\\u001F\\u007F#^])(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.?(?:/|$))(?:scope://(?:global|(?:model|agent|community)/[a-z0-9][a-z0-9._-]{0,63})/.+|.+)$';
const pathSchema = { type: 'string', minLength: 1, maxLength: 500, pattern: pathPattern };
const closed = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
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
function list(value, min, max, name) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
        throw guidanceError(Error(`${name} must contain ${min}–${max} entries`), 'guid-b74bc9db03ee0ddc');
    return value;
}
function revision(value, name) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value))
        throw guidanceError(Error(`${name} must be exactly 64 hexadecimal characters`), 'guid-81b75bc5c501bf9d');
    return value.toLowerCase();
}
function exactPath(value, name) {
    const original = text(value, 500, name);
    if (original !== value || /[\u0000-\u001f\u007f#^]/.test(original) || original.includes('[[') || original.includes(']]'))
        throw guidanceError(Error(`${name} must be exact`), 'guid-95f9f3823b7d1166');
    const path = original.replace(/\\/g, '/');
    const scoped = /^scope:\/\/(?:global\/|(?:model|agent|community)\/[a-z0-9][a-z0-9._-]{0,63}\/)(.+)$/.exec(path);
    const relative = scoped ? scoped[1] : path;
    if (relative.startsWith('/') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..'))
        throw guidanceError(Error(`${name} must be a relative note path or supported scope URI`), 'guid-4f6933800e6c1170');
    if (scoped === null && path.startsWith('scope://'))
        throw guidanceError(Error(`${name} must use a supported scope URI`), 'guid-1952a59a9dfb5c69');
    return path;
}
export function normalizeKnowledgeInvestigation(value) {
    const root = record(value, ['question', 'targets', 'conditions', 'alternatives', 'decisionRules', 'executionBoundary', 'result'], 'knowledge investigation');
    let rawSize;
    try {
        rawSize = JSON.stringify(root).length;
    }
    catch {
        throw guidanceError(Error('knowledge investigation must be JSON serializable'), 'guid-3eaa84c8ae65e335');
    }
    if (rawSize > 12000)
        throw guidanceError(Error('knowledge investigation exceeds 12000 JSON characters'), 'guid-2b508b55c926719d');
    const references = (value, min, max, name) => {
        const paths = new Set();
        return list(value, min, max, name).map(entry => {
            const row = record(entry, ['path', 'revision'], name.slice(0, -1));
            const path = exactPath(row.path, `${name}.path`);
            const key = path.toLowerCase();
            if (paths.has(key))
                throw guidanceError(Error('duplicate normalized path'), 'guid-75ed936e94659138');
            paths.add(key);
            return { path, revision: revision(row.revision, `${name}.revision`) };
        });
    };
    const targets = references(root.targets, 1, 4, 'targets');
    const alternatives = list(root.alternatives, 2, 4, 'alternatives').map(value => text(value, 500, 'alternative'));
    if (new Set(alternatives).size !== alternatives.length)
        throw guidanceError(Error('alternatives must be distinct'), 'guid-37e17464f53a55f7');
    const decisionRules = list(root.decisionRules, 1, 4, 'decisionRules').map(entry => {
        const row = record(entry, ['observation', 'interpretation', 'consequence'], 'decision rule');
        if (row.interpretation !== 'supports' && row.interpretation !== 'challenges' && row.interpretation !== 'inconclusive')
            throw guidanceError(Error('decision rule interpretation is invalid'), 'guid-9a33b7d237cf1509');
        return { observation: text(row.observation, 600, 'decision rule observation'), interpretation: row.interpretation, consequence: text(row.consequence, 600, 'decision rule consequence') };
    });
    if (decisionRules.every(rule => rule.interpretation === 'supports'))
        throw guidanceError(Error('decision rules must permit changing judgment'), 'guid-c70ba933e73f8135');
    const result = root.result === undefined ? undefined : (() => {
        const row = record(root.result, ['planRevision', 'observed', 'outcome', 'interpretation', 'limitations', 'evidence'], 'result');
        if (row.outcome !== 'supports' && row.outcome !== 'challenges' && row.outcome !== 'inconclusive')
            throw guidanceError(Error('result outcome is invalid'), 'guid-846f2663ecfd9756');
        const evidence = references(row.evidence, 1, 4, 'evidence');
        return { planRevision: revision(row.planRevision, 'result.planRevision'), observed: text(row.observed, 1000, 'result.observed'), outcome: row.outcome, interpretation: text(row.interpretation, 1000, 'result.interpretation'), limitations: text(row.limitations, 600, 'result.limitations'), evidence };
    })();
    return { question: text(root.question, 500, 'question'), targets, conditions: text(root.conditions, 1000, 'conditions'), alternatives, decisionRules, executionBoundary: text(root.executionBoundary, 600, 'executionBoundary'), ...(result === undefined ? {} : { result }) };
}
