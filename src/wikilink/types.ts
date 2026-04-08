/**
 * In an Obsidian wiki link, when there is a hash sign (#),
 * the fragment can reference either a heading or a block-id (^identifier).
 *
 * @see {@link ParsedFragmentResult}
 */
export type ObsidianLinkFragmentType =
  | 'blockId'
  | 'heading';

/**
 * Result of parsing the fragment portion of an Obsidian wiki link.
 *
 * @example
 * parseFragment('#Summary')       // { type: 'heading', target: 'Summary' }
 * parseFragment('#^infoBlock')    // { type: 'blockId', target: 'infoBlock' }
 */
export interface ParsedFragmentResult {
  /**
   * Discriminant indicating how the link was annotated,
   * so we know which scanning mode to use inside the document.
   *
   * @see {@link ObsidianLinkFragmentType}
   */
  type: ObsidianLinkFragmentType;

  /**
   * The identifier used in the Obsidian wiki link,
   * with the leading `#` and `^` stripped.
   */
  target: string;
}

/**
 * A heading found in a markdown document with its section boundaries.
 * Lines are 1-indexed. The section extends from the heading line
 * to the line before the next heading of equal or higher level,
 * or to the end of the document.
 */
export interface HeadingInfo {
  /** The heading text, stripped of leading `#` characters and trailing hashes */
  text: string;
  /** The heading level (1-6, corresponding to # through ######) */
  level: number;
  /** First line of the section (the heading line itself), 1-indexed */
  startLine: number;
  /** Last line of the section (before the next same-or-higher heading, or end of content), 1-indexed */
  endLine: number;
}

/**
 * A block-id anchor found in a markdown document with its containing block boundaries.
 * Lines are 1-indexed. The block is the structural unit containing the anchor:
 * a paragraph, list, callout, code fence, or table.
 */
export interface BlockIdInfo {
  /** The block identifier, without the leading `^` */
  id: string;
  /** First line of the containing block, 1-indexed */
  startLine: number;
  /** Last line of the containing block (the line carrying the ^anchor), 1-indexed */
  endLine: number;
}

/**
 * Successful extraction result.
 * Content is bare — no wrappers, no metadata markers.
 * Source metadata is in the result object, not in the content string.
 */
export interface ExtractionSuccess {
  found: true;
  /** Bare section text, ready for direct use in context */
  content: string;
  /** The matched heading text, if extraction was heading-based */
  heading?: string;
  /** The heading level, if extraction was heading-based */
  level?: number;
  /** First line of the extracted content, 1-indexed */
  startLine: number;
  /** Last line of the extracted content, 1-indexed */
  endLine: number;
}

/**
 * Failed extraction with structured error reporting.
 * Includes available headings and block IDs so the caller
 * can correct the reference without a second round-trip.
 */
export interface ExtractionError {
  found: false;
  /** Error identifier */
  error: string;
  /** The fragment that was requested but not found */
  fragment: string;
  /** Available headings in the document for correction */
  availableHeadings: Array<{ text: string; level: number }>;
  /** Available block IDs in the document for correction */
  availableBlockIds: string[];
}

/**
 * Discriminated union for extraction results.
 * Check `found` to narrow the type.
 *
 * @example
 * const result = extractFragment(content, '#Summary')
 * if (result.found) {
 *   console.log(result.content)
 * } else {
 *   console.log(result.availableHeadings)
 * }
 */
export type ExtractionResult = ExtractionSuccess | ExtractionError;
