import { guidanceText } from './guidance-runtime.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Do not provide this for public-only Obsidian index search; use search_scoped_notes for private scopes.' };
export function getObsidianSearchTools() {
    return [{
            name: 'search_obsidian',
            description: guidanceText('guid-19a46defdbcc2c1b', 'Run Obsidian built-in indexed search through its CLI and return bounded matching public paths. This is public-global only because Obsidian does not understand MCPVault private scopes; authenticated callers must use search_scoped_notes. Set context=true for matching line context. Requires Obsidian to be running with CLI enabled.'),
            inputSchema: { type: 'object', properties: {
                    query: { type: 'string', description: guidanceText('guid-6a6d604a600aa219', 'Text or Obsidian search query') },
                    pathPrefix: { type: 'string', description: guidanceText('guid-9f13a02c99d46d44', 'Optional relative vault folder') },
                    context: { type: 'boolean', description: guidanceText('guid-f01a462c377b1c8d', 'Use search:context for matching lines'), default: false },
                    caseSensitive: { type: 'boolean', default: false },
                    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
                    maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000, description: guidanceText('guid-9345c63bd0a6cf20', 'Maximum compact JSON characters returned') },
                    accessToken, prettyPrint,
                }, required: ['query'] },
        }];
}
