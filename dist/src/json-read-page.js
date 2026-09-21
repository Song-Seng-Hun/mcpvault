import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
export const jsonWireBytes = (value) => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }), 'utf8');
export function jsonPointerNode(root, path) {
    if (typeof path !== 'string' || (path !== '' && !path.startsWith('/')) || /~(?![01])/.test(path))
        throw guidanceError(Error('Invalid JSON Pointer path'), 'guid-185dbb22c6180327');
    let current = root;
    for (const part of path === '' ? [] : path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part))
            return undefined;
        current = current[part];
    }
    return current;
}
const kindOf = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
/** Page a freshly authorized JSON value; no content cache or execution authority. */
export function pageJsonRead(node, path, basis, cursor, budget, envelope, childReference = path => ({ path })) {
    const revision = createHash('sha256').update(JSON.stringify({ node, path, basis })).digest('hex').slice(0, 32);
    const base = { path, revision, kind: kindOf(node) };
    const fits = (value) => jsonWireBytes(value) <= Math.min(budget, 5000);
    const nextCursor = (offset) => Buffer.from(JSON.stringify({ f: revision, o: offset })).toString('base64url');
    const count = typeof node === 'string' ? node.length : node !== null && typeof node === 'object' ? Object.keys(node).length : 0;
    let offset = 0;
    if (cursor !== undefined) {
        try {
            if (typeof cursor !== 'string' || cursor.length > 256)
                throw Error();
            const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
            if (parsed.f !== revision || !Number.isInteger(parsed.o) || parsed.o < 0 || parsed.o >= count)
                throw Error();
            offset = parsed.o;
            if (typeof node === 'string' && offset > 0 && /[\uD800-\uDBFF]/.test(node[offset - 1]) && /[\uDC00-\uDFFF]/.test(node[offset]))
                throw Error();
        }
        catch {
            throw guidanceError(Error('Read cursor is invalid or the value, authority, or revision changed; restart the read.'), 'guid-e8899d3b0dd639c9');
        }
    }
    // UTF-8/JSON cannot make an oversized string shorter. Avoid serializing it
    // again as a complete response, then repeatedly halving the entire source.
    if (cursor === undefined && (typeof node !== 'string' || node.length <= Math.min(budget, 5000))) {
        const complete = envelope({ ...base, value: node }, 1, false);
        if (fits(complete))
            return complete;
    }
    if (typeof node === 'string') {
        let text = node.slice(offset, offset + Math.min(budget, 5000));
        while (text) {
            if (/[\uD800-\uDBFF]$/.test(text) && /[\uDC00-\uDFFF]/.test(node[offset + text.length] ?? ''))
                text = text.slice(0, -1);
            if (!text)
                break;
            const end = offset + text.length, more = end < node.length;
            const candidate = envelope({ ...base, value: { type: 'string-fragment', offset, total: node.length, text } }, 1, more, more ? nextCursor(end) : undefined);
            if (fits(candidate))
                return candidate;
            text = text.slice(0, Math.floor(text.length / 2));
        }
        throw guidanceError(Error('Read budget cannot preserve a string fragment; increase maxChars.'), 'guid-cf9d2fab907cb159');
    }
    if (node === null || typeof node !== 'object')
        throw guidanceError(Error('Read budget cannot preserve this scalar; increase maxChars.'), 'guid-2dfaf4ea0cc1570b');
    const entries = Object.entries(node), selected = [];
    while (offset < entries.length) {
        const [key, value] = entries[offset];
        const child = childReference(`${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
        const detailed = { ...child, kind: kindOf(value), value };
        const end = offset + 1, more = end < entries.length;
        const candidate = (entry) => envelope({ ...base, entries: [...selected, entry] }, entries.length, more, more ? nextCursor(end) : undefined);
        const entry = fits(candidate(detailed)) ? detailed : child;
        if (!fits(candidate(entry))) {
            if (!selected.length)
                throw guidanceError(Error('Read budget cannot preserve a child entry; increase maxChars.'), 'guid-5d05faca9d9b7da1');
            break;
        }
        selected.push(entry);
        offset = end;
    }
    return envelope({ ...base, entries: selected }, entries.length, offset < entries.length, offset < entries.length ? nextCursor(offset) : undefined);
}
