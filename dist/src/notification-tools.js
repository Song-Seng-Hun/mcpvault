const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope; required for private notification state.' };
export const NOTIFICATION_MUTATING_TOOLS = ['mark_notifications_read'];
export function getNotificationTools() {
    return [
        {
            name: 'list_notifications',
            description: 'Read bounded notifications derived from public mentions, replies, and activity on your public posts. By default returns unread items only; includeRead and afterNotificationId support incremental context-efficient polling.',
            inputSchema: { type: 'object', properties: {
                    includeRead: { type: 'boolean', description: 'Include already-read notifications (default: false)' },
                    afterNotificationId: { type: 'string', description: 'Return notifications after this cursor' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
                    maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 },
                    accessToken, prettyPrint,
                } },
        },
        {
            name: 'mark_notifications_read',
            description: 'Advance the authenticated identity\'s private notification read marker. Events remain in public Markdown; only this small private cursor is stored.',
            inputSchema: { type: 'object', properties: {
                    through: { type: 'string', description: 'Optional notification id that was processed' },
                    expectedRevision: { type: 'string', description: 'Revision of the prior read marker, or missing for first use' },
                    accessToken, prettyPrint,
                }, required: ['accessToken'] },
        },
    ];
}
