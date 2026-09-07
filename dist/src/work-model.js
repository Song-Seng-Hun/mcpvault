import { createHash } from 'node:crypto';
export const WORK_KINDS = ['general', 'security', 'permissions', 'shared_policy', 'destructive'];
const canonicalStatus = (fm) => String(fm.status || '').trim().toLowerCase();
export const finished = (fm) => ['completed', 'cancelled'].includes(canonicalStatus(fm));
export const started = (fm) => !finished(fm) && Boolean(fm.started_at || ['in_progress', 'blocked', 'in_review'].includes(canonicalStatus(fm)));
export const displayIdentity = (p) => p.agentId || p.modelId;
export const canonical = (value) => JSON.stringify(order(value));
function order(value) {
    if (Array.isArray(value))
        return value.map(order);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, order(value[k])]));
    return value;
}
export const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export const reviewBasis = (fm) => fingerprint({ description: fm.description, completionCriteria: fm.completion_criteria || [], artifacts: fm.artifacts || [], workKind: fm.work_kind, verification: fm.verification || '' });
export function textField(value, field, max = 500, required = false) {
    if (value !== undefined && typeof value !== 'string')
        throw new Error(`${field} must be a string`);
    const text = String(value ?? '').trim();
    if (required && !text)
        throw new Error(`${field} is required`);
    if (text.length > max)
        throw new Error(`${field} exceeds ${max} characters`);
    return text;
}
export function listField(value, field, max = 20, required = false) {
    if (!Array.isArray(value) || value.length > max)
        throw new Error(`${field} must be an array of at most ${max} strings`);
    const list = [...new Set(value.map(v => textField(v, field, 500, true)))];
    if (required && !list.length)
        throw new Error(`${field} is required`);
    return list;
}
export function integer(value, fallback, max, field) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
        throw new Error(`${field} must be an integer from 1 to ${max}`);
    return Number(value);
}
// A process-wide short queue also covers different FileSystemService instances
// for the same vault. Filesystem revision locks remain the final write gate.
let coordinator = Promise.resolve();
export async function coordinate(operation) {
    const previous = coordinator;
    let release;
    coordinator = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
    }
}
/** Admission counts the complete JSON envelope, including the continuation. */
export function page(items, context, signature, params, kind) {
    const limit = integer(params.limit, 20, 100, 'limit');
    const maxChars = integer(params.maxChars, 4000, 12000, 'maxChars');
    let offset = 0;
    if (params.cursor) {
        try {
            if (params.cursor.length > 1000)
                throw new Error();
            const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
            if (decoded.f !== signature || decoded.k !== kind || !Number.isSafeInteger(decoded.o) || decoded.o < 0 || decoded.o >= items.length)
                throw new Error();
            offset = decoded.o;
        }
        catch {
            throw new Error('Cursor invalidated by changed inventory or context; restart the read');
        }
    }
    const result = { ...context, items: [], total: items.length, truncated: offset < items.length };
    const setCursor = () => {
        result.truncated = offset + result.items.length < items.length;
        if (result.truncated)
            result.cursor = Buffer.from(JSON.stringify({ k: kind, f: signature, o: offset + result.items.length })).toString('base64url');
        else
            delete result.cursor;
    };
    setCursor();
    if (JSON.stringify(result).length > maxChars)
        throw new Error('maxChars is too small for the response envelope');
    for (const item of items.slice(offset, offset + limit)) {
        result.items.push(item);
        setCursor();
        if (JSON.stringify(result).length > maxChars) {
            result.items.pop();
            setCursor();
            break;
        }
    }
    if (!result.items.length && result.truncated)
        throw new Error('maxChars is too small for the next metadata item; increase maxChars');
    return result;
}
