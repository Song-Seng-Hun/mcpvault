function stripAtxClosingSequence(text) {
    const withPrecedingSpace = /^(.*[ \t])#+$/.exec(text);
    if (withPrecedingSpace)
        return withPrecedingSpace[1].replace(/[ \t]+$/, '');
    if (/^#+$/.test(text))
        return '';
    return text;
}
/** Physical body lines outside Properties and matching fenced examples. */
function* visibleNoteLines(raw) {
    const lines = raw.split('\n');
    let inFrontmatter = false;
    let frontmatterEnded = false;
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].replace(/\r$/, '');
        if (!frontmatterEnded && i === 0 && trimmed === '---') {
            inFrontmatter = true;
            continue;
        }
        if (inFrontmatter) {
            if (trimmed === '---') {
                inFrontmatter = false;
                frontmatterEnded = true;
            }
            continue;
        }
        frontmatterEnded = true;
        const fenceMatch = fenceRegex.exec(trimmed);
        if (fenceMatch) {
            const markers = fenceMatch[1];
            const trailing = fenceMatch[2];
            const char = markers.charAt(0);
            if (!inFence) {
                inFence = true;
                fenceChar = char;
                fenceLength = markers.length;
            }
            else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
                inFence = false;
                fenceChar = '';
                fenceLength = 0;
            }
            // Mismatched, too-short or annotated closers remain fenced content.
            continue;
        }
        if (inFence)
            continue;
        yield { text: trimmed, line: i + 1 };
    }
    return inFence;
}
/** Same matching-fence state used by physical outlines and paragraph reads. */
export function hasUnclosedNoteFence(raw) {
    const lines = visibleNoteLines(raw);
    let next = lines.next();
    while (!next.done)
        next = lines.next();
    return next.value;
}
function* noteHeadings(raw) {
    const headingRegex = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
    for (const { text, line } of visibleNoteLines(raw)) {
        const match = headingRegex.exec(text);
        if (match)
            yield { level: match[1].length, text: stripAtxClosingSequence((match[2] ?? '').trim()), line };
    }
}
/** Pure projection of one already-authorized raw Markdown snapshot. */
export function projectNoteOutline(raw) {
    return [...noteHeadings(raw)];
}
/** Prose paragraphs with physical locators; never join across headings or fences. */
export function* projectNoteParagraphs(raw) {
    let pending = [];
    let startLine = 0, endLine = 0;
    for (const { text, line } of visibleNoteLines(raw)) {
        const boundary = !text.trim() || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text);
        if (pending.length && (boundary || line !== endLine + 1)) {
            yield { text: pending.join('\n').trim(), startLine, endLine };
            pending = [];
        }
        if (boundary)
            continue;
        if (!pending.length)
            startLine = line;
        pending.push(text);
        endLine = line;
    }
    if (pending.length)
        yield { text: pending.join('\n').trim(), startLine, endLine };
}
/** Retain only requested normalized names, not a complete outline. */
export function projectNoteHeadingPresence(raw, requested) {
    const wanted = new Set([...requested].map(name => name.trim().toLowerCase()));
    const found = new Set();
    if (!wanted.size)
        return found;
    for (const heading of noteHeadings(raw)) {
        const name = heading.text.trim().toLowerCase();
        if (wanted.has(name))
            found.add(name);
        if (found.size === wanted.size)
            break;
    }
    return found;
}
/** Exact terminal block anchors, not ID prefixes, mentions or code examples. */
export function projectNoteBlockLines(raw, blockId) {
    const result = [];
    for (const { text, line } of visibleNoteLines(raw)) {
        const anchor = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(text);
        if (anchor?.[1]?.toLowerCase() === blockId.toLowerCase())
            result.push(line);
    }
    return result;
}
/** Prefer an exact heading; a partial match is useful only when unambiguous. */
export function selectNoteHeading(headings, requested) {
    const query = requested.trim().replace(/^#+\s*/, '').trim().toLowerCase();
    if (!query)
        throw new Error('A non-empty heading is required');
    const exact = headings.filter(heading => heading.text.trim().toLowerCase() === query);
    const matches = exact.length ? exact : headings.filter(heading => heading.text.trim().toLowerCase().includes(query));
    if (!matches.length)
        throw new Error('Section not found');
    if (matches.length > 1)
        throw new Error('Section is ambiguous. Use mcp.get_note_outline, then mcp.read_note_lines with the selected range and expectedRevision.');
    return matches[0];
}
/** Raw physical-line window; response serialization applies its character budget. */
export function projectNoteLineWindow(raw, params) {
    const lines = raw.split('\n');
    const clampedStart = Math.min(Math.max(params.startLine, 1), lines.length);
    const clampedEnd = Math.min(Math.max(params.endLine, clampedStart), lines.length);
    return {
        content: lines.slice(clampedStart - 1, clampedEnd).join('\n'),
        startLine: clampedStart,
        endLine: clampedEnd,
        totalLines: lines.length,
    };
}
