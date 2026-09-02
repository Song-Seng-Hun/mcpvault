import type { BacklinkMatch, OutlinkMatch, UnresolvedLinkMatch } from './types.js';
/**
 * Find Obsidian wikilinks in a note that refer to a target note.
 *
 * This deliberately works on raw lines so the result can point an agent to
 * an exact line without returning the source note's full content. Fenced code
 * blocks are ignored because links shown as examples there are not graph
 * edges. Inline code is left alone: Obsidian can still index a wikilink that
 * appears in inline code, and deciding otherwise would require a Markdown
 * parser with different semantics from Obsidian.
 */
export declare function findBacklinkMatches(content: string, targetPath: string): BacklinkMatch[];
export declare function extractWikiLinkOccurrences(content: string): Array<OutlinkMatch>;
/**
 * Extract the two Obsidian-compatible internal link forms that can create a
 * graph edge: wikilinks and relative Markdown links. The result stays line
 * based and bounded so callers can provide a useful locator without loading
 * the source note again.
 */
export declare function extractObsidianLinkOccurrences(content: string): Array<OutlinkMatch>;
export declare function findUnresolvedLinkMatches(content: string, vaultFiles: string[]): UnresolvedLinkMatch[];
export declare function resolveWikiLinkTargets(target: string, vaultFiles: string[]): string[];
//# sourceMappingURL=backlinks.d.ts.map