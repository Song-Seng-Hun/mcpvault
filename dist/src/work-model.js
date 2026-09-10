import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
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
export const reviewBasis = (fm) => fingerprint({ description: fm.description, completionCriteria: fm.completion_criteria || [], artifacts: fm.artifacts || [], workKind: fm.work_kind, verification: fm.verification || '', ...(fm.responsibility && { responsibility: fm.responsibility }),
    ...(fm.work_review_contract === 2 && { contract: 2, context: fm.work_context_fingerprint }) });
export function textField(value, field, max = 500, required = false) {
    if (value !== undefined && typeof value !== 'string')
        throw guidanceError(new Error(`${field} must be a string`), 'guid-9a47fff07b9e2cc5');
    const text = String(value ?? '').trim();
    if (required && !text)
        throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
    if (text.length > max)
        throw guidanceError(new Error(`${field} exceeds ${max} characters`), 'guid-73eabe6107db8274');
    return text;
}
export function listField(value, field, max = 20, required = false) {
    if (!Array.isArray(value) || value.length > max)
        throw guidanceError(new Error(`${field} must be an array of at most ${max} strings`), 'guid-364a5d1dbc625eea');
    const list = [...new Set(value.map(v => textField(v, field, 500, true)))];
    if (required && !list.length)
        throw guidanceError(new Error(`${field} is required`), 'guid-0c6fd33ea1895f5e');
    return list;
}
export function integer(value, fallback, max, field) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
        throw guidanceError(new Error(`${field} must be an integer from 1 to ${max}`), 'guid-d14af5448638c158');
    return Number(value);
}
// A process-wide short queue also covers different FileSystemService instances
// for the same vault. Filesystem revision locks remain the final write gate.
let coordinator = Promise.resolve();
const coordinationLease = new AsyncLocalStorage();
async function coordinatedFrame(operation) {
    const frame = { active: true, children: Promise.resolve() };
    try {
        return await coordinationLease.run(frame, operation);
    }
    finally {
        // Stop admission before draining: a rejected Promise.all must not release
        // the root while an already admitted sibling is still writing.
        frame.active = false;
        await frame.children;
    }
}
export async function coordinate(operation) {
    // A paid-operation adapter can invoke the existing Work service while holding
    // the same short coordinator. Independent MCP requests never share this lease.
    const parent = coordinationLease.getStore();
    if (parent?.active) {
        const result = parent.children.then(() => coordinatedFrame(operation));
        parent.children = result.then(() => { }, () => { });
        return result;
    }
    const previous = coordinator;
    let release;
    coordinator = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        return await coordinatedFrame(operation);
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
            throw guidanceError(new Error('Cursor invalidated by changed inventory or context; restart the read'), 'guid-2fa8d6cb0792c6be');
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
        throw guidanceError(new Error('maxChars is too small for the response envelope'), 'guid-e7e900d75fb8abff');
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
        throw guidanceError(new Error('maxChars is too small for the next metadata item; increase maxChars'), 'guid-4bcc61a19eced6f4');
    return result;
}
