import { guidanceError } from './guidance-runtime.js';
const MAX_INPUT_CHARS = 8 * 1024 * 1024;
const MAX_EXACT_LINES = 400;
const MAX_LCS_CELLS = 160_000;
const MAX_EXACT_BODY_CHARS = 64 * 1024;
function normalize(body) {
    return body.replaceAll('\r\n', '\n');
}
function lineCount(body) {
    let count = 1;
    for (let i = 0; i < body.length; i++)
        if (body.charCodeAt(i) === 10)
            count++;
    return count;
}
function newlineCount(body, start, end) {
    let count = 0;
    for (let i = start; i < end; i++)
        if (body.charCodeAt(i) === 10)
            count++;
    return count;
}
function bounded(value, fallback, minimum, maximum) {
    if (value === undefined || !Number.isFinite(value))
        return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
function side(startLine, endLine, text, budget) {
    if (text.length <= budget.remaining) {
        budget.remaining -= text.length;
        return { startLine, endLine, text, truncated: false };
    }
    const clipped = text.slice(0, Math.max(0, budget.remaining));
    budget.remaining = 0;
    return { startLine, endLine, text: clipped, truncated: true };
}
function lineText(lines, start, end) {
    return start > end ? '' : lines.slice(start - 1, end).join('\n');
}
function boundedRangeText(body, startLine, endLine, limit) {
    if (startLine > endLine)
        return '';
    let line = 1;
    let start = 0;
    for (let i = 0; i < body.length && line < startLine; i++) {
        if (body.charCodeAt(i) === 10) {
            line++;
            start = i + 1;
        }
    }
    let end = body.length;
    line = startLine;
    for (let i = start; i < body.length && line <= endLine; i++) {
        if (body.charCodeAt(i) === 10) {
            if (line === endLine) {
                end = i;
                break;
            }
            line++;
        }
    }
    return body.slice(start, Math.min(end, start + limit + 1));
}
function exactChanges(oldLines, newLines) {
    const columns = newLines.length + 1;
    const table = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(columns));
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
        const row = table[oldIndex];
        const nextRow = table[oldIndex + 1];
        for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
            row[newIndex] = oldLines[oldIndex] === newLines[newIndex]
                ? nextRow[newIndex + 1] + 1
                : Math.max(nextRow[newIndex], row[newIndex + 1]);
        }
    }
    const changes = [];
    let oldIndex = 0;
    let newIndex = 0;
    let pending;
    const flush = () => { if (pending !== undefined) {
        changes.push(pending);
        pending = undefined;
    } };
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
        if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
            flush();
            oldIndex++;
            newIndex++;
            continue;
        }
        if (pending === undefined)
            pending = { oldStart: oldIndex + 1, oldEnd: oldIndex, newStart: newIndex + 1, newEnd: newIndex };
        if (newIndex === newLines.length || (oldIndex < oldLines.length && table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1])) {
            oldIndex++;
            pending.oldEnd++;
        }
        else {
            newIndex++;
            pending.newEnd++;
        }
    }
    flush();
    return changes;
}
function enclosingChange(before, after) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before.charCodeAt(prefix) === after.charCodeAt(prefix))
        prefix++;
    let prefixEnd = prefix === 0 ? 0 : before.lastIndexOf('\n', prefix - 1) + 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix &&
        before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1))
        suffix++;
    let oldSuffixStart = before.length - suffix;
    let newSuffixStart = after.length - suffix;
    if (oldSuffixStart > prefixEnd && before.charCodeAt(oldSuffixStart - 1) !== 10) {
        const nextNewline = before.indexOf('\n', oldSuffixStart);
        oldSuffixStart = nextNewline < 0 ? before.length : nextNewline + 1;
    }
    if (newSuffixStart > prefixEnd && after.charCodeAt(newSuffixStart - 1) !== 10) {
        const nextNewline = after.indexOf('\n', newSuffixStart);
        newSuffixStart = nextNewline < 0 ? after.length : nextNewline + 1;
    }
    if (oldSuffixStart < prefixEnd)
        oldSuffixStart = prefixEnd;
    if (newSuffixStart < prefixEnd)
        newSuffixStart = prefixEnd;
    const oldStart = newlineCount(before, 0, prefixEnd) + 1;
    const newStart = newlineCount(after, 0, prefixEnd) + 1;
    const oldEnd = oldSuffixStart === before.length ? lineCount(before) : newlineCount(before, 0, oldSuffixStart);
    const newEnd = newSuffixStart === after.length ? lineCount(after) : newlineCount(after, 0, newSuffixStart);
    return { oldStart, oldEnd, newStart, newEnd };
}
export function compareSourceBodies(before, after, options) {
    if (before.length > MAX_INPUT_CHARS || after.length > MAX_INPUT_CHARS)
        throw guidanceError(new RangeError('source body exceeds 8 MiB limit'), 'guid-6f688ebc5934c575');
    const oldBody = normalize(before);
    const newBody = normalize(after);
    const maxChars = bounded(options?.maxChars, 2000, 200, 4000);
    const maxHunks = bounded(options?.maxHunks, 4, 1, 8);
    if (oldBody === newBody)
        return { changed: false, granularity: 'line_hunks', truncated: false, hunks: [] };
    const oldCount = lineCount(oldBody);
    const newCount = lineCount(newBody);
    const exact = oldCount <= MAX_EXACT_LINES && newCount <= MAX_EXACT_LINES &&
        oldBody.length <= MAX_EXACT_BODY_CHARS && newBody.length <= MAX_EXACT_BODY_CHARS &&
        (oldCount + 1) * (newCount + 1) <= MAX_LCS_CELLS;
    const budget = { remaining: maxChars };
    const hunks = [];
    let truncated = false;
    if (exact) {
        const oldLines = oldBody.split('\n');
        const newLines = newBody.split('\n');
        const changes = exactChanges(oldLines, newLines);
        for (const change of changes.slice(0, maxHunks)) {
            const oldText = lineText(oldLines, change.oldStart, change.oldEnd);
            const newText = lineText(newLines, change.newStart, change.newEnd);
            const oldSide = side(change.oldStart, change.oldEnd, oldText, budget);
            const newSide = side(change.newStart, change.newEnd, newText, budget);
            truncated ||= oldSide.truncated || newSide.truncated;
            hunks.push({ old: oldSide, new: newSide });
        }
        if (changes.length > maxHunks)
            truncated = true;
        return { changed: true, granularity: 'line_hunks', truncated, hunks };
    }
    const change = enclosingChange(oldBody, newBody);
    const oldText = boundedRangeText(oldBody, change.oldStart, change.oldEnd, budget.remaining);
    const oldSide = side(change.oldStart, change.oldEnd, oldText, budget);
    const newText = boundedRangeText(newBody, change.newStart, change.newEnd, budget.remaining);
    const newSide = side(change.newStart, change.newEnd, newText, budget);
    truncated = oldSide.truncated || newSide.truncated;
    return { changed: true, granularity: 'enclosing_range', truncated, hunks: [{ old: oldSide, new: newSide }] };
}
