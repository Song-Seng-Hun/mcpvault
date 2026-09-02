import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-social-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'social-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('agent journals are private, revision-safe, and separate from global community posts', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'social-model', modelId: 'codex', password: 'social-model-password' } });
    const modelToken = (await json(client, 'login_scope', { accountId: 'social-model', password: 'social-model-password' })).value.accessToken;
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'social-agent-account', modelId: 'codex', agentId: 'diary-agent', password: 'social-agent-password', accessToken: modelToken }, });
    const agentToken = (await json(client, 'login_scope', { accountId: 'social-agent-account', password: 'social-agent-password' })).value.accessToken;
    await client.callTool({ name: 'write_note', arguments: { path: 'Journal-reference.md', content: 'A public note referenced by a private journal.', accessToken: modelToken } });

    const created = await json(client, 'write_journal_entry', {
      date: '2026-09-01', kind: 'reflection', title: 'First reflection', content: 'Private working thoughts [[Journal-reference]]', tags: ['daily'], accessToken: agentToken,
    });
    expect(created.value).toMatchObject({ created: true, date: '2026-09-01', kind: 'reflection' });
    expect(created.value.path).toContain('scope://agent/diary-agent/');
    const journal = await json(client, 'read_journal_entry', { entryId: created.value.entryId, accessToken: agentToken });
    expect(journal.value.fm.references).toEqual(['Journal-reference.md']);

    const listed = await json(client, 'list_journal_entries', { accessToken: agentToken });
    expect(listed.value.entries).toHaveLength(1);
    const updated = await json(client, 'write_journal_entry', {
      entryId: created.value.entryId, date: '2026-09-01', content: 'Private working thoughts, updated', expectedRevision: created.value.revision, accessToken: agentToken,
    });
    expect(updated.value.created).toBe(false);

    const modelJournal = await client.callTool({ name: 'list_journal_entries', arguments: { accessToken: modelToken } });
    expect(modelJournal.isError).toBe(true);
    const anonymousJournal = await client.callTool({ name: 'list_journal_entries', arguments: {} });
    expect(anonymousJournal.isError).toBe(true);
    const anonymousSearch = await json(client, 'search_notes', { query: 'working thoughts' });
    expect(anonymousSearch.value).toEqual([]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('published posts and comments are public while drafts remain author-private', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'publisher', modelId: 'claude', password: 'publisher-password' } });
    const publisherToken = (await json(client, 'login_scope', { accountId: 'publisher', password: 'publisher-password' })).value.accessToken;
    await client.callTool({ name: 'write_note', arguments: { path: 'Evidence.md', content: 'A small public supporting note.', accessToken: publisherToken } });

    const draft = await json(client, 'publish_blog_post', { slug: 'draft-post', title: 'Draft', content: 'Not public yet', status: 'draft', expectedRevision: 'missing', accessToken: publisherToken });
    expect(draft.value.status).toBe('draft');
    const anonymousDrafts = await json(client, 'list_blog_posts', { status: 'all' });
    expect(anonymousDrafts.value.posts).toEqual([]);
    const anonymousDraftRead = await client.callTool({ name: 'read_blog_post', arguments: { slug: 'draft-post' } });
    expect(anonymousDraftRead.isError).toBe(true);

    const published = await json(client, 'publish_blog_post', { slug: 'hello-agents', title: 'Hello agents', content: 'Let us share useful discoveries [[Evidence]].', expectedRevision: 'missing', accessToken: publisherToken });
    expect(published.value.path).toBe('Community/Posts/hello-agents.md');
    const publicPost = await json(client, 'read_blog_post', { slug: 'hello-agents' });
    expect(publicPost.value.fm.title).toBe('Hello agents');
    expect(publicPost.value.fm.references).toEqual(['Evidence.md']);

    const anonymousComment = await client.callTool({ name: 'comment_on_blog_post', arguments: { slug: 'hello-agents', content: 'Anonymous should not be able to impersonate an agent.' } });
    expect(anonymousComment.isError).toBe(true);
    const comment = await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'Useful idea [[Evidence]]. @claude', accessToken: publisherToken });
    expect(comment.value).toMatchObject({ success: true, postId: 'hello-agents' });
    const closedComment = await json(client, 'update_community_status', { targetType: 'comment', slug: 'hello-agents', commentId: comment.value.commentId, workflowStatus: 'resolved', reason: 'The point has been incorporated.', expectedRevision: comment.value.revision, accessToken: publisherToken });
    expect(closedComment.value).toMatchObject({ workflowStatus: 'resolved', closed: true, reason: 'The point has been incorporated.' });
    const comments = await json(client, 'list_blog_comments', { slug: 'hello-agents' });
    expect(comments.value.comments).toHaveLength(1);
    expect(comments.value.comments[0].references).toEqual(['Evidence.md']);
    expect(comments.value.comments[0]).toMatchObject({ workflowStatus: 'resolved', workflowStatusReason: 'The point has been incorporated.' });
    const activeComments = await json(client, 'list_blog_comments', { slug: 'hello-agents', workflowStatus: 'active' });
    expect(activeComments.value.comments).toHaveLength(0);
    const reopened = await json(client, 'update_community_status', { targetType: 'comment', slug: 'hello-agents', commentId: comment.value.commentId, workflowStatus: 'open', reason: 'A follow-up is still welcome.', expectedRevision: comments.value.comments[0].revision, accessToken: publisherToken });
    expect(reopened.value).toMatchObject({ workflowStatus: 'open', closed: false });
    const reply = await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'Following up on that point.', replyTo: comment.value.commentId, accessToken: publisherToken });
    const thirdComment = await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'A third bounded reply.', accessToken: publisherToken });
    const smallCommentPage = await json(client, 'list_blog_comments', { slug: 'hello-agents', afterCommentId: reply.value.commentId, contextBefore: 2, limit: 1 });
    expect(smallCommentPage.value.comments.map((item: any) => item.commentId)).toEqual([comment.value.commentId, reply.value.commentId, thirdComment.value.commentId]);
    expect(smallCommentPage.value.nextCursor).toBe(thirdComment.value.commentId);
    const threaded = await json(client, 'list_blog_comments', { slug: 'hello-agents' });
    expect(threaded.value.comments[1]).toMatchObject({ commentId: reply.value.commentId, replyTo: comment.value.commentId });
    expect(threaded.value.comments[1].parent).toMatchObject({ commentId: comment.value.commentId, content: expect.stringContaining('Useful idea [[Evidence]]') });
    const withComments = await json(client, 'read_blog_post', { slug: 'hello-agents', includeComments: true, commentLimit: 5, accessToken: publisherToken });
    expect(withComments.value.comments).toHaveLength(3);
    await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'Another mention @claude', accessToken: publisherToken });
    const mentions = await json(client, 'list_mentions', { accessToken: publisherToken });
    const originalMention = mentions.value.mentions.find((item: any) => item.commentId === comment.value.commentId);
    expect(originalMention).toMatchObject({ commentId: comment.value.commentId, kind: 'blog_comment' });
    expect(originalMention.context).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Following up on that point.') })]));
    const edited = await json(client, 'edit_blog_comment', { slug: 'hello-agents', commentId: comment.value.commentId, content: 'Edited useful idea.', expectedRevision: threaded.value.comments[0].revision, accessToken: publisherToken });
    expect(edited.value.success).toBe(true);
    const deleted = await json(client, 'delete_blog_comment', { slug: 'hello-agents', commentId: reply.value.commentId, expectedRevision: threaded.value.comments[1].revision, accessToken: publisherToken });
    expect(deleted.value.deleted).toBe(true);
    const closedPost = await json(client, 'update_community_status', { targetType: 'post', slug: 'hello-agents', workflowStatus: 'closed', reason: 'Discussion is complete.', expectedRevision: publicPost.value.revision, accessToken: publisherToken });
    expect(closedPost.value).toMatchObject({ workflowStatus: 'closed', closed: true });
    expect((await json(client, 'list_blog_posts', {})).value.posts).toHaveLength(0);
    expect((await json(client, 'list_blog_posts', { workflowStatus: 'all' })).value.posts[0]).toMatchObject({ slug: 'hello-agents', workflowStatus: 'closed' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('authors can soft-delete posts with revision protection and keep Git-recoverable history', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'post-owner', modelId: 'codex', password: 'post-owner-password' } });
    const accessToken = (await json(client, 'login_scope', { accountId: 'post-owner', password: 'post-owner-password' })).value.accessToken;
    const created = await json(client, 'publish_blog_post', {
      slug: 'deletable-post', title: 'Temporary topic', content: 'This should leave the public feed.', expectedRevision: 'missing', accessToken,
    });
    const deleted = await json(client, 'delete_blog_post', { slug: 'deletable-post', expectedRevision: created.value.revision, accessToken });
    expect(deleted.value).toMatchObject({ success: true, deleted: true, status: 'archived' });

    expect((await json(client, 'list_blog_posts', {})).value.posts).toEqual([]);
    const archived = await json(client, 'list_blog_posts', { status: 'all', workflowStatus: 'all', accessToken });
    expect(archived.value.posts[0]).toMatchObject({ slug: 'deletable-post', status: 'archived' });
    const restored = await json(client, 'read_blog_post', { slug: 'deletable-post' });
    expect(restored.value.content).toContain('[deleted]');

    const stale = await client.callTool({ name: 'delete_blog_post', arguments: { slug: 'deletable-post', expectedRevision: created.value.revision, accessToken } });
    expect(stale.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('feedback and forum posts require structured handoff context and preserve it for peers', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'workflow-agent', modelId: 'codex', password: 'workflow-agent-password-123' });
    const accessToken = registration.value.accessToken;

    const missingSource = await client.callTool({ name: 'publish_blog_post', arguments: {
      slug: 'missing-source', title: 'Missing source', content: 'A report without a source location.', category: 'feedback', expectedRevision: 'missing', accessToken,
    } });
    expect(missingSource.isError).toBe(true);

    const feedback = await json(client, 'publish_blog_post', {
      slug: 'feedback-workflow', title: 'Search result is too terse', content: 'The result needs one more line of local context.', category: 'feedback',
      feedbackType: 'usability', sourcePaths: ['src/search.ts:120', 'README.md'], reproduction: 'Search for a short query and inspect the first result.', proposedChange: 'Return a bounded nearby excerpt.',
      expectedRevision: 'missing', accessToken,
    });
    expect(feedback.value).toMatchObject({ category: 'feedback', sourcePaths: ['src/search.ts:120', 'README.md'] });

    const absoluteSource = await client.callTool({ name: 'publish_blog_post', arguments: {
      slug: 'absolute-source', title: 'Unsafe source', content: 'The location must be repository-relative.', category: 'feedback', sourcePaths: ['E:/dev/llm_wiki/src/search.ts'], expectedRevision: 'missing', accessToken,
    } });
    expect(absoluteSource.isError).toBe(true);

    const missingBlock = await client.callTool({ name: 'publish_blog_post', arguments: {
      slug: 'missing-block', title: 'Missing block', content: 'A help request without a task.', category: 'forum', expectedRevision: 'missing', accessToken,
    } });
    expect(missingBlock.isError).toBe(true);

    const forum = await json(client, 'publish_blog_post', {
      slug: 'forum-workflow', title: 'How should I verify a stale index?', content: 'The index does not reflect an external edit.', category: 'forum',
      blockedTask: 'Verify the stale index after an external Markdown edit.', attempted: 'Restarted the server and reread the note.', helpWanted: 'What bounded diagnostic should I run next?', environment: 'Windows, Obsidian vault, MCP client',
      expectedRevision: 'missing', accessToken,
    });
    expect(forum.value).toMatchObject({ category: 'forum', blockedTask: 'Verify the stale index after an external Markdown edit.' });

    const pulse = await json(client, 'get_agent_pulse', { accessToken, limit: 2, maxChars: 4000 });
    expect(pulse.value.signals).toMatchObject({ activeFeedback: 1, activeForum: 1 });
    expect(pulse.value.context).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'feedback', slug: 'feedback-workflow', sourcePaths: ['src/search.ts:120', 'README.md'] }),
      expect.objectContaining({ kind: 'forum', slug: 'forum-workflow', blockedTask: 'Verify the stale index after an external Markdown edit.' }),
    ]));
  } finally {
    await client.close();
    await server.close();
  }
});
