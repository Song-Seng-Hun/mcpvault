const textSchema = (maxLength) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const revisionSchema = { type: 'string', pattern: '^[0-9a-fA-F]{64}$' };
const pathPattern = '^(?!\\s)(?!.*\\s$)(?!.*[\\u0000-\\u001F\\u007F#^])(?!/)(?![A-Za-z]:)(?!.*(?:^|[/\\\\])\\.\\.?([/\\\\]|$))(?:(?:scope://(?:global|(?:model|agent|community)/[a-z0-9][a-z0-9._-]{0,63})/[^:]+)|(?:(?!.*:)[^/].*))$';
const pathSchema = { type: 'string', minLength: 1, maxLength: 500, pattern: pathPattern };
const closed = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const locatorBase = { path: pathSchema, revision: revisionSchema };
const locatorSchema = {
    anyOf: [
        closed(locatorBase),
        closed({ ...locatorBase, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, ['path', 'revision', 'startLine', 'endLine']),
    ],
    description: 'A canonical note locator. startLine and endLine, when present, are positive inclusive body-line numbers in ParsedNote.content, not full-file offsets; the integration layer converts them for the exact read action.',
};
const outcomeSchema = { type: 'string', enum: ['passed', 'failed', 'inconclusive'] };
const checkSchema = closed({
    kind: { type: 'string', enum: ['self_check', 'peer_check_report'] },
    method: textSchema(300),
    outcome: outcomeSchema,
    evidence: { type: 'array', minItems: 1, maxItems: 4, items: locatorSchema },
});
export const UNDERSTANDING_SCHEMA = {
    type: 'array',
    minItems: 0,
    maxItems: 4,
    items: closed({
        explanation: textSchema(600),
        supports: { type: 'array', minItems: 1, maxItems: 4, items: locatorSchema },
        checks: { type: 'array', minItems: 0, maxItems: 3, items: checkSchema },
        openQuestions: { type: 'array', minItems: 0, maxItems: 4, items: textSchema(300) },
        nextStep: textSchema(400),
    }, ['explanation', 'supports', 'nextStep']),
    description: 'Bounded pure stage7 understanding handoff. Raw JSON is at most 10000 characters. Locator line ranges refer to ParsedNote.content body lines; the integration layer converts them to full-file offsets for mcp.read_note_lines exact action. Explanations and check reports are self-reported data only; a peer check does not certify independent evidence or grant authority.',
};
function object(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error(`${name} must be an object`);
    const result = value;
    if (Object.keys(result).some(key => !keys.includes(key)))
        throw Error(`${name} contains an unknown field`);
    return result;
}
function boundedText(value, max, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw Error(`${name} must contain 1–${max} characters`);
    return value.trim();
}
function boundedList(value, min, max, name) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
        throw Error(`${name} must contain ${min}–${max} entries`);
    return value;
}
function normalizeRevision(value, name) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value))
        throw Error(`${name} must be exactly 64 hexadecimal characters`);
    return value.toLowerCase();
}
function normalizePath(value, name) {
    if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 500)
        throw Error(`${name} must be an exact path string`);
    const path = value.replace(/\\/g, '/');
    if (/^[\u0000-\u001f\u007f#^]/.test(path) || /[\u0000-\u001f\u007f#^]/.test(path) || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes(':') && !path.startsWith('scope://'))
        throw Error(`${name} is unsafe`);
    const scoped = /^scope:\/\/(global|(?:model|agent|community)\/[a-z0-9][a-z0-9._-]{0,63})\/(.+)$/.exec(path);
    if (path.startsWith('scope://') && !scoped)
        throw Error(`${name} must use a supported scope URI`);
    const relative = scoped?.[2] ?? path;
    if (!relative || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..'))
        throw Error(`${name} must not traverse or contain alternate streams`);
    return path;
}
function normalizeLocator(value, name, paths) {
    const row = object(value, ['path', 'revision', 'startLine', 'endLine'], name);
    const path = normalizePath(row.path, `${name}.path`);
    const revision = normalizeRevision(row.revision, `${name}.revision`);
    const hasStart = row.startLine !== undefined;
    const hasEnd = row.endLine !== undefined;
    if (hasStart !== hasEnd || (hasStart && (typeof row.startLine !== 'number' || !Number.isSafeInteger(row.startLine) || row.startLine < 1)) || (hasEnd && (typeof row.endLine !== 'number' || !Number.isSafeInteger(row.endLine) || row.endLine < 1)))
        throw Error(`${name} line numbers must be a paired positive integer range`);
    if (hasStart && hasEnd && row.startLine > row.endLine)
        throw Error(`${name} line range is reversed`);
    const pathKey = path.toLowerCase();
    const previous = paths.get(pathKey);
    if (previous !== undefined && previous !== revision)
        throw Error('conflicting revisions for the same path');
    paths.set(pathKey, revision);
    return { path, revision, ...(hasStart ? { startLine: row.startLine } : {}), ...(hasEnd ? { endLine: row.endLine } : {}) };
}
function normalizeLocatorList(value, min, max, name, paths) {
    const seen = new Set();
    return boundedList(value, min, max, name).map((entry, index) => {
        const locator = normalizeLocator(entry, `${name}[${index}]`, paths);
        const key = `${locator.path.toLowerCase()}|${locator.revision}|${locator.startLine ?? ''}|${locator.endLine ?? ''}`;
        if (seen.has(key))
            throw Error(`${name} contains a duplicate locator`);
        seen.add(key);
        return locator;
    });
}
export function normalizeUnderstanding(value) {
    const rawSize = (() => { try {
        const json = JSON.stringify(value);
        if (json === undefined)
            throw Error();
        return json.length;
    }
    catch {
        throw Error('understanding must be JSON serializable');
    } })();
    if (rawSize > 10000)
        throw Error('understanding exceeds 10000 JSON characters');
    const entries = boundedList(value, 0, 4, 'understanding');
    const paths = new Map();
    const result = entries.map((entry, index) => {
        const row = object(entry, ['explanation', 'supports', 'checks', 'openQuestions', 'nextStep'], `understanding[${index}]`);
        const supports = normalizeLocatorList(row.supports, 1, 4, `understanding[${index}].supports`, paths);
        const checks = row.checks === undefined ? undefined : boundedList(row.checks, 0, 3, 'checks').map((check, checkIndex) => {
            const checkRow = object(check, ['kind', 'method', 'outcome', 'evidence'], `check[${checkIndex}]`);
            if (checkRow.kind !== 'self_check' && checkRow.kind !== 'peer_check_report')
                throw Error('check kind is invalid');
            if (checkRow.outcome !== 'passed' && checkRow.outcome !== 'failed' && checkRow.outcome !== 'inconclusive')
                throw Error('check outcome is invalid');
            return { kind: checkRow.kind, method: boundedText(checkRow.method, 300, 'check method'), outcome: checkRow.outcome, evidence: normalizeLocatorList(checkRow.evidence, 1, 4, `check[${checkIndex}].evidence`, paths) };
        });
        const openQuestions = row.openQuestions === undefined ? undefined : boundedList(row.openQuestions, 0, 4, 'openQuestions').map((question, questionIndex) => boundedText(question, 300, `openQuestions[${questionIndex}]`));
        return { explanation: boundedText(row.explanation, 600, 'explanation'), supports, ...(checks === undefined ? {} : { checks }), ...(openQuestions === undefined ? {} : { openQuestions }), nextStep: boundedText(row.nextStep, 400, 'nextStep') };
    });
    if (paths.size > 8)
        throw Error('understanding may reference at most 8 distinct paths');
    return result;
}
