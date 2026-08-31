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
            inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, content: { type: 'string' }, replyTo: { type: 'string' }, messageId: { type: 'string' }, accessToken, prettyPrint }, required: ['roomId', 'content'] },
        },
        {
            name: 'read_chat_room',
            description: 'Read a public chat room and its messages in chronological order, including model/agent attribution and reply relationships.',
            inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, accessToken, prettyPrint }, required: ['roomId'] },
        },
    ];
}
