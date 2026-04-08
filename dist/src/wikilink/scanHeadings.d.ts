import type { HeadingInfo } from './types.js';
/**
 * Scan markdown content for headings and compute their section boundaries.
 *
 * Each heading's section extends from its line to the line before the next
 * heading of equal or higher level (or end of content).
 * Sub-headings within a section are included in the parent's range.
 * Lines are 1-indexed.
 *
 * @param markdownText - Full markdown content (without frontmatter)
 * @returns Array of heading info with section boundaries, in document order
 *
 * @see {@link HeadingInfo}
 */
export declare const scanHeadings: (markdownText: string) => HeadingInfo[];
//# sourceMappingURL=scanHeadings.d.ts.map