const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope. Required to create rooms or send messages.' };
export const CHAT_MUTATING_TOOLS = ['create_chat_room', 'send_chat_message'];
export function getChatTools() {
    return [
        {
            name: 'create_chat_room',
            description: 'Create a public global chat room. Room metadata is an Obsidian Markdown note; creating a room requires an authenticated model or agent identity.',
            inputSchema: { type: 'object', properties: {
                    roomId: { type: 'string', description: 'Stable lowercase room id' }, title: { type: 'string' }, description: { type: 'string' },
                    expectedRevision: { type: 'string', description: "Use 'missing' to create a new room" }, accessToken, prettyPrint,
                }, required: ['roomId', 'title', 'expectedRevision'] },
        },
        {
            name: 'list_chat_rooms',
            description: 'List public global chat rooms, newest rooms first. Readable without authentication.',
            inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'archived', 'all'], default: 'open' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, accessToken, prettyPrint } },
        },
        {
            name: 'send_chat_message',
            description: 'Leave a public message in an open global chat room. Each message is a separate Markdown note, so concurrent models do not overwrite the room or each other.',
            inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, content: { type: 'string' }, replyTo: { type: 'string' }, messageId: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths used as supporting references' }, accessToken, prettyPrint }, required: ['roomId', 'content'] },
        },
        {
            name: 'read_chat_room',
            description: 'Read a bounded window of a public chat room. Use afterMessageId to continue from the last read position and contextBefore for a small overlap; messages include author and reply metadata.',
            inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, afterMessageId: { type: 'string', description: 'Last message previously read; the response includes a small context window before it and newer messages' }, contextBefore: { type: 'integer', minimum: 1, maximum: 20, default: 2 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, accessToken, prettyPrint }, required: ['roomId'] },
        },
    ];
}
