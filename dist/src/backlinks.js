const WIKI_LINK_PATTERN = /!?(\[\[[^\]]+\]\])/g;
// Obsidian also indexes ordinary Markdown links whose destination is a note.
// Keep this intentionally small: external URLs, images, and anchor-only links
// are not vault graph edges.
const MARKDOWN_LINK_PATTERN = /(?<!!)(?:\[([^\]]*)\])\(\s*(<[^>]+>|[^\s)]+)(?:\s+['"][^)]*['"])?\s*\)/g;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const BLOCK_QUOTE_PATTERN = /^ {0,3}>/;
const INTERRUPTING_LIST_PATTERN = /^ {0,3}(?:[*+-][ \t]+\S|1[.)][ \t]+\S)/;
const THEMATIC_BREAK_PATTERN = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const SETEXT_UNDERLINE_PATTERN = /^ {0,3}(?:=+|-+)[ \t]*$/;
const HTML_BLOCK_TAG_START_PATTERN = /^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \t>]|$)|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$))/i;
const HTML_BLOCK_LITERAL_START_PATTERN = /^ {0,3}(?:<!--|<\?|<!\[CDATA\[|<![A-Z])/;
function markRange(mask, start, end) {
    mask.fill(1, start, end);
}
function startsParagraphInterruptingBlock(line) {
    return ATX_HEADING_PATTERN.test(line)
        || BLOCK_QUOTE_PATTERN.test(line)
        || INTERRUPTING_LIST_PATTERN.test(line)
        || THEMATIC_BREAK_PATTERN.test(line)
        || SETEXT_UNDERLINE_PATTERN.test(line)
        || HTML_BLOCK_TAG_START_PATTERN.test(line)
        || HTML_BLOCK_LITERAL_START_PATTERN.test(line);
}
/**
 * Build an offset-preserving mask for Markdown regions that cannot create an
 * Obsidian graph edge or inline tag. The scan is deliberately smaller than a full Markdown
 * parser, but it handles the literal forms used in notes and examples:
 * matching fences, closed backtick code spans, and escaped link openers.
 */
export function buildMarkdownLiteralMask(content) {
    const mask = new Uint8Array(content.length);
    const backtickRuns = [];
    let fenceChar = '';
    let fenceLength = 0;
    let segment = 0;
    let lineStart = 0;
    while (lineStart <= content.length) {
        const newline = content.indexOf('\n', lineStart);
        const lineEnd = newline === -1 ? content.length : newline;
        const rawLine = content.slice(lineStart, lineEnd);
        const line = rawLine.replace(/\r$/, '');
        const fence = FENCE_PATTERN.exec(line);
        if (fenceChar || fence) {
            markRange(mask, lineStart, lineEnd);
            if (fence) {
                const markers = fence[1];
                const trailing = fence[2];
                const char = markers[0];
                if (!fenceChar) {
                    fenceChar = char;
                    fenceLength = markers.length;
                    segment += 1;
                }
                else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
                    fenceChar = '';
                    fenceLength = 0;
                    segment += 1;
                }
            }
        }
        else {
            const interruptsParagraph = startsParagraphInterruptingBlock(line);
            if (interruptsParagraph)
                segment += 1;
            let precedingBackslashes = 0;
            for (let offset = lineStart; offset < lineEnd; offset += 1) {
                const char = content[offset];
                const escaped = precedingBackslashes % 2 === 1;
                if (char === '[' && escaped)
                    mask[offset] = 1;
                if (char === '`') {
                    const start = offset;
                    while (offset + 1 < lineEnd && content[offset + 1] === '`')
                        offset += 1;
                    backtickRuns.push({ start, length: offset - start + 1, segment, escaped });
                    precedingBackslashes = 0;
                    continue;
                }
                precedingBackslashes = char === '\\' ? precedingBackslashes + 1 : 0;
            }
            if (interruptsParagraph || line.trim() === '')
                segment += 1;
        }
        if (newline === -1)
            break;
        lineStart = newline + 1;
    }
    const nextMatchingRun = new Int32Array(backtickRuns.length).fill(-1);
    const lastByDelimiter = new Map();
    for (let index = backtickRuns.length - 1; index >= 0; index -= 1) {
        const run = backtickRuns[index];
        const key = `${run.segment}:${run.length}`;
        nextMatchingRun[index] = lastByDelimiter.get(key) ?? -1;
        lastByDelimiter.set(key, index);
    }
    for (let index = 0; index < backtickRuns.length;) {
        if (backtickRuns[index].escaped) {
            index += 1;
            continue;
        }
        const closerIndex = nextMatchingRun[index];
        if (closerIndex === -1) {
            index += 1;
            continue;
        }
        const opening = backtickRuns[index];
        const closing = backtickRuns[closerIndex];
        markRange(mask, opening.start, closing.start + closing.length);
        index = closerIndex + 1;
    }
    return mask;
}
function applyLineMask(line, lineOffset, mask) {
    const localMask = mask.subarray(lineOffset, lineOffset + line.length);
    let start = localMask.indexOf(1);
    if (start === -1)
        return line;
    const projected = [];
    let cursor = 0;
    while (start !== -1) {
        if (start > cursor)
            projected.push(line.slice(cursor, start));
        const nextUnmasked = localMask.indexOf(0, start);
        const end = nextUnmasked === -1 ? line.length : nextUnmasked;
        projected.push(' '.repeat(end - start));
        cursor = end;
        start = localMask.indexOf(1, end);
    }
    if (cursor < line.length)
        projected.push(line.slice(cursor));
    return projected.join('');
}
/**
 * Find Obsidian internal links in a note that refer to a target note.
 *
 * This deliberately works on raw lines so the result can point an agent to
 * an exact line without returning the source note's full content. Matching
 * fenced blocks, closed inline backtick spans, and escaped link openers are
 * ignored because literal examples are not graph edges. Unmatched backticks
 * remain ordinary text. Top-level indented-code parsing is intentionally out
 * of scope because it requires complete block semantics to distinguish nested
 * list content without hiding valid links.
 */
export function findBacklinkMatches(content, targetPath) {
    const normalizedTarget = normalizeTarget(targetPath);
    const targetBasename = basenameWithoutExtension(normalizedTarget);
    return extractObsidianLinkOccurrences(content)
        .filter(({ target }) => matchesTarget(target, normalizedTarget, targetBasename))
        .map(({ line, link, context, heading, targetHeading, targetBlockId }) => ({
        line,
        link,
        context,
        path: '',
        ...(heading && { heading }),
        ...(targetHeading && { targetHeading }),
        ...(targetBlockId && { targetBlockId }),
    }));
}
export function extractWikiLinkOccurrences(content) {
    return extractLinkOccurrences(content, false);
}
/**
 * Extract the two Obsidian-compatible internal link forms that can create a
 * graph edge: wikilinks and relative Markdown links. The result stays line
 * based and bounded so callers can provide a useful locator without loading
 * the source note again.
 */
export function extractObsidianLinkOccurrences(content, limit = Number.POSITIVE_INFINITY) {
    return extractLinkOccurrences(content, true, limit);
}
function extractLinkOccurrences(content, includeMarkdown, limit = Number.POSITIVE_INFINITY) {
    const matches = [];
    if (!(limit > 0))
        return matches;
    const literalMask = buildMarkdownLiteralMask(content);
    let lineOffset = 0;
    let currentHeading;
    for (let index = 0; lineOffset <= content.length && matches.length < limit; index += 1) {
        const newline = content.indexOf('\n', lineOffset);
        const rawLine = content.slice(lineOffset, newline === -1 ? content.length : newline);
        const line = rawLine.replace(/\r$/, '');
        const searchableLine = applyLineMask(line, lineOffset, literalMask);
        if (ATX_HEADING_PATTERN.test(searchableLine)) {
            const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
            if (heading)
                currentHeading = heading[1].trim();
        }
        WIKI_LINK_PATTERN.lastIndex = 0;
        const lineMatches = [];
        // Each syntax is already in source order; only its first K valid matches
        // can occur among the first K of their union. Infinity retains all matches.
        const remaining = Math.ceil(limit - matches.length);
        let match;
        while (lineMatches.length < remaining && (match = WIKI_LINK_PATTERN.exec(searchableLine)) !== null) {
            const link = line.slice(match.index, match.index + match[0].length);
            const parsed = linkDocument(link);
            if (!parsed.document)
                continue;
            lineMatches.push({ offset: match.index, item: {
                    line: index + 1,
                    link,
                    target: parsed.document,
                    context: line.trim().slice(0, 300),
                    ...(currentHeading && { heading: currentHeading }),
                    ...(parsed.targetHeading && { targetHeading: parsed.targetHeading }),
                    ...(parsed.targetBlockId && { targetBlockId: parsed.targetBlockId }),
                } });
        }
        if (includeMarkdown) {
            MARKDOWN_LINK_PATTERN.lastIndex = 0;
            let markdownCount = 0;
            while (markdownCount < remaining && (match = MARKDOWN_LINK_PATTERN.exec(searchableLine)) !== null) {
                const link = line.slice(match.index, match.index + match[0].length);
                const parsed = markdownLinkDocument(match[2]);
                if (!parsed.document)
                    continue;
                markdownCount += 1;
                lineMatches.push({ offset: match.index, item: {
                        line: index + 1,
                        link,
                        target: parsed.document,
                        context: line.trim().slice(0, 300),
                        ...(currentHeading && { heading: currentHeading }),
                        ...(parsed.targetHeading && { targetHeading: parsed.targetHeading }),
                        ...(parsed.targetBlockId && { targetBlockId: parsed.targetBlockId }),
                    } });
            }
        }
        lineMatches.sort((left, right) => left.offset - right.offset);
        for (const match of lineMatches) {
            if (matches.length >= limit)
                break;
            matches.push(match.item);
        }
        if (newline === -1)
            break;
        lineOffset = newline + 1;
    }
    return matches;
}
export function findUnresolvedLinkMatches(content, vaultFiles) {
    const normalizedFiles = vaultFiles.map(normalizePath);
    return extractObsidianLinkOccurrences(content)
        .filter(({ target }) => resolveWikiLinkTargets(target, normalizedFiles).length === 0)
        .map(({ target, line, link, context, heading, targetHeading, targetBlockId }) => ({
        target,
        line,
        link,
        context,
        path: '',
        ...(heading && { heading }),
        ...(targetHeading && { targetHeading }),
        ...(targetBlockId && { targetBlockId }),
    }));
}
export function resolveWikiLinkTargets(target, vaultFiles) {
    const normalizedTarget = normalizePath(target);
    if (!normalizedTarget)
        return [];
    const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(normalizedTarget);
    return vaultFiles.filter((file) => {
        const normalizedFile = normalizePath(file);
        if (hasExtension) {
            return normalizedTarget.includes('/')
                ? normalizedFile === normalizedTarget
                : basenameWithoutExtension(normalizedFile) === normalizedTarget;
        }
        const fileWithoutExtension = normalizedFile.replace(/\.[^/.]+$/, '');
        return normalizedTarget.includes('/')
            ? fileWithoutExtension === normalizedTarget
            : basenameWithoutExtension(fileWithoutExtension) === normalizedTarget;
    });
}
function parseAnchor(document) {
    const hashIndex = document.indexOf('#');
    if (hashIndex === -1)
        return { document: document.trim() };
    const target = document.slice(hashIndex + 1).trim();
    const result = { document: document.slice(0, hashIndex).trim() };
    if (!target)
        return result;
    let decodedTarget = target;
    try {
        decodedTarget = decodeURIComponent(target);
    }
    catch { /* retain the safe raw anchor */ }
    if (decodedTarget.startsWith('^'))
        result.targetBlockId = decodedTarget.slice(1).trim();
    else
        result.targetHeading = decodedTarget;
    return result;
}
function linkDocument(rawLink) {
    const bracketed = rawLink.startsWith('!') ? rawLink.slice(1) : rawLink;
    let document = bracketed.slice(2, -2).replace(/\\\|/g, '|');
    const pipeIndex = document.indexOf('|');
    if (pipeIndex !== -1)
        document = document.slice(0, pipeIndex);
    return parseAnchor(document);
}
function markdownLinkDocument(rawDestination) {
    let document = rawDestination.trim();
    if (document.startsWith('<') && document.endsWith('>'))
        document = document.slice(1, -1).trim();
    if (!document || /^[a-z][a-z0-9+.-]*:/i.test(document) || document.startsWith('#'))
        return { document: '' };
    let anchor = '';
    const hashIndex = document.indexOf('#');
    if (hashIndex !== -1) {
        anchor = document.slice(hashIndex);
        document = document.slice(0, hashIndex);
    }
    const queryIndex = document.indexOf('?');
    if (queryIndex !== -1)
        document = document.slice(0, queryIndex);
    try {
        document = decodeURIComponent(document);
    }
    catch { /* retain the raw safe path */ }
    // Encoded # belongs to the filename; only a literal URL fragment is an anchor.
    return { ...parseAnchor(anchor), document: document.trim() };
}
function normalizeTarget(path) {
    return normalizePath(path).replace(/\.md$/i, '');
}
function normalizePath(path) {
    return path
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/^\.\//, '')
        .toLowerCase();
}
function basenameWithoutExtension(path) {
    const slash = path.lastIndexOf('/');
    return path.slice(slash + 1);
}
function matchesTarget(document, normalizedTarget, targetBasename) {
    const normalizedDocument = normalizeTarget(document);
    if (!normalizedDocument)
        return false;
    return normalizedDocument.includes('/')
        ? normalizedDocument === normalizedTarget
        : normalizedDocument === targetBasename;
}
