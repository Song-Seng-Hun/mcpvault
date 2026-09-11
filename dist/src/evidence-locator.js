import { createHash } from 'node:crypto';
/** Resolve syntax against this exact body, never semantic truth or access.
 * One sequential pass, constant scan state: no whole-body split or literal mask.
 * Coordinates and quote hashes preserve original body newlines (including CRLF).
 */
export function resolveEvidenceLocator(content, locator, revision) {
    const specified = ['revision', 'heading', 'blockId', 'startLine', 'endLine', 'quoteHash'].some(key => locator[key] !== undefined);
    const fail = (issue) => ({ valid: false, specified, issue });
    if (locator.revision !== undefined && (typeof locator.revision !== 'string' || !/^[a-f0-9]{64}$/i.test(locator.revision) || (revision !== undefined && locator.revision !== revision)))
        return fail('stale_revision');
    const hasRange = locator.startLine !== undefined || locator.endLine !== undefined;
    if (hasRange && (!Number.isSafeInteger(locator.startLine) || !Number.isSafeInteger(locator.endLine) || locator.startLine < 1 || locator.endLine < locator.startLine))
        return fail('invalid_range');
    if (locator.quoteHash !== undefined && (!hasRange || typeof locator.quoteHash !== 'string' || !/^[a-f0-9]{64}$/i.test(locator.quoteHash)))
        return fail('invalid_quote');
    if (locator.heading !== undefined && (typeof locator.heading !== 'string' || !locator.heading.trim() || locator.heading.length > 300))
        return fail('invalid_heading');
    if (locator.blockId !== undefined && (typeof locator.blockId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(locator.blockId)))
        return fail('invalid_block');
    if (!hasRange && locator.heading === undefined && locator.blockId === undefined)
        return { valid: true, specified };
    const wanted = locator.heading?.replace(/^#+\s*/, '').trim().toLowerCase();
    let offset = 0, line = 1, total = 1, fenceChar = '', fenceLength = 0;
    let headingStart = 0, headingEnd = 0, headingLevel = 0, blockLine = 0, blocks = 0;
    let quoteStart = -1, quoteEnd = -1;
    while (offset <= content.length) {
        const newline = content.indexOf('\n', offset), end = newline < 0 ? content.length : newline;
        const raw = content.slice(offset, end), text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        total = line;
        if (line === locator.startLine)
            quoteStart = offset;
        if (line === locator.endLine)
            quoteEnd = end;
        const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
        if (fenceChar) {
            if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLength && !fence[2].trim()) {
                fenceChar = '';
                fenceLength = 0;
            }
        }
        else if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
            fenceChar = fence[1][0];
            fenceLength = fence[1].length;
        }
        else {
            const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(text);
            if (heading) {
                if (headingStart && !headingEnd && heading[1].length <= headingLevel)
                    headingEnd = line - 1;
                if (!headingStart && wanted !== undefined && (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim().toLowerCase() === wanted) {
                    headingStart = line;
                    headingLevel = heading[1].length;
                }
            }
            const block = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(text);
            if (block && locator.blockId !== undefined && block[1].toLowerCase() === locator.blockId.toLowerCase()) {
                blocks++;
                blockLine = line;
            }
        }
        if (newline < 0)
            break;
        offset = end + 1;
        line++;
    }
    if (hasRange && (quoteStart < 0 || quoteEnd < 0))
        return fail('invalid_range');
    if (locator.heading !== undefined && !headingStart)
        return fail('missing_heading');
    if (!headingEnd)
        headingEnd = total;
    if (locator.blockId !== undefined && blocks !== 1)
        return fail(blocks ? 'ambiguous_block' : 'missing_block');
    if (headingStart && ((hasRange && (locator.startLine < headingStart || locator.endLine > headingEnd)) || (blockLine && (blockLine < headingStart || blockLine > headingEnd))))
        return fail('outside_heading');
    if (hasRange && blockLine && (blockLine < locator.startLine || blockLine > locator.endLine))
        return fail('outside_range');
    if (locator.quoteHash && createHash('sha256').update(content.slice(quoteStart, quoteEnd)).digest('hex') !== locator.quoteHash.toLowerCase())
        return fail('stale_quote');
    const startLine = hasRange ? locator.startLine : blockLine || headingStart;
    const endLine = hasRange ? locator.endLine : blockLine || headingEnd;
    return { valid: true, specified, preferredLine: blockLine || startLine, startLine, endLine };
}
