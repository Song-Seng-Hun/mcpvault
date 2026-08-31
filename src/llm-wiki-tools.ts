import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Omit for public global scope only.' } as const;
const scopeUri = { type: 'string', description: 'Target scope root; defaults to scope://global/. Private scopes require an authorized accessToken.', default: 'scope://global/' } as const;

export const LLM_WIKI_MUTATING_TOOLS = [
  'initialize_llm_wiki', 'ingest_source', 'publish_knowledge', 'report_wiki_issue', 'resolve_wiki_issue',
] as const;

export function getLlmWikiTools(): Tool[] {
  return [
    {
      name: 'orient_wiki',
      description: 'Call this first after connecting. Returns the visible scope, current Wiki health, operating invariants, and the next safe MCP action without changing files.',
      inputSchema: { type: 'object', properties: { accessToken, prettyPrint } },
    },
    {
      name: 'initialize_llm_wiki',
      description: 'Initialize the minimal schema contract for one scope. Creates missing files only and never overwrites an existing schema.',
      inputSchema: { type: 'object', properties: { scopeUri, actor: { type: 'string' }, accessToken, prettyPrint } },
    },
    {
      name: 'ingest_source',
      description: 'Capture one immutable raw source snapshot. Re-ingesting identical content is idempotent; changed content requires a new sourceId.',
      inputSchema: { type: 'object', properties: {
        scopeUri, sourceId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
        sourceUrl: { type: 'string' }, capturedBy: { type: 'string' }, capturedAt: { type: 'string' }, mediaType: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['title', 'content'] },
    },
    {
      name: 'publish_knowledge',
      description: 'Create or update an evidence-grounded knowledge note while preserving ordinary Markdown/Obsidian/Git behavior. Every evidence path must be an immutable source snapshot.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, content: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string' } },
        author: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        status: { type: 'string', enum: ['draft', 'verified', 'disputed', 'superseded'], default: 'draft' },
        expectedRevision: { type: 'string', description: "Required revision, or 'missing' for a new note" }, accessToken, prettyPrint,
      }, required: ['path', 'content', 'evidencePaths', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_catalog',
      description: 'Build a live scope-aware catalog from frontmatter instead of maintaining a stale hand-written index.',
      inputSchema: { type: 'object', properties: { accessToken, prettyPrint } },
    },
    {
      name: 'lint_wiki',
      description: 'Deterministically check accessible Wiki sources, evidence grounding, integrity hashes, and broken wikilinks.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, accessToken, prettyPrint } },
    },
    {
      name: 'report_wiki_issue',
      description: 'Add a durable Error Book entry for a contradiction, unsupported claim, stale knowledge, broken link, or missing context.',
      inputSchema: { type: 'object', properties: {
        scopeUri, issueId: { type: 'string' }, kind: { type: 'string', enum: ['contradiction', 'unsupported_claim', 'stale', 'broken_link', 'missing_context', 'other'] },
        title: { type: 'string' }, description: { type: 'string' }, subjectPath: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string' } },
        reportedBy: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['kind', 'title', 'description'] },
    },
    {
      name: 'resolve_wiki_issue',
      description: 'Resolve an Error Book entry with attribution, reason, and optimistic concurrency protection.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, actor: { type: 'string' }, resolution: { type: 'string' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'resolution', 'expectedRevision'] },
    },
  ];
}
