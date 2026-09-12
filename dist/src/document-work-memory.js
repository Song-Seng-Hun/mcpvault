import { AsyncLocalStorage } from 'node:async_hooks';
import { derivedCacheBudget } from './cache-budget.js';
const active = new AsyncLocalStorage();
/** Nested read/parse operations share one lifetime. Concurrent requests still
 * reserve from the same process budget. This is admission accounting, not an
 * OS/native-allocator hard limit; estimates are deliberately conservative. */
export async function withDocumentWork(operation) {
    const outer = active.getStore();
    if (outer && !outer.closed)
        return operation();
    const scope = { closed: false, reservations: new Set(), memo: new Map() };
    return active.run(scope, async () => {
        try {
            return await operation();
        }
        finally {
            scope.closed = true;
            for (const reservation of scope.reservations)
                reservation.release();
            scope.reservations.clear();
            scope.memo.clear();
        }
    });
}
/** Private owner-scoped values cannot survive their foreground operation. */
export function documentWorkMemo(owner) {
    const scope = active.getStore();
    if (!scope || scope.closed)
        throw new Error('Document memo requires an active operation');
    let values = scope.memo.get(owner);
    if (!values) {
        values = new Map();
        scope.memo.set(owner, values);
    }
    return values;
}
const residentEstimates = new WeakMap();
export function documentResidentEstimate(document) {
    const known = residentEstimates.get(document);
    if (known !== undefined)
        return known;
    let bytes = document.raw.length * 2 + document.title.length * 2 + 1024;
    for (const f of document.fragments) {
        bytes += 900 + f.children.length * 144 + f.description.length * 2;
        for (const text of f.headingPath)
            bytes += text.length * 2 + 32;
        for (const text of f.references)
            bytes += text.length * 2 + 32;
    }
    for (const page of document.pdfPages ?? [])
        bytes += 512 + page.regions.length * 160;
    residentEstimates.set(document, bytes);
    return bytes;
}
export function reserveDocumentWork(bytes) {
    const scope = active.getStore();
    if (!scope || scope.closed)
        throw new Error('Document working memory requires an active operation');
    const reservation = derivedCacheBudget.reserveWork(bytes);
    scope.reservations.add(reservation);
    return { release: () => { reservation.release(); scope.reservations.delete(reservation); } };
}
export function documentParseEstimate(raw) {
    let syntax = 1;
    for (let i = 0; i < raw.length; i++) {
        // Newlines and inline markup can create many AST objects even in small input.
        if ('\n\r*_`[<>|'.includes(raw[i]))
            syntax++;
    }
    return raw.length * 16 + syntax * 768 + 64 * 1024;
}
/** Match the reader's data-only frontmatter boundary without invoking YAML/JSON.
 * Scalars plus collection punctuation can allocate many nodes per source byte. */
export function documentFrontmatterEstimate(raw) {
    const start = raw.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (!raw.startsWith('---', start) || raw[start + 3] === '-')
        return 0;
    const closing = raw.indexOf('\n---', start + 3);
    const end = closing < 0 ? raw.length : closing + 4;
    let syntax = 1;
    for (let i = start; i < end; i++)
        if ('\n\r-:{}[],\"\'&*?#'.includes(raw[i]))
            syntax++;
    return (end - start) * 64 + syntax * 768 + 64 * 1024;
}
