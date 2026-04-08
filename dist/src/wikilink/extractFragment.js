import { parseFragment } from './parseFragment.js';
import { scanHeadings } from './scanHeadings.js';
import { scanBlockIds } from './scanBlockIds.js';
/**
 * Extract a fragment from markdown content by Obsidian wiki link reference.
 *
 * Supports:
 * - Heading references: `'Heading Text'` or `'#Heading Text'`
 * - Block-id references: `'^block-id'` or `'#^block-id'`
 *
 * Returns bare content — no wrappers, no metadata in the content string.
 * Source metadata (heading, level, line numbers) is in the result object.
 *
 * @param markdownText - Full markdown content (without frontmatter)
 * @param fragmentRef - Fragment reference from a wiki link (heading text or ^block-id)
 * @returns Extraction result — check `found` to narrow the discriminated union
 *
 * @see {@link ExtractionResult}
 *
 * @example
 * const result = extractFragment(content, '#Summary')
 * if (result.found) {
 *   console.log(result.content) // bare section text
 * }
 */
export const extractFragment = (markdownText, fragmentRef) => {
    const parsed = parseFragment(fragmentRef);
    const lines = markdownText.split('\n');
    if (parsed.type === 'heading') {
        return extractByHeading(markdownText, lines, parsed.target);
    }
    return extractByBlockId(markdownText, lines, parsed.target);
};
const extractByHeading = (markdownText, lines, target) => {
    const headings = scanHeadings(markdownText);
    const match = headings.find((h) => h.text === target);
    if (!match) {
        const blockIds = scanBlockIds(markdownText);
        return {
            found: false,
            error: 'fragment_not_found',
            fragment: target,
            availableHeadings: headings.map((h) => ({
                text: h.text,
                level: h.level,
            })),
            availableBlockIds: blockIds.map((b) => b.id),
        };
    }
    const sectionLines = lines.slice(match.startLine - 1, match.endLine);
    return {
        found: true,
        content: sectionLines.join('\n'),
        heading: match.text,
        level: match.level,
        startLine: match.startLine,
        endLine: match.endLine,
    };
};
const extractByBlockId = (markdownText, lines, target) => {
    const blockIds = scanBlockIds(markdownText);
    const match = blockIds.find((b) => b.id === target);
    if (!match) {
        const headings = scanHeadings(markdownText);
        return {
            found: false,
            error: 'fragment_not_found',
            fragment: `^${target}`,
            availableHeadings: headings.map((h) => ({
                text: h.text,
                level: h.level,
            })),
            availableBlockIds: blockIds.map((b) => b.id),
        };
    }
    const sectionLines = lines.slice(match.startLine - 1, match.endLine);
    return {
        found: true,
        content: sectionLines.join('\n'),
        startLine: match.startLine,
        endLine: match.endLine,
    };
};
