import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { documentLineAt, documentLineStarts } from './document-ranges.js';
export const DOCUMENT_CHUNK_PROFILE = 'structure-byte448-v1';
export const STRUCTURED_DOCUMENTS_ENABLED = process.env.MCPVAULT_CONTEXT_PROFILE === 'structure-v1';
export const MAX_STRUCTURED_CHUNKS = 65536;
export function assertDocumentEmbeddingTokens(text, tokenizer) {
    if (!tokenizer || typeof tokenizer.encode !== 'function')
        throw guidanceError(new Error('Structured embedding tokenizer unavailable; no truncated vectors published'), 'guid-db47ae5e62242469');
    const tokens = tokenizer.encode(text, { add_special_tokens: true });
    if (!Array.isArray(tokens) || tokens.length > 512 || !tokens.length)
        throw guidanceError(new Error('Structured embedding token budget exceeded; no truncated vectors published'), 'guid-5bb83cbb07355a8b');
}
function byteEnd(raw, start, end, budget) {
    let offset = start, used = 0;
    while (offset < end) {
        const cp = raw.codePointAt(offset), width = cp > 0xffff ? 2 : 1;
        const bytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
        if (used + bytes > budget)
            break;
        offset += width;
        used += bytes;
    }
    return offset;
}
/** Bound context before joining heading strings: malicious headings cannot
 * multiply into a huge intermediate string for each fragment. */
function headingLabel(headings) {
    let text = '', remaining = 72;
    for (let i = 0; i < headings.length; i++) {
        const source = headings[i], separator = text ? ' / ' : '';
        if (Buffer.byteLength(separator) >= remaining)
            return { text, truncated: true };
        remaining -= Buffer.byteLength(separator);
        const end = byteEnd(source, 0, source.length, remaining), part = source.slice(0, end);
        text += separator + part;
        remaining -= Buffer.byteLength(part);
        if (end < source.length)
            return { text, truncated: true };
    }
    return { text, truncated: false };
}
/** Complete, deterministic source partition; byte budget is conservative and
 * production embedding additionally verifies the pinned tokenizer's 512-token limit. */
export function chunkStructuredDocument(doc) {
    const frontmatter = doc.fragments.find(f => f.kind === 'frontmatter');
    let bodyOffset = frontmatter?.endOffset ?? 0;
    if (frontmatter) {
        if (doc.raw[bodyOffset] === '\r')
            bodyOffset++;
        if (doc.raw[bodyOffset] === '\n')
            bodyOffset++;
    }
    const leaves = doc.fragments.filter(f => !f.children.length && !['root', 'frontmatter', 'section'].includes(f.kind))
        .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    const title = doc.path.split('/').pop() ?? 'document';
    const titlePart = title.slice(0, byteEnd(title, 0, title.length, 40));
    const starts = documentLineStarts(doc.raw), chunks = [];
    let cursor = bodyOffset;
    for (let i = 0; i < leaves.length; i++) {
        const f = leaves[i];
        if (f.endOffset <= cursor)
            continue;
        const heading = headingLabel(f.headingPath), context = `${titlePart}\n${heading.text}\n`;
        const allowed = 448 - Buffer.byteLength('passage: ' + context);
        const ids = [f.id];
        let end = f.endOffset;
        // Join small sibling paragraphs without crossing section/list ownership.
        while (f.kind === 'paragraph' && Buffer.byteLength(doc.raw.slice(cursor, end)) < 96 && i + 1 < leaves.length) {
            const next = leaves[i + 1];
            if (next.kind !== 'paragraph' || next.parent !== f.parent || Buffer.byteLength(doc.raw.slice(cursor, next.endOffset)) > allowed)
                break;
            end = next.endOffset;
            ids.push(next.id);
            i++;
        }
        if (i === leaves.length - 1)
            end = doc.raw.length;
        while (cursor < end) {
            if (chunks.length >= MAX_STRUCTURED_CHUNKS)
                throw guidanceError(new Error('Document exceeds structured chunk budget; no partial generation published'), 'guid-2d7bcb11e2ab795a');
            let split = byteEnd(doc.raw, cursor, end, allowed);
            if (split < end) {
                // Prefer a nearby sentence/line/word boundary, never lose the separator.
                const lower = cursor + Math.floor((split - cursor) * 0.6);
                for (let at = split; at > lower; at--)
                    if (/[\s.!?。！？]/.test(doc.raw[at - 1])) {
                        split = at;
                        break;
                    }
            }
            if (split <= cursor)
                throw guidanceError(new Error('Document chunk context exhausted the input budget'), 'guid-19dc5cf9da4af6da');
            chunks.push({ id: `${doc.path}#s${createHash('sha256').update(`${DOCUMENT_CHUNK_PROFILE}\0${cursor}\0${split}`).digest('hex').slice(0, 24)}`,
                text: context + doc.raw.slice(cursor, split), line: documentLineAt(starts, cursor), offset: cursor, endOffset: split, bodyOffset,
                fragmentIds: [...ids], contextTruncated: heading.truncated || titlePart.length < title.length });
            cursor = split;
        }
    }
    return chunks;
}
