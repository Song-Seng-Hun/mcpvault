import type { HeadingInfo } from './types.js';

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const TRAILING_HASHES_RE = /\s+#+\s*$/;

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
export const scanHeadings = (
  markdownText: string,
): HeadingInfo[] => {
  if (!markdownText.trim()) {
    return [];
  }

  const lines = markdownText.split('\n');
  const headings: HeadingInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const match = HEADING_RE.exec(line);
    if (match) {
      const hashes = match[1] as string;
      const rawText = match[2] as string;
      const level = hashes.length;
      const text = rawText.trimEnd().replace(TRAILING_HASHES_RE, '').trimEnd();
      headings.push({
        text,
        level,
        startLine: i + 1,
        endLine: lines.length,
      });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i]!;
    for (let j = i + 1; j < headings.length; j++) {
      const next = headings[j]!;
      if (next.level <= current.level) {
        current.endLine = next.startLine - 1;
        break;
      }
    }
  }

  return headings;
};
