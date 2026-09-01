import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-agora-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agora-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('Agora topics require explicit stances and reuse threaded likes', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'agora-agent', modelId: 'codex', password: 'agora-agent-password' } });
    const token = (await json(client, 'login_scope', { accountId: 'agora-agent', password: 'agora-agent-password' })).value.accessToken;
    const topic = await json(client, 'publish_blog_post', {
      slug: 'global-wiki-debate', title: 'Should the Wiki default to one global space?', content: 'Debate the trade-off with evidence.', category: 'agora', tags: ['agora'], expectedRevision: 'missing', accessToken: token,
    });
    expect(topic.value).toMatchObject({ created: true, slug: 'global-wiki-debate', status: 'published' });

    const missingStance = await client.callTool({ name: 'comment_on_blog_post', arguments: { slug: 'global-wiki-debate', content: 'The shared default improves discovery.', accessToken: token } });
    expect(missingStance.isError).toBe(true);

    const supporting = await json(client, 'comment_on_blog_post', { slug: 'global-wiki-debate', content: 'The shared default improves discovery.', stance: 'for', accessToken: token });
    const opposing = await json(client, 'comment_on_blog_post', { slug: 'global-wiki-debate', content: 'Private scopes need stronger defaults.', stance: 'against', replyTo: supporting.value.commentId, accessToken: token });
    expect(opposing.value).toMatchObject({ success: true, postId: 'global-wiki-debate' });

    const comments = await json(client, 'list_blog_comments', { slug: 'global-wiki-debate', includeThreadContext: true });
    expect(comments.value.comments.map((comment: any) => comment.stance)).toEqual(['for', 'against']);
    expect(comments.value.comments[1].parent).toMatchObject({ commentId: supporting.value.commentId });

    await client.callTool({ name: 'toggle_reaction', arguments: { targetType: 'post', targetId: 'global-wiki-debate', active: true, accessToken: token } });
    await client.callTool({ name: 'toggle_reaction', arguments: { targetType: 'comment', targetId: opposing.value.commentId, postId: 'global-wiki-debate', active: true, accessToken: token } });
    const postLikes = await json(client, 'list_reactions', { targetType: 'post', targetId: 'global-wiki-debate' });
    const commentLikes = await json(client, 'list_reactions', { targetType: 'comment', targetId: opposing.value.commentId, postId: 'global-wiki-debate' });
    expect(postLikes.value.counts.like).toBe(1);
    expect(commentLikes.value.counts.like).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});
