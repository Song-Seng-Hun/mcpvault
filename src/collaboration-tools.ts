import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;

export const COLLABORATION_MUTATING_TOOLS = [
  'create_agent_scope', 'handoff_agent_scope', 'resume_agent_scope',
] as const;

export function getCollaborationTools(): Tool[] {
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
      description: 'Search the authenticated agent, its model, then global scope and deduplicate overridden logical paths. Matching LLM Wiki notes are shown first. Returns compact excerpts only; use read_scoped_note for the selected note. Without login, searches global only.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000, description: 'Maximum compact JSON characters returned' }, searchContent: { type: 'boolean', default: true },
        searchFrontmatter: { type: 'boolean', default: false }, caseSensitive: { type: 'boolean', default: false }, prettyPrint,
      }, required: ['query'] },
    },
  ];
}
