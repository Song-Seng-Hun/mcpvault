import type { BlockIdInfo } from './types.js';
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
export declare const scanBlockIds: (markdownText: string) => BlockIdInfo[];
//# sourceMappingURL=scanBlockIds.d.ts.map