import type { BacklinkMatch, OutlinkMatch, UnresolvedLinkMatch } from './types.js';
/**
 * Build an offset-preserving mask for Markdown regions that cannot create an
 * Obsidian graph edge or inline tag. The scan is deliberately smaller than a full Markdown
 * parser, but it handles the literal forms used in notes and examples:
 * matching fences, closed backtick code spans, and escaped link openers.
 */
export declare function buildMarkdownLiteralMask(content: string): Uint8Array;
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
export declare function findBacklinkMatches(content: string, targetPath: string): BacklinkMatch[];
export declare function extractWikiLinkOccurrences(content: string): Array<OutlinkMatch>;
/**
 * Extract the two Obsidian-compatible internal link forms that can create a
 * graph edge: wikilinks and relative Markdown links. The result stays line
 * based and bounded so callers can provide a useful locator without loading
 * the source note again.
 */
export declare function extractObsidianLinkOccurrences(content: string, limit?: number): Array<OutlinkMatch>;
export declare function findUnresolvedLinkMatches(content: string, vaultFiles: string[]): UnresolvedLinkMatch[];
export declare function resolveWikiLinkTargets(target: string, vaultFiles: string[]): string[];
//# sourceMappingURL=backlinks.d.ts.map