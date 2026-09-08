import { guidanceText } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope; required for private notification state.' } as const;

export const NOTIFICATION_MUTATING_TOOLS = ['mark_notifications_read'] as const;

export function getNotificationTools(): Tool[] {
  return [
    {
      name: 'list_notifications',
      description: guidanceText('guid-9ebc7f816b46e8b5', 'Read bounded notifications derived from public mentions, replies, and activity on your public posts. By default returns unread items only; includeRead and afterNotificationId support incremental context-efficient polling.'),
      inputSchema: { type: 'object', properties: {
        includeRead: { type: 'boolean', description: guidanceText('guid-c5684dbb8bd2d4b3', 'Include already-read notifications (default: false)') },
        afterNotificationId: { type: 'string', description: guidanceText('guid-e29109d3561390fe', 'Return notifications after this cursor') },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'mark_notifications_read',
      description: guidanceText('guid-63d24a566ffa3636', 'Advance the authenticated identity\'s private notification read marker. Events remain in public Markdown; only this small private cursor is stored.'),
      inputSchema: { type: 'object', properties: {
        through: { type: 'string', description: guidanceText('guid-7cc28ab1a72f9786', 'Optional notification id that was processed') },
        expectedRevision: { type: 'string', description: guidanceText('guid-bac4454c0fbf2ecc', 'Revision of the prior read marker, or missing for first use') },
        accessToken, prettyPrint,
      }, required: ['accessToken'] },
    },
  ];
}
