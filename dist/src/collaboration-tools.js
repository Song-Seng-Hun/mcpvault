const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export const COLLABORATION_MUTATING_TOOLS = [
    'create_agent_scope', 'handoff_agent_scope', 'resume_agent_scope',
    'create_discussion', 'add_discussion_argument', 'update_discussion_status',
];
export function getCollaborationTools() {
    return [
        {
            name: 'get_scope_context',
            description: 'Describe the public global namespace and private model/agent namespaces available to the supplied login_scope accessToken.',
            inputSchema: { type: 'object', properties: { prettyPrint } },
        },
        {
            name: 'create_agent_scope',
            description: 'Create a persistent agent identity and dedicated working namespace that can survive and transfer across sessions.',
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string', description: 'Stable lowercase agent identity' }, modelId: { type: 'string', description: 'Owning model family, e.g. codex or claude' },
                    sessionId: { type: 'string', description: 'Current session identifier' }, displayName: { type: 'string' }, purpose: { type: 'string' }, prettyPrint,
                }, required: ['agentId', 'modelId', 'sessionId'] },
        },
        {
            name: 'handoff_agent_scope',
            description: 'Explicitly transfer a persistent agent identity to another session. Generation checking prevents stale or double handoffs.',
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, fromSessionId: { type: 'string' }, toSessionId: { type: 'string' },
                    reason: { type: 'string' }, expectedGeneration: { type: 'integer', minimum: 1 }, prettyPrint,
                }, required: ['agentId', 'fromSessionId', 'toSessionId', 'reason', 'expectedGeneration'] },
        },
        {
            name: 'resume_agent_scope',
            description: 'Recover an agent identity after its prior session ended unexpectedly. The recovery is recorded and generation-checked.',
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, newSessionId: { type: 'string' }, reason: { type: 'string' },
                    expectedGeneration: { type: 'integer', minimum: 1 }, prettyPrint,
                }, required: ['agentId', 'newSessionId', 'reason', 'expectedGeneration'] },
        },
        {
            name: 'read_scoped_note',
            description: 'Read one logical note using agent > model > global fallback, returning the winning scope and revision.',
            inputSchema: { type: 'object', properties: {
                    path: { type: 'string', description: 'Logical note path without scope:// prefix' }, prettyPrint,
                }, required: ['path'] },
        },
        {
            name: 'search_scoped_notes',
            description: 'Search the authenticated agent, its model, then global scope and deduplicate overridden logical paths. Without login, searches global only.',
            inputSchema: { type: 'object', properties: {
                    query: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }, searchContent: { type: 'boolean', default: true },
                    searchFrontmatter: { type: 'boolean', default: false }, caseSensitive: { type: 'boolean', default: false }, prettyPrint,
                }, required: ['query'] },
        },
        {
            name: 'create_discussion',
            description: 'Open an equal-peer, Git-versioned Markdown discussion about a proposed wiki change.',
            inputSchema: { type: 'object', properties: {
                    discussionId: { type: 'string', description: 'Optional stable lowercase id; generated if omitted' }, title: { type: 'string' },
                    createdBy: { type: 'string', description: 'Model or agent identity; no identity has extra voting weight' }, subjectPath: { type: 'string', description: 'Optional regular or scope:// note path' },
                    initialPosition: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, prettyPrint,
                }, required: ['title', 'createdBy', 'initialPosition'] },
        },
        {
            name: 'get_discussion',
            description: 'Read a discussion, its current status, all arguments, and the content revision required for the next update.',
            inputSchema: { type: 'object', properties: { discussionId: { type: 'string' }, prettyPrint }, required: ['discussionId'] },
        },
        {
            name: 'add_discussion_argument',
            description: 'Append a support, challenge, alternative, or question to a discussion. Stale revisions are rejected so peers cannot silently overwrite each other.',
            inputSchema: { type: 'object', properties: {
                    discussionId: { type: 'string' }, actor: { type: 'string' }, stance: { type: 'string', enum: ['support', 'challenge', 'alternative', 'question'] },
                    argument: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'string' }, prettyPrint,
                }, required: ['discussionId', 'actor', 'stance', 'argument', 'expectedRevision'] },
        },
        {
            name: 'update_discussion_status',
            description: 'Record a peer-attributed status decision. Resolved topics can be reopened; Git remains the authoritative rollback history.',
            inputSchema: { type: 'object', properties: {
                    discussionId: { type: 'string' }, actor: { type: 'string' }, status: { type: 'string', enum: ['open', 'resolved', 'rejected', 'superseded'] },
                    reason: { type: 'string' }, expectedRevision: { type: 'string' }, prettyPrint,
                }, required: ['discussionId', 'actor', 'status', 'reason', 'expectedRevision'] },
        },
    ];
}
