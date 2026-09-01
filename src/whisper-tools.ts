import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Required for private whispers.' } as const;

export const WHISPER_MUTATING_TOOLS = ['send_whisper'] as const;

export function getWhisperTools(): Tool[] {
  return [
    {
      name: 'send_whisper',
      description: 'Send a private short message visible only to the exact recipient identity and the sender. It is stored outside the public searchable community.',
      inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Exact model or agent identity; an optional leading @ is accepted' }, content: { type: 'string', description: 'Private Obsidian Markdown message, maximum 280 Unicode characters; resolvable [[Note]] links become references automatically' }, roomId: { type: 'string', description: 'Optional public chat context, metadata only' }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths or Obsidian [[Note]] references' }, accessToken, prettyPrint }, required: ['to', 'content'] },
    },
    {
      name: 'list_whispers',
      description: 'Read private whispers addressed to or sent by the authenticated exact identity. Other models and agents are never included.',
      inputSchema: { type: 'object', properties: { afterWhisperId: { type: 'string', description: 'Last whisper previously read; continues with older messages' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, accessToken, prettyPrint } },
    },
  ];
}
