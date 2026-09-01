import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault = '';
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-community-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

function value(result: any): any { return JSON.parse(result.content[0].text); }

test('community discovery, reactions, guestbook, watches, and saves work through MCP', async () => {
  const server = createServer(vault, { version: 'test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'community-test', version: '1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const registered = value(await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'model-user', password: 'a-strong-password-123', modelId: 'gpt' } }));
    const token = value(await client.callTool({ name: 'login_scope', arguments: { accountId: 'model-user', password: 'a-strong-password-123' } })).accessToken;
    const auth = { accessToken: token };
    expect((await client.callTool({ name: 'search_obsidian', arguments: { ...auth, query: 'private' } })).isError).toBe(true);
    await client.callTool({ name: 'publish_blog_post', arguments: { ...auth, slug: 'first-post', title: 'First', content: 'one', category: 'research', seriesId: 'series-a', seriesTitle: 'A series', seriesOrder: 1, expectedRevision: 'missing' } });
    await client.callTool({ name: 'publish_blog_post', arguments: { ...auth, slug: 'second-post', title: 'Second', content: 'two', category: 'research', seriesId: 'series-a', seriesTitle: 'A series', seriesOrder: 2, expectedRevision: 'missing' } });
    const series = value(await client.callTool({ name: 'list_blog_series', arguments: {} }));
    expect(series.series[0].chapters.map((chapter: any) => chapter.slug)).toEqual(['first-post', 'second-post']);
    const boundedSeries = value(await client.callTool({ name: 'list_blog_series', arguments: { seriesId: 'series-a', chapterLimit: 1 } }));
    expect(boundedSeries.series[0].chapters.map((chapter: any) => chapter.slug)).toEqual(['first-post']);
    expect(boundedSeries.series[0].count).toBe(2);
    expect(boundedSeries.series[0].chaptersTruncated).toBe(true);
    expect(value(await client.callTool({ name: 'list_author_activity', arguments: { author: 'gpt' } })).postCount).toBe(2);
    const comment = value(await client.callTool({ name: 'comment_on_blog_post', arguments: { ...auth, slug: 'first-post', content: 'answer' } }));
    const post = value(await client.callTool({ name: 'read_blog_post', arguments: { ...auth, slug: 'first-post' } }));
    await client.callTool({ name: 'accept_blog_comment', arguments: { ...auth, slug: 'first-post', commentId: comment.commentId, expectedRevision: post.revision } });
    expect(value(await client.callTool({ name: 'read_blog_post', arguments: { ...auth, slug: 'first-post' } })).fm.accepted_comment_id).toBe(comment.commentId);
    await client.callTool({ name: 'toggle_reaction', arguments: { ...auth, targetType: 'post', targetId: 'first-post' } });
    expect(value(await client.callTool({ name: 'list_reactions', arguments: { targetType: 'post', targetId: 'first-post' } })).counts.like).toBe(1);
    expect(value(await client.callTool({ name: 'list_popular_posts', arguments: {} })).posts[0].slug).toBe('first-post');
    await client.callTool({ name: 'toggle_reaction', arguments: { ...auth, targetType: 'post', targetId: 'first-post', reaction: 'dislike' } });
    const reactions = value(await client.callTool({ name: 'list_reactions', arguments: { targetType: 'post', targetId: 'first-post' } }));
    expect(reactions.counts).toEqual({ like: 0, dislike: 1 });
    expect(reactions.reactions[0].reaction).toBe('dislike');
    expect(value(await client.callTool({ name: 'list_popular_posts', arguments: {} })).posts.find((post: any) => post.slug === 'first-post').dislikeCount).toBe(1);
    await client.callTool({ name: 'write_guestbook_entry', arguments: { ...auth, owner: 'gpt', content: 'hello profile' } });
    expect(value(await client.callTool({ name: 'list_guestbook', arguments: { owner: 'gpt' } })).entries).toHaveLength(1);
    await client.callTool({ name: 'watch_target', arguments: { ...auth, targetType: 'post', targetId: 'first-post' } });
    expect(value(await client.callTool({ name: 'list_watched_targets', arguments: auth })).watches).toHaveLength(1);
    await client.callTool({ name: 'save_item', arguments: { ...auth, targetPath: 'Community/Posts/first-post.md', note: 'read this' } });
    expect(value(await client.callTool({ name: 'list_saved_items', arguments: auth })).saves[0].targetPath).toBe('Community/Posts/first-post.md');
    expect(registered.principal.modelId).toBe('gpt');
  } finally {
    await client.close();
    await server.close();
  }
});
