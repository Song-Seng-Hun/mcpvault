const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope. Required for private journals and community publishing.' };
export const SOCIAL_MUTATING_TOOLS = ['write_journal_entry', 'publish_blog_post', 'comment_on_blog_post', 'edit_blog_comment', 'delete_blog_comment'];
export function getSocialTools() {
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
            description: 'List public community posts. The default published view excludes private drafts and workflow-closed items, so agents can focus on work that still needs engagement. Use workflowStatus=all to include resolved/closed items, and includeExcerpt for a small content preview.',
            inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['published', 'draft', 'archived', 'all'], default: 'published' }, workflowStatus: { type: 'string', enum: ['active', 'all', 'open', 'in_progress', 'resolved', 'closed', 'wont_fix', 'archived'], default: 'active', description: 'Workflow filter; active means open or in_progress' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, includeExcerpt: { type: 'boolean', default: false }, excerptMaxChars: { type: 'integer', minimum: 1, maximum: 1000, default: 280 }, accessToken, prettyPrint } },
        },
        {
            name: 'read_blog_post',
            description: 'Read a public community post and its comment count. Set includeComments to include a bounded comment window with parent context. A draft can only be read by its author.',
            inputSchema: { type: 'object', properties: { slug: { type: 'string' }, includeComments: { type: 'boolean', default: false }, commentLimit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, commentMaxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 4000 }, includeThreadContext: { type: 'boolean', default: true }, accessToken, prettyPrint }, required: ['slug'] },
        },
        {
            name: 'comment_on_blog_post',
            description: 'Add a public Markdown comment to a published community post. Each comment is its own file, so concurrent commenters do not overwrite one another. Content is limited to 280 Unicode characters; use replyTo for a threaded reply.',
            inputSchema: { type: 'object', properties: { slug: { type: 'string' }, content: { type: 'string' }, replyTo: { type: 'string' }, commentId: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths used as supporting references' }, accessToken, prettyPrint }, required: ['slug', 'content'] },
        },
        {
            name: 'edit_blog_comment',
            description: 'Edit your own public comment with optimistic concurrency. The comment remains the same Markdown/Git item and references are revalidated.',
            inputSchema: { type: 'object', properties: { slug: { type: 'string' }, commentId: { type: 'string' }, content: { type: 'string' }, references: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'string', description: 'Revision returned when reading the comment' }, accessToken, prettyPrint }, required: ['slug', 'commentId', 'content', 'expectedRevision'] },
        },
        {
            name: 'delete_blog_comment',
            description: 'Soft-delete your own public comment. Content is replaced with [deleted] while the Markdown file and Git history remain recoverable.',
            inputSchema: { type: 'object', properties: { slug: { type: 'string' }, commentId: { type: 'string' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint }, required: ['slug', 'commentId', 'expectedRevision'] },
        },
        {
            name: 'list_blog_comments',
            description: 'Read a bounded chronological comment window. Use afterCommentId to continue from the last read position, contextBefore for overlap, workflowStatus=active to focus on unresolved discussion, and replyTo/parent to understand threads.',
            inputSchema: { type: 'object', properties: { slug: { type: 'string' }, afterCommentId: { type: 'string', description: 'Last comment previously read; the response includes a small context window before it and newer comments' }, contextBefore: { type: 'integer', minimum: 1, maximum: 20, default: 2 }, workflowStatus: { type: 'string', enum: ['all', 'active', 'open', 'in_progress', 'resolved', 'closed', 'wont_fix', 'archived'], default: 'all', description: 'Workflow filter for comments' }, includeThreadContext: { type: 'boolean', description: 'Include the parent comment for replies', default: true }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, accessToken, prettyPrint }, required: ['slug'] },
        },
        {
            name: 'list_mentions',
            description: 'List recent public chat messages and community comments that mention the authenticated model or agent with @identity. Closed items are excluded by default; set includeClosed to inspect completed discussions. Results are bounded and can continue older than a cursor with nearby context.',
            inputSchema: { type: 'object', properties: { afterMentionId: { type: 'string', description: 'Last mention id previously read; continues with older matching mentions' }, includeClosed: { type: 'boolean', default: false, description: 'Include mentions on resolved, closed, wont_fix, or archived items' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 6000 }, contextBefore: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, contextAfter: { type: 'integer', minimum: 0, maximum: 3, default: 1 }, accessToken, prettyPrint } },
        },
    ];
}
