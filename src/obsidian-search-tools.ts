import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Do not provide this for public-only Obsidian index search; use search_scoped_notes for private scopes.' } as const;

export function getObsidianSearchTools(): Tool[] {
  return [{
    name: 'search_obsidian',
    description: 'Run Obsidian built-in indexed search through its CLI and return matching public vault paths. This is public-global only because Obsidian does not understand MCPVault private scopes; authenticated callers must use search_scoped_notes. Set context=true for matching line context. Requires Obsidian to be running with CLI enabled.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Text or Obsidian search query' },
      pathPrefix: { type: 'string', description: 'Optional relative vault folder' },
      context: { type: 'boolean', description: 'Use search:context for matching lines', default: false },
      caseSensitive: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      accessToken, prettyPrint,
    }, required: ['query'] },
  }];
}
