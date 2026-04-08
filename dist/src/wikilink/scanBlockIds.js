const BLOCK_ID_RE = /\^([a-zA-Z0-9_-]+)\s*$/;
/**
 * Scan markdown content for Obsidian block-id anchors (^identifier)
 * and identify the containing block for each.
 *
 * Block boundary rules:
 * - Paragraphs: delimited by blank lines
 * - List items: the full list (including continuation lines)
 * - Code fences: from opening ``` to closing ```
 * - Callouts: from `> [!type]` through consecutive `>` prefixed lines
 * - Tables: consecutive lines starting with `|`
 *
 * The `^block-id` anchor appears at the end of the last line of the block.
 * Lines are 1-indexed.
 *
 * @param markdownText - Full markdown content (without frontmatter)
 * @returns Array of block-id info with containing block boundaries
 *
 * @see {@link BlockIdInfo}
 */
export const scanBlockIds = (markdownText) => {
    if (!markdownText.trim()) {
        return [];
    }
    const lines = markdownText.split('\n');
    const results = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = BLOCK_ID_RE.exec(line);
        if (!match) {
            continue;
        }
        const id = match[1];
        const endLine = i + 1;
        const startLine = findBlockStart(lines, i);
        results.push({
            id,
            startLine,
            endLine,
        });
    }
    return results;
};
/**
 * Walk backwards from the anchor line to find the start of the containing block.
 *
 * @param lines - All lines of the document
 * @param anchorIndex - 0-indexed position of the line carrying the ^anchor
 * @returns 1-indexed start line of the containing block
 */
const findBlockStart = (lines, anchorIndex) => {
    const anchorLine = lines[anchorIndex];
    if (isClosingCodeFence(anchorLine, lines, anchorIndex)) {
        for (let i = anchorIndex - 1; i >= 0; i--) {
            if (/^```/.test(lines[i])) {
                return i + 1;
            }
        }
        return 1;
    }
    if (/^>/.test(anchorLine)) {
        let start = anchorIndex;
        for (let i = anchorIndex - 1; i >= 0; i--) {
            if (/^>/.test(lines[i])) {
                start = i;
            }
            else {
                break;
            }
        }
        return start + 1;
    }
    if (/^[-*]|\d+\./.test(anchorLine.trimStart())) {
        return findListStart(lines, anchorIndex);
    }
    if (/^\|/.test(anchorLine)) {
        let start = anchorIndex;
        for (let i = anchorIndex - 1; i >= 0; i--) {
            if (/^\|/.test(lines[i])) {
                start = i;
            }
            else {
                break;
            }
        }
        return start + 1;
    }
    return findParagraphStart(lines, anchorIndex);
};
const isClosingCodeFence = (line, lines, index) => {
    if (/^```/.test(line)) {
        let fenceCount = 0;
        for (let i = 0; i < index; i++) {
            if (/^```/.test(lines[i])) {
                fenceCount++;
            }
        }
        return fenceCount % 2 === 1;
    }
    return false;
};
const findListStart = (lines, anchorIndex) => {
    let start = anchorIndex;
    for (let i = anchorIndex - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^[-*]\s|\d+\.\s|^\s+\S/.test(line)) {
            start = i;
        }
        else {
            break;
        }
    }
    return start + 1;
};
const findParagraphStart = (lines, anchorIndex) => {
    let start = anchorIndex;
    for (let i = anchorIndex - 1; i >= 0; i--) {
        if (lines[i].trim() === '') {
            break;
        }
        start = i;
    }
    return start + 1;
};
