import type { ExtractionResult } from './types.js';
import { extractFragment } from './extractFragment.js';

/**
 * The parsed components of an Obsidian wiki link.
 *
 * @example
 * parseWikiLink('[[Doc Name#Heading|Display]]')
 * // { document: 'Doc Name', fragment: 'Heading' }
 */
export interface ParsedWikiLink {
  /**
   * The document name as it appears inside [[ ]] — without brackets,
   * without display text, without the fragment.
   * Append `.md` to get the filesystem filename.
   */
  document: string;

  /**
   * The fragment portion after `#`, if present.
   * Includes the `^` prefix for block-ids.
   * `undefined` when no fragment was specified.
   */
  fragment: string | undefined;
}

/**
 * Result of resolving a wiki link against document content.
 * When no fragment is specified, returns the full content.
 * When a fragment is specified, returns the extraction result.
 */
export type WikiLinkResolution =
  | { type: 'full'; content: string }
  | { type: 'fragment'; extraction: ExtractionResult };

/**
 * Parse an Obsidian wiki link string into its components.
 *
 * Handles all wiki link forms:
 * - `[[Document Name]]`
 * - `[[Document Name#Heading]]`
 * - `[[Document Name#^block-id]]`
 * - `[[Document Name|Display Text]]`
 * - `[[Document Name#Heading|Display Text]]`
 * - Bare names without brackets
 *
 * @param wikiLinkText - The raw wiki link string, with or without brackets
 * @returns The parsed basename and optional fragment
 *
 * @see {@link ParsedWikiLink}
 */
export const parseWikiLink = (
  wikiLinkText: string,
): ParsedWikiLink => {
  let text = wikiLinkText.trim();

  // Strip [[ ]] brackets if present
  if (text.startsWith('[[')) {
    text = text.slice(2);
  }
  if (text.endsWith(']]')) {
    text = text.slice(0, -2);
  }

  // Strip |display text if present
  const pipeIndex = text.indexOf('|');
  if (pipeIndex !== -1) {
    text = text.slice(0, pipeIndex);
  }

  // Split on first # to separate basename from fragment
  const hashIndex = text.indexOf('#');
  if (hashIndex !== -1) {
    return {
      document: text.slice(0, hashIndex).trim(),
      fragment: text.slice(hashIndex + 1).trim() || undefined,
    };
  }

  return {
    document: text.trim(),
    fragment: undefined,
  };
};

/**
 * Resolve a wiki link against already-loaded markdown content.
 *
 * This is the core resolution function — pure string processing,
 * no filesystem I/O, no runtime dependencies. The caller is responsible
 * for loading the document content (via whatever filesystem is available).
 *
 * When no fragment is specified, returns the full content.
 * When a fragment is specified, delegates to extractFragment.
 *
 * @param markdownContent - The full document content (without frontmatter)
 * @param fragment - The fragment to extract, or undefined for full content
 * @returns The resolution result — full content or fragment extraction
 *
 * @see {@link WikiLinkResolution}
 * @see {@link extractFragment}
 */
export const resolveWikiLink = (
  markdownContent: string,
  fragment: string | undefined,
): WikiLinkResolution => {
  if (!fragment) {
    return {
      type: 'full',
      content: markdownContent,
    };
  }

  return {
    type: 'fragment',
    extraction: extractFragment(markdownContent, fragment),
  };
};
