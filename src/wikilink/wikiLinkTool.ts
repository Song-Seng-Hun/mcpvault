import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FileSystemService } from '../filesystem.js';
import { parseWikiLink, resolveWikiLink } from './resolveWikiLink.js';

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
export async function handleWikiLinkTool(
  fileSystem: FileSystemService,
  args: WikiLinkToolArgs,
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

  const fragment = args.fragment || parsed.fragment;
  const paths = await fileSystem.findPathForWikiLink(parsed.document);

  if (paths.length === 0) {
    const fragmentNote = fragment ? ` (fragment: ${fragment})` : '';
    return {
      content: [{
        type: 'text',
        text: `No file found for [[${parsed.document}]]${fragmentNote}. Use search_notes or list_directory to find the correct name.`,
      }],
      structuredContent: {
        document: parsed.document,
        ...(fragment !== undefined && { fragment }),
      },
      isError: true,
    };
  }

  const resolvedPath = paths[0] as string;
  const ambiguous = paths.length > 1;
  const matches = paths.map((p) => ({ path: p }));
  const note = await fileSystem.readNote(resolvedPath);
  const resolution = resolveWikiLink(note.content, fragment);

  const baseStructured = {
    document: parsed.document,
    ...(fragment !== undefined && { fragment }),
    path: resolvedPath,
    matches,
    ambiguous,
  };

  if (resolution.type === 'full') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path: resolvedPath,
          fm: note.frontmatter,
          content: resolution.content,
        }, null, indent),
      }],
      structuredContent: baseStructured,
    };
  }

  const { extraction } = resolution;

  if (!extraction.found) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ path: resolvedPath, ...extraction }, null, indent),
      }],
      structuredContent: baseStructured,
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        path: resolvedPath,
        fm: note.frontmatter,
        content: extraction.content,
        section: {
          heading: extraction.heading,
          level: extraction.level,
          startLine: extraction.startLine,
          endLine: extraction.endLine,
        },
      }, null, indent),
    }],
    structuredContent: baseStructured,
  };
}
