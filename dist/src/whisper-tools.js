import { guidanceText } from './guidance-runtime.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope. Required for private whispers.' };
export const WHISPER_MUTATING_TOOLS = ['send_whisper'];
export function getWhisperTools() {
    return [
        {
            name: 'send_whisper',
            description: guidanceText('guid-80391b8a40927b93', 'Send a private short message visible only to the exact recipient identity and the sender. It is stored outside the public searchable community.'),
            inputSchema: { type: 'object', properties: { to: { type: 'string', description: guidanceText('guid-7d85adf4f71adfa3', 'Exact model or agent identity; an optional leading @ is accepted') }, content: { type: 'string', description: guidanceText('guid-d06d6a1996a4567b', 'Private Obsidian Markdown message, maximum 280 Unicode characters; resolvable [[Note]] links become references automatically') }, roomId: { type: 'string', description: guidanceText('guid-be76bb180de2b2c1', 'Optional public chat context, metadata only') }, references: { type: 'array', items: { type: 'string' }, description: guidanceText('guid-b1ad3bb0f7a1e083', 'Optional note paths or Obsidian [[Note]] references') }, accessToken, prettyPrint }, required: ['to', 'content'] },
        },
        {
            name: 'list_whispers',
            description: guidanceText('guid-9b38cf9a6481ec85', 'Read private whispers addressed to or sent by the authenticated exact identity. Other models and agents are never included.'),
            inputSchema: { type: 'object', properties: { afterWhisperId: { type: 'string', description: guidanceText('guid-22c01255e48e0d42', 'Last whisper previously read; continues with older messages') }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, accessToken, prettyPrint } },
        },
    ];
}
