import { parseDocumentStructure } from './document-structure.js';
import { selectDocumentRanges, documentLineStarts, documentLineAt } from './document-ranges.js';
import { positiveSearchTerms } from './search.js';
const floorBoundary = (raw, n) => n > 0 && n < raw.length && /[\uD800-\uDBFF]/.test(raw[n - 1]) && /[\uDC00-\uDFFF]/.test(raw[n]) ? n - 1 : n;
/** Common AST + range resolver for optional context projections. Exact source
 * spans map disjoint text without repeating its body in metadata. */
export function selectStructuredContextPassages(params) {
    const raw = String(params.content ?? ''), terms = positiveSearchTerms(String(params.query ?? '')).map(t => t.toLowerCase()).slice(0, 32);
    const maxChars = Math.max(0, Math.floor(params.maxChars)), maxPassages = Math.max(0, Math.min(2, Math.floor(params.maxPassages ?? 2)));
    const originLine = Number.isInteger(params.startLine) && params.startLine > 0 ? params.startLine : 1;
    if (!maxChars || !maxPassages || (!terms.length && !params.preferredLine))
        return { passages: [], truncated: false };
    const doc = parseDocumentStructure({ path: 'provided-content', raw, ...(params.format && { format: params.format }) }), starts = documentLineStarts(raw);
    const headings = doc.fragments.filter(f => f.kind === 'heading');
    const ranked = doc.fragments.filter(f => !f.children.length && !['root', 'frontmatter', 'section', 'heading', 'tableHeader'].includes(f.kind)).map(f => {
        const text = raw.slice(f.startOffset, f.endOffset).toLowerCase();
        const coverage = terms.filter(term => text.includes(term)).length;
        const preferred = Boolean(params.preferredLine && ((params.preferredLine >= f.startLine + originLine - 1 && params.preferredLine <= f.endLine + originLine - 1)
            || headings.some(h => h.startLine + originLine - 1 === params.preferredLine && h.parent === f.parent)));
        return { f, coverage, preferred };
    }).filter(row => row.coverage || row.preferred).sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.coverage - a.coverage || a.f.startOffset - b.f.startOffset);
    const passages = [];
    let used = 0;
    for (const { f } of ranked) {
        if (passages.length >= maxPassages || used >= maxChars)
            break;
        const selection = selectDocumentRanges(doc, { fragmentId: f.id });
        const selected = [], gaps = [];
        let remaining = maxChars - used;
        // Keep a bounded structural prefix while reserving the majority for the requested evidence.
        let contextBudget = Math.floor(remaining / 3);
        for (const r of selection.ranges.filter(r => r.role !== 'requested')) {
            const length = r.endOffset - r.startOffset;
            if (length + 2 > contextBudget) {
                gaps.push(`omitted_${r.role}`);
                continue;
            }
            selected.push({ start: r.startOffset, end: r.endOffset, role: r.role });
            remaining -= length + 2;
            contextBudget -= length + 2;
        }
        let start = f.startOffset, end = f.endOffset;
        if (end - start > remaining) {
            const lower = raw.slice(start, end).toLowerCase();
            const matches = terms.map(t => lower.indexOf(t)).filter(n => n >= 0);
            const anchor = matches.length ? Math.min(...matches) : params.preferredLine ? Math.max(start, starts[Math.max(0, params.preferredLine - originLine)] ?? start) - start : 0;
            start = floorBoundary(raw, Math.max(start, Math.min(end - remaining, start + anchor - Math.floor(remaining / 2))));
            end = floorBoundary(raw, Math.min(end, start + remaining));
            gaps.push('requested_fragment_partial');
        }
        if (end > start)
            selected.push({ start, end, role: 'requested' });
        selected.sort((a, b) => a.start - b.start || a.end - b.end);
        let text = '';
        const sourceRanges = [];
        for (const part of selected) {
            if (text)
                text += '\n\n';
            const textStartOffset = text.length;
            text += raw.slice(part.start, part.end);
            sourceRanges.push({ role: part.role, startLine: documentLineAt(starts, part.start) + originLine - 1,
                endLine: documentLineAt(starts, Math.max(part.start, part.end - 1)) + originLine - 1,
                contentStartOffset: part.start, contentEndOffset: part.end, textStartOffset, textEndOffset: text.length });
        }
        if (!text)
            continue;
        const requested = sourceRanges.find(r => r.role === 'requested');
        if (!requested)
            continue;
        passages.push({ text, startLine: requested.startLine, endLine: requested.endLine,
            headingPath: f.headingPath.slice(-8).map(h => h.slice(0, 120)), truncated: gaps.length > 0,
            sourceRanges, gaps, requestedRange: { startLine: f.startLine + originLine - 1, endLine: f.endLine + originLine - 1 } });
        used += text.length;
    }
    return { passages, truncated: passages.some(p => p.truncated) || passages.length < ranked.length };
}
