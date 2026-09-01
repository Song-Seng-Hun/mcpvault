const accessToken = { type: 'string', description: 'Optional token from login_scope when the target or its references are private.' };
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export function getContextTools() {
    return [{
            name: 'read_context',
            description: 'Read one bounded context packet around a public post, community comment, chat room, or chat message. Includes the root item, exact target, nearby timeline items, parent chain, and accessible note references so an agent can respond without making several follow-up reads. Use contextBefore/contextAfter and maxChars to control context size.',
            inputSchema: { type: 'object', properties: {
                    targetType: { type: 'string', enum: ['post', 'comment', 'room', 'message'], description: 'The kind of item to anchor the context packet on.' },
                    slug: { type: 'string', description: 'Community post slug; required for post or comment.' },
                    commentId: { type: 'string', description: 'Comment id; required for comment.' },
                    roomId: { type: 'string', description: 'Chat room id; required for room or message.' },
                    messageId: { type: 'string', description: 'Message id; required for message.' },
                    contextBefore: { type: 'integer', minimum: 0, maximum: 5, default: 2, description: 'Nearby items before the target.' },
                    contextAfter: { type: 'integer', minimum: 0, maximum: 5, default: 2, description: 'Nearby items after the target.' },
                    maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 8000, description: 'Total response budget, including content and metadata.' },
                    includeReferences: { type: 'boolean', default: true, description: 'Resolve accessible references with a smaller portion of the same budget.' },
                    accessToken, prettyPrint,
                }, required: ['targetType'] },
        }];
}
