import type { CallToolResult } from '@modelcontextprotocol/server';
import type { FileSystemService } from '../filesystem.js';
import { parseWikiLink } from './resolveWikiLink.js';
import { NoteLinkService } from '../note-link.js';

export interface WikiLinkToolArgs {
  document: string;
  prettyPrint?: boolean;
  maxChars?: number;
  expectedRevision?: string;
}

/**
 * Handle the `wiki_link` MCP tool call.
 *
 * Resolves an Obsidian wiki-link reference against the vault and returns the
 * matching note. Designed to keep the MCP server request handler slim — all
 * wiki-link specific concerns live here.
 *
 * Response channels per MCP spec 2025-11-25:
 * - Invalid syntax or no match → `isError: true` with an actionable message.
 * - One or more matches → success; `structuredContent` carries `document`,
 *   `path` (the resolved pick), and `alternatives` (the other matched paths,
 *   present only when more than one file shares the basename).
 */
export async function handleWikiLinkTool(
  fileSystem: FileSystemService,
  args: WikiLinkToolArgs,
  canAccessPath: (path: string) => boolean = () => true,
  publicPath: (path: string) => string = path => path,
): Promise<CallToolResult> {
  const indent = args.prettyPrint ? 2 : undefined;

  let parsed: ReturnType<typeof parseWikiLink>;
  try {
    parsed = parseWikiLink(args.document);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid wiki-link syntax';
    return {
      content: [{ type: 'text', text: message }],
      structuredContent: { rawInput: args.document },
      isError: true,
    };
  }

  try {
    const result = await new NoteLinkService(fileSystem, canAccessPath, publicPath).legacy(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, indent) }],
      structuredContent: { document: result.document, path: result.path, revision: result.revision, deprecated: true,
        ...(result.alternatives?.length && { alternatives: result.alternatives }),
        ...(result.nextAction && { nextAction: result.nextAction }), truncated: result.truncated },
    };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Link unavailable' }],
      structuredContent: { document: parsed.document },
      isError: true,
    };
  }
}
