import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FileSystemService } from '../filesystem.js';
export interface WikiLinkToolArgs {
    document: string;
    fragment?: string;
    prettyPrint?: boolean;
}
/**
 * Handle the `wiki_link` MCP tool call.
 *
 * Resolves an Obsidian wiki-link reference against the vault and returns the
 * matching note (or a fragment of it). Designed to keep the MCP server
 * request handler slim — all wiki-link specific concerns live here.
 *
 * Response channels per MCP spec 2025-11-25:
 * - Invalid syntax or no match → `isError: true` with an actionable message.
 * - One or more matches → success; `structuredContent` carries `document`,
 *   optional `fragment`, `path`, `matches` (winner at index 0), and
 *   `ambiguous` (true iff multiple files share the basename).
 */
export declare function handleWikiLinkTool(fileSystem: FileSystemService, args: WikiLinkToolArgs): Promise<CallToolResult>;
//# sourceMappingURL=wikiLinkTool.d.ts.map