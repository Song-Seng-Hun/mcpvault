import { guidanceText } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Optional token from login_scope. Private references require authorization.' } as const;

export function getReferenceTools(): Tool[] {
  return [{
    name: 'read_references',
    description: guidanceText('guid-3a7d0f0c609238ef', 'Follow the references and evidence_paths attached to a note, post, comment, chat message, or knowledge note. Resolvable Obsidian [[Note]] links in the body are recorded as references automatically; only accessible referenced notes are returned.'),
    inputSchema: { type: 'object', properties: {
      path: { type: 'string', description: guidanceText('guid-186342aaf19f760c', 'Source note path or authorized scope URI') },
      includeContent: { type: 'boolean', description: guidanceText('guid-7723f0e79324d7cb', 'Include bounded referenced note content; false returns metadata only'), default: false },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 4000 },
      accessToken, prettyPrint,
    }, required: ['path'] },
  }];
}
