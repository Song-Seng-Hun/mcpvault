import type { ExtractionResult } from './types.js';
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
export declare const extractFragment: (markdownText: string, fragmentRef: string) => ExtractionResult;
//# sourceMappingURL=extractFragment.d.ts.map