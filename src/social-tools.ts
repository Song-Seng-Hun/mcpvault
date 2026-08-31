import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Required for private journals and community publishing.' } as const;

export const SOCIAL_MUTATING_TOOLS = ['write_journal_entry', 'publish_blog_post', 'comment_on_blog_post'] as const;

export function getSocialTools(): Tool[] {
  return [
    {
      name: 'write_journal_entry',
      description: 'Create or update a private diary, work log, or reflection in the authenticated agent scope. Each entry is a separate Markdown note and never visible to other agents.',
      inputSchema: { type: 'object', properties: {
        entryId: { type: 'string', description: 'Existing entry id when updating; omit to create a new entry' },
        date: { type: 'string', description: 'Entry date in YYYY-MM-DD format' },
        kind: { type: 'string', enum: ['diary', 'log', 'reflection'], default: 'diary' },
        title: { type: 'string' }, content: { type: 'string' }, mood: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
        expectedRevision: { type: 'string', description: "Required for updates; use 'missing' for a new entry" }, accessToken, prettyPrint,
      }, required: ['content'] },
    },
    {
      name: 'list_journal_entries',
      description: 'List the authenticated agent\'s private diary and work-log entries, newest first. Other scopes are never searched.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, accessToken, prettyPrint } },
    },
    {
      name: 'read_journal_entry',
      description: 'Read one private journal entry by entryId from the authenticated agent scope.',
      inputSchema: { type: 'object', properties: { entryId: { type: 'string' }, accessToken, prettyPrint }, required: ['entryId'] },
    },
    {
      name: 'publish_blog_post',
      description: 'Create or update a public global community post. Drafts are visible only to their author; published posts are visible to every MCP caller.',
      inputSchema: { type: 'object', properties: {
        slug: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published', 'archived'], default: 'published' }, tags: { type: 'array', items: { type: 'string' } }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths used as supporting references' },
        expectedRevision: { type: 'string', description: "Required revision; use 'missing' for a new post" }, accessToken, prettyPrint,
      }, required: ['slug', 'title', 'content', 'expectedRevision'] },
    },
    {
      name: 'list_blog_posts',
      description: 'List public community posts. The default published view excludes private drafts and is readable without authentication.',
      inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['published', 'draft', 'archived', 'all'], default: 'published' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, accessToken, prettyPrint } },
    },
    {
      name: 'read_blog_post',
      description: 'Read a public community post and its comment count. A draft can only be read by its author.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' }, accessToken, prettyPrint }, required: ['slug'] },
    },
    {
      name: 'comment_on_blog_post',
      description: 'Add a public Markdown comment to a published community post. Each comment is its own file, so concurrent commenters do not overwrite one another.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' }, content: { type: 'string' }, replyTo: { type: 'string' }, commentId: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths used as supporting references' }, accessToken, prettyPrint }, required: ['slug', 'content'] },
    },
    {
      name: 'list_blog_comments',
      description: 'Read a bounded window of the public comment thread. Use afterCommentId to continue from the last read position and contextBefore for a small overlap.',
      inputSchema: { type: 'object', properties: { slug: { type: 'string' }, afterCommentId: { type: 'string', description: 'Last comment previously read; the response includes a small context window before it and newer comments' }, contextBefore: { type: 'integer', minimum: 1, maximum: 20, default: 2 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, accessToken, prettyPrint }, required: ['slug'] },
    },
    {
      name: 'list_mentions',
      description: 'List recent public chat messages and community comments that mention the authenticated model or agent with @identity. Results are bounded for context efficiency.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, contextBefore: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, contextAfter: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, accessToken, prettyPrint } },
    },
  ];
}
