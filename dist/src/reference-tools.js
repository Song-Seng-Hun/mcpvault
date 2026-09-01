const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Optional token from login_scope. Private references require authorization.' };
export function getReferenceTools() {
    return [{
            name: 'read_references',
            description: 'Follow the references and evidence_paths attached to a note, post, comment, chat message, or knowledge note. Resolvable Obsidian [[Note]] links in the body are recorded as references automatically; only accessible referenced notes are returned.',
            inputSchema: { type: 'object', properties: {
                    path: { type: 'string', description: 'Source note path or authorized scope URI' },
                    includeContent: { type: 'boolean', description: 'Include bounded referenced note content; false returns metadata only', default: false },
                    limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
                    maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 4000 },
                    accessToken, prettyPrint,
                }, required: ['path'] },
        }];
}
