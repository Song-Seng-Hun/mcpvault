import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { parseDocumentStructure } from './document-structure.js';
import { documentLineAt, documentLineStarts } from './document-ranges.js';
const fail = () => { throw guidanceError(new Error('Invalid PDF extraction protocol or provenance'), 'guid-cec762064aefbf9b'); };
const int = (n, min, max) => Number.isSafeInteger(n) && Number(n) >= min && Number(n) <= max;
const boundary = (text, i) => !(i > 0 && i < text.length && /[\uD800-\uDBFF]/.test(text[i - 1]) && /[\uDC00-\uDFFF]/.test(text[i]));
function gaps(input) {
    if (!Array.isArray(input) || input.length > 64)
        return fail();
    return input.map(g => { if (!g || !/^[a-z0-9_]{1,80}$/.test(g.code) || !['warning', 'error'].includes(g.severity))
        return fail(); return g.code; });
}
/** Validates an entire admitted generation. The worker may resume individual
 * pages; its host must merge them before passing the complete generation here. */
export function pdfDocumentStructure(path, revision, result) {
    if (!result || result.version !== 1 || result.sourceSha256 !== revision || !/^[a-f0-9]{64}$/.test(revision)
        || !/^mcpvault-pdf-v1:[a-f0-9]{64}$/.test(result.profile) || !int(result.metrics?.totalPages, 1, 200)
        || !Array.isArray(result.pages) || result.pages.length !== result.metrics.totalPages)
        return fail();
    const warnings = gaps(result.gaps), pdfPages = [];
    const pages = [...result.pages].sort((a, b) => a.page - b.page);
    let raw = '', regionCount = 0;
    for (let index = 0; index < pages.length; index++) {
        const p = pages[index];
        if (p.page !== index + 1 || typeof p.text !== 'string' || p.text.length > 4 * 1024 * 1024
            || !['ok', 'failed'].includes(p.status) || !Array.isArray(p.regions) || p.regions.length > 20000)
            return fail();
        const pg = gaps(p.gaps);
        if (p.status === 'failed')
            pg.push('page_extraction_failed');
        warnings.push(...pg.map(code => `page ${p.page}: ${code}`));
        if (index)
            raw += '\n';
        const startOffset = raw.length;
        raw += p.text;
        if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
            throw guidanceError(new Error('PDF extracted document exceeds structure budget'), 'guid-8d16e38bd08327c2');
        regionCount += p.regions.length;
        if (regionCount > 50000)
            throw guidanceError(new Error('PDF generation region budget exceeded'), 'guid-47832b1d2a7e0408');
        const regions = p.regions.map((r) => {
            if (!int(r.startOffset, 0, p.text.length) || !int(r.endOffset, r.startOffset, p.text.length)
                || !boundary(p.text, r.startOffset) || !boundary(p.text, r.endOffset)
                || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.bbox.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7)
                || r.bbox[2] < r.bbox[0] || r.bbox[3] < r.bbox[1])
                return fail();
            return { startOffset: startOffset + r.startOffset, endOffset: startOffset + r.endOffset, bbox: [...r.bbox] };
        });
        pdfPages.push({ page: p.page, startOffset, endOffset: raw.length, status: p.status, regions });
    }
    const starts = documentLineStarts(raw), fragments = [];
    const id = (tag) => createHash('sha256').update(`${path}\0${revision}\0${result.profile}\0${tag}`).digest('hex');
    const root = { id: id('root'), kind: 'root', startOffset: 0, endOffset: raw.length,
        startLine: 1, endLine: starts.length, headingPath: [], description: '', children: [], references: [] };
    fragments.push(root);
    for (const p of pdfPages) {
        const pageId = id(`page:${p.page}`), pageFragment = { id: pageId, kind: 'pdfPage', startOffset: p.startOffset,
            endOffset: p.endOffset, startLine: documentLineAt(starts, p.startOffset), endLine: documentLineAt(starts, Math.max(p.startOffset, p.endOffset - 1)),
            headingPath: [`Page ${p.page}`], description: raw.slice(p.startOffset, Math.min(p.endOffset, p.startOffset + 240)), children: [], references: [], parent: root.id };
        root.children.push(pageId);
        fragments.push(pageFragment);
        const parsed = parseDocumentStructure({ path, raw: raw.slice(p.startOffset, p.endOffset), revision, format: 'text' });
        for (const leaf of parsed.fragments.filter(f => !f.children.length && f.kind !== 'root' && f.endOffset > f.startOffset)) {
            if (fragments.length >= 50000)
                throw guidanceError(new Error('PDF generation fragment budget exceeded'), 'guid-565020a9fd732ccd');
            const childId = id(`page:${p.page}:${leaf.startOffset}:${leaf.endOffset}`);
            const startOffset = p.startOffset + leaf.startOffset, endOffset = p.startOffset + leaf.endOffset;
            pageFragment.children.push(childId);
            fragments.push({ ...leaf, id: childId, parent: pageId, headingPath: [`Page ${p.page}`], children: [],
                startOffset, endOffset, startLine: documentLineAt(starts, startOffset), endLine: documentLineAt(starts, Math.max(startOffset, endOffset - 1)) });
        }
    }
    const byId = new Map(fragments.map(f => [f.id, f]));
    for (const parent of fragments.filter(f => f.children.length))
        parent.children.forEach((childId, i) => {
            const f = byId.get(childId);
            delete f.previous;
            delete f.next;
            if (i)
                f.previous = parent.children[i - 1];
            if (i + 1 < parent.children.length)
                f.next = parent.children[i + 1];
        });
    return { path, revision, profile: result.profile, raw, title: path.split('/').pop(), fragments, pdfPages,
        locator: 'extracted UTF-16 half-open offsets and extracted lines; original PDF page/bbox provenance, not physical source lines',
        gaps: [...new Set(warnings)] };
}
export function pdfRangeProvenance(doc, start, end) {
    return doc.pdfPages?.filter(p => p.startOffset < end && p.endOffset > start).flatMap(p => {
        const regions = p.regions.filter(r => r.startOffset < end && r.endOffset > start).sort((a, b) => a.startOffset - b.startOffset);
        const result = [];
        let at = Math.max(start, p.startOffset), stop = Math.min(end, p.endOffset);
        for (const r of regions) {
            const left = Math.max(start, r.startOffset), right = Math.min(end, r.endOffset);
            if (at < left)
                result.push({ page: p.page, startOffset: at - p.startOffset, endOffset: left - p.startOffset });
            result.push({ page: p.page, startOffset: left - p.startOffset, endOffset: right - p.startOffset, bbox: r.bbox });
            at = Math.max(at, right);
        }
        if (at < stop)
            result.push({ page: p.page, startOffset: at - p.startOffset, endOffset: stop - p.startOffset });
        return result;
    });
}
