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
export declare function findUnresolvedLinkMatches(content: string, vaultFiles: string[]): UnresolvedLinkMatch[];
//# sourceMappingURL=backlinks.d.ts.map