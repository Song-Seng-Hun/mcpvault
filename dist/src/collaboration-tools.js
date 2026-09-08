import { guidanceText } from './guidance-runtime.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export const COLLABORATION_MUTATING_TOOLS = [
    'create_agent_scope', 'handoff_agent_scope', 'resume_agent_scope',
];
export function getCollaborationTools() {
    return [
        {
            name: 'get_scope_context',
            description: guidanceText('guid-93af06362e4719d6', 'Describe the public global namespace and private model/agent namespaces available to the supplied login_scope accessToken.'),
            inputSchema: { type: 'object', properties: { prettyPrint } },
        },
        {
            name: 'create_agent_scope',
            description: guidanceText('guid-b6a3a68f469d4b4f', 'Create a persistent agent identity and dedicated working namespace that can survive and transfer across sessions.'),
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string', description: guidanceText('guid-8a0231ca0d05dee7', 'Stable lowercase agent identity') }, modelId: { type: 'string', description: guidanceText('guid-c86194fd55be44b8', 'Owning model family, e.g. codex or claude') },
                    sessionId: { type: 'string', description: guidanceText('guid-46ca31a76c466588', 'Current session identifier') }, displayName: { type: 'string' }, purpose: { type: 'string' }, prettyPrint,
                }, required: ['agentId', 'modelId', 'sessionId'] },
        },
        {
            name: 'handoff_agent_scope',
            description: guidanceText('guid-7273768787f8cca6', 'Explicitly transfer a persistent agent identity to another session. Generation checking prevents stale or double handoffs.'),
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, fromSessionId: { type: 'string' }, toSessionId: { type: 'string' },
                    reason: { type: 'string' }, expectedGeneration: { type: 'integer', minimum: 1 }, prettyPrint,
                }, required: ['agentId', 'fromSessionId', 'toSessionId', 'reason', 'expectedGeneration'] },
        },
        {
            name: 'resume_agent_scope',
            description: guidanceText('guid-b09dcca37e68b0ac', 'Recover an agent identity after its prior session ended unexpectedly. The recovery is recorded and generation-checked.'),
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, newSessionId: { type: 'string' }, reason: { type: 'string' },
                    expectedGeneration: { type: 'integer', minimum: 1 }, prettyPrint,
                }, required: ['agentId', 'newSessionId', 'reason', 'expectedGeneration'] },
        },
        {
            name: 'read_scoped_note',
            description: guidanceText('guid-109d2e2c0b7ae4be', 'Read one logical note using agent > model > global fallback, returning the winning scope and revision.'),
            inputSchema: { type: 'object', properties: {
                    path: { type: 'string', description: guidanceText('guid-7c7fafcacce5a8f4', 'Logical note path without scope:// prefix') }, prettyPrint,
                }, required: ['path'] },
        },
        {
            name: 'search_scoped_notes',
            description: guidanceText('guid-d3b011e766552b1a', 'Search the authenticated agent, its model, then global scope and deduplicate overridden logical paths. Matching LLM Wiki notes are shown first. Returns compact excerpts only; use read_scoped_note for the selected note. Without login, searches global only.'),
            inputSchema: { type: 'object', properties: {
                    query: { type: 'string' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000, description: guidanceText('guid-9345c63bd0a6cf20', 'Maximum compact JSON characters returned') }, searchContent: { type: 'boolean', default: true },
                    searchFrontmatter: { type: 'boolean', default: false }, caseSensitive: { type: 'boolean', default: false }, prettyPrint,
                }, required: ['query'] },
        },
    ];
}
