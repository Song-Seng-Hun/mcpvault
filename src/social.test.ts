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

    const created = await json(client, 'write_journal_entry', {
      date: '2026-09-01', kind: 'reflection', title: 'First reflection', content: 'Private working thoughts', tags: ['daily'], accessToken: agentToken,
    });
    expect(created.value).toMatchObject({ created: true, date: '2026-09-01', kind: 'reflection' });
    expect(created.value.path).toContain('scope://agent/diary-agent/');

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
    const anonymousSearch = await json(client, 'search_notes', { query: 'Private working thoughts' });
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

    const draft = await json(client, 'publish_blog_post', { slug: 'draft-post', title: 'Draft', content: 'Not public yet', status: 'draft', expectedRevision: 'missing', accessToken: publisherToken });
    expect(draft.value.status).toBe('draft');
    const anonymousDrafts = await json(client, 'list_blog_posts', { status: 'all' });
    expect(anonymousDrafts.value.posts).toEqual([]);
    const anonymousDraftRead = await client.callTool({ name: 'read_blog_post', arguments: { slug: 'draft-post' } });
    expect(anonymousDraftRead.isError).toBe(true);

    const published = await json(client, 'publish_blog_post', { slug: 'hello-agents', title: 'Hello agents', content: 'Let us share useful discoveries.', expectedRevision: 'missing', accessToken: publisherToken });
    expect(published.value.path).toBe('Community/Posts/hello-agents.md');
    const publicPost = await json(client, 'read_blog_post', { slug: 'hello-agents' });
    expect(publicPost.value.fm.title).toBe('Hello agents');

    const anonymousComment = await client.callTool({ name: 'comment_on_blog_post', arguments: { slug: 'hello-agents', content: 'Anonymous should not be able to impersonate an agent.' } });
    expect(anonymousComment.isError).toBe(true);
    const comment = await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'Useful idea. @claude', accessToken: publisherToken });
    expect(comment.value).toMatchObject({ success: true, postId: 'hello-agents' });
    const closedComment = await json(client, 'update_community_status', { targetType: 'comment', slug: 'hello-agents', commentId: comment.value.commentId, workflowStatus: 'resolved', reason: 'The point has been incorporated.', expectedRevision: comment.value.revision, accessToken: publisherToken });
    expect(closedComment.value).toMatchObject({ workflowStatus: 'resolved', closed: true, reason: 'The point has been incorporated.' });
    const comments = await json(client, 'list_blog_comments', { slug: 'hello-agents' });
    expect(comments.value.comments).toHaveLength(1);
    expect(comments.value.comments[0]).toMatchObject({ workflowStatus: 'resolved', workflowStatusReason: 'The point has been incorporated.' });
    const activeComments = await json(client, 'list_blog_comments', { slug: 'hello-agents', workflowStatus: 'active' });
    expect(activeComments.value.comments).toHaveLength(0);
    const reopened = await json(client, 'update_community_status', { targetType: 'comment', slug: 'hello-agents', commentId: comment.value.commentId, workflowStatus: 'open', reason: 'A follow-up is still welcome.', expectedRevision: comments.value.comments[0].revision, accessToken: publisherToken });
    expect(reopened.value).toMatchObject({ workflowStatus: 'open', closed: false });
    const reply = await json(client, 'comment_on_blog_post', { slug: 'hello-agents', content: 'Following up on that point.', replyTo: comment.value.commentId, accessToken: publisherToken });
    const threaded = await json(client, 'list_blog_comments', { slug: 'hello-agents' });
    expect(threaded.value.comments[1]).toMatchObject({ commentId: reply.value.commentId, replyTo: comment.value.commentId });
    expect(threaded.value.comments[1].parent).toMatchObject({ commentId: comment.value.commentId, content: expect.stringContaining('Useful idea.') });
    const withComments = await json(client, 'read_blog_post', { slug: 'hello-agents', includeComments: true, commentLimit: 5, accessToken: publisherToken });
    expect(withComments.value.comments).toHaveLength(2);
    const mentions = await json(client, 'list_mentions', { accessToken: publisherToken });
    expect(mentions.value.mentions).toEqual(expect.arrayContaining([expect.objectContaining({ commentId: comment.value.commentId, kind: 'blog_comment' })]));
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
