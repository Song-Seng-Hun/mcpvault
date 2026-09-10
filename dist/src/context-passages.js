import { buildMarkdownLiteralMask } from './backlinks.js';
import { positiveSearchTerms } from './search.js';
import { selectStructuredContextPassages } from './document-context.js';
import { STRUCTURED_DOCUMENTS_ENABLED } from './document-chunks.js';
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_PATTERN = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;
const LIST_PATTERN = /^( {0,3})(?:[-+*]|\d+[.)])[ \t]+\S/;
/**
 * Selects exact, independently readable Markdown source units for a caller's
 * bounded context packet. It never reads files or changes source text.
 */
export function selectContextPassages(params) {
    if (STRUCTURED_DOCUMENTS_ENABLED || params.format === 'text')
        return selectStructuredContextPassages(params);
    const content = String(params.content ?? '');
    const terms = queryTerms(String(params.query ?? ''));
    const maxChars = boundedInteger(params.maxChars, 0, Number.MAX_SAFE_INTEGER);
    const maxPassages = params.maxPassages === undefined ? 2 : boundedInteger(params.maxPassages, 0, 2);
    const startLine = positiveInteger(params.startLine, 1);
    const preferredLine = Number.isInteger(params.preferredLine) && params.preferredLine > 0 ? params.preferredLine : undefined;
    if (maxPassages === 0 || (terms.length === 0 && preferredLine === undefined))
        return { passages: [], truncated: false };
    const candidates = collectCandidates(content, startLine);
    const ranked = candidates
        .map((candidate) => {
        const coverage = termCoverage(candidate.matchText, terms);
        const preferred = preferredLine !== undefined && ((candidate.startLine <= preferredLine && candidate.endLine >= preferredLine)
            || candidate.preferredHeadingLine === preferredLine);
        if (coverage === 0 && !preferred)
            return undefined;
        return { ...candidate, coverage, preferred };
    })
        .filter((candidate) => candidate !== undefined)
        .sort((left, right) => Number(right.preferred) - Number(left.preferred) || right.coverage - left.coverage || left.start - right.start);
    const passages = [];
    let usedChars = 0;
    for (const candidate of ranked) {
        if (passages.length >= maxPassages || usedChars >= maxChars)
            break;
        if (passages.some(passage => rangesOverlap(candidate.startLine, candidate.endLine, passage.startLine, passage.endLine)))
            continue;
        const source = content.slice(candidate.start, candidate.end);
        const remaining = maxChars - usedChars;
        const text = clippedSourceWindow(source, remaining, terms, candidate, preferredLine);
        const clipped = text.length < source.length;
        passages.push({ text, startLine: candidate.startLine, endLine: candidate.endLine, headingPath: candidate.headingPath, truncated: clipped });
        usedChars += text.length;
    }
    return {
        passages,
        truncated: passages.some(passage => passage.truncated) || passages.length < ranked.length,
    };
}
function collectCandidates(content, startLine) {
    const lines = splitLines(content, startLine);
    const literals = buildMarkdownLiteralMask(content);
    const candidates = [];
    const headings = [];
    let paragraphStart;
    let pendingHeadingLine;
    let activeFence;
    const addParagraph = (endIndex) => {
        if (paragraphStart === undefined || endIndex < paragraphStart)
            return;
        const first = lines[paragraphStart];
        const last = lines[endIndex];
        const candidate = { start: first.start, end: last.end, startLine: first.number, endLine: last.number, headingPath: currentHeadingPath(headings), matchText: content.slice(first.start, last.end) };
        if (pendingHeadingLine !== undefined)
            candidate.preferredHeadingLine = pendingHeadingLine;
        candidates.push(candidate);
        pendingHeadingLine = undefined;
        paragraphStart = undefined;
    };
    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const fence = FENCE_PATTERN.exec(line.text);
        if (activeFence) {
            if (fence && fence[1][0] === activeFence.char && fence[1].length >= activeFence.length && fence[2].trim() === '') {
                candidates.push({ start: activeFence.start, end: line.end, startLine: activeFence.startLine, endLine: line.number, headingPath: activeFence.headingPath, matchText: content.slice(activeFence.start, line.end) });
                activeFence = undefined;
            }
            index += 1;
            continue;
        }
        if (fence) {
            addParagraph(index - 1);
            activeFence = { char: fence[1][0], length: fence[1].length, start: line.start, startLine: line.number, headingPath: currentHeadingPath(headings) };
            index += 1;
            continue;
        }
        const heading = !lineIsLiteral(literals, line) ? HEADING_PATTERN.exec(line.text) : undefined;
        if (heading) {
            addParagraph(index - 1);
            const level = heading[1].length;
            headings.length = level;
            headings[level - 1] = heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
            pendingHeadingLine = line.number;
            index += 1;
            continue;
        }
        const tableEnd = tableEndIndex(lines, index);
        if (tableEnd !== undefined) {
            addParagraph(index - 1);
            const header = lines[index];
            const headingPath = currentHeadingPath(headings);
            for (let row = index + 2; row <= tableEnd; row += 1) {
                const data = lines[row];
                candidates.push({ start: header.start, end: data.end, startLine: header.number, endLine: data.number, headingPath, matchText: data.text });
            }
            index = tableEnd + 1;
            continue;
        }
        if (LIST_PATTERN.test(line.text)) {
            addParagraph(index - 1);
            const indent = line.text.match(/^\s*/)?.[0].length ?? 0;
            index += 1;
            while (index < lines.length && lines[index].text.trim() && !HEADING_PATTERN.test(lines[index].text) && !FENCE_PATTERN.test(lines[index].text) && !LIST_PATTERN.test(lines[index].text) && leadingWhitespace(lines[index].text) > indent)
                index += 1;
            const last = lines[index - 1];
            candidates.push({ start: line.start, end: last.end, startLine: line.number, endLine: last.number, headingPath: currentHeadingPath(headings), matchText: content.slice(line.start, last.end) });
            continue;
        }
        if (!line.text.trim()) {
            addParagraph(index - 1);
            index += 1;
            continue;
        }
        if (paragraphStart === undefined)
            paragraphStart = index;
        index += 1;
    }
    addParagraph(lines.length - 1);
    if (activeFence) {
        const last = lines.at(-1);
        if (last)
            candidates.push({ start: activeFence.start, end: last.end, startLine: activeFence.startLine, endLine: last.number, headingPath: activeFence.headingPath, matchText: content.slice(activeFence.start, last.end) });
    }
    return candidates;
}
function splitLines(content, startLine) {
    const lines = [];
    let start = 0;
    let number = startLine;
    while (start <= content.length) {
        const newline = content.indexOf('\n', start);
        const end = newline === -1 ? content.length : newline;
        const raw = content.slice(start, end);
        lines.push({ text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, start, end, number });
        if (newline === -1)
            break;
        start = newline + 1;
        number += 1;
    }
    return lines;
}
function tableEndIndex(lines, index) {
    if (!looksLikeTableRow(lines[index].text) || index + 2 > lines.length || !isTableDelimiter(lines[index + 1].text))
        return undefined;
    let end = index + 1;
    while (end + 1 < lines.length && looksLikeTableRow(lines[end + 1].text))
        end += 1;
    return end >= index + 2 ? end : undefined;
}
function looksLikeTableRow(line) {
    return line.includes('|') && line.trim().replace(/^\|/, '').replace(/\|$/, '').includes('|');
}
function isTableDelimiter(line) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length >= 2 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}
function currentHeadingPath(headings) {
    return headings.filter((heading) => Boolean(heading));
}
function lineIsLiteral(mask, line) {
    return line.start < mask.length && mask[line.start] === 1;
}
function queryTerms(query) {
    return [...new Set(positiveSearchTerms(query).map(term => term.toLocaleLowerCase()).filter(Boolean))];
}
function termCoverage(text, terms) {
    const normalized = text.toLocaleLowerCase();
    let coverage = 0;
    for (const term of terms)
        if (normalized.includes(term))
            coverage += 1;
    return coverage;
}
function boundedInteger(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return minimum;
    return Math.min(maximum, Math.max(minimum, Math.floor(numeric)));
}
function positiveInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}
function leadingWhitespace(value) {
    return value.match(/^\s*/)?.[0].length ?? 0;
}
function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
    return leftStart <= rightEnd && rightStart <= leftEnd;
}
function clippedSourceWindow(source, maxChars, terms, candidate, preferredLine) {
    if (source.length <= maxChars)
        return source;
    const match = firstQueryMatch(source, terms);
    const useLocator = preferredLine !== undefined && preferredLine >= candidate.startLine && preferredLine <= candidate.endLine;
    const lineStart = useLocator ? preferredLineAnchor(source, candidate, preferredLine) : 0;
    const newline = source.indexOf('\n', lineStart);
    const lineMatch = useLocator ? firstQueryMatch(source.slice(lineStart, newline < 0 ? undefined : newline), terms) : undefined;
    const anchorStart = useLocator ? lineStart + (lineMatch?.start || 0) : match?.start ?? 0;
    const anchorLength = useLocator ? lineMatch?.length || 0 : match?.length ?? 0;
    const before = Math.max(0, Math.floor((maxChars - anchorLength) / 2));
    const start = Math.max(0, Math.min(source.length - maxChars, anchorStart - before));
    return source.slice(start, start + maxChars);
}
function firstQueryMatch(source, terms) {
    const normalized = source.toLocaleLowerCase();
    let first;
    for (const term of terms) {
        const start = normalized.indexOf(term);
        if (start !== -1 && (first === undefined || start < first.start))
            first = { start, length: term.length };
    }
    return first;
}
function preferredLineAnchor(source, candidate, preferredLine) {
    if (preferredLine === undefined || preferredLine < candidate.startLine || preferredLine > candidate.endLine)
        return 0;
    let offset = 0;
    for (let line = candidate.startLine; line < preferredLine; line += 1) {
        const newline = source.indexOf('\n', offset);
        if (newline === -1)
            return 0;
        offset = newline + 1;
    }
    return offset;
}
