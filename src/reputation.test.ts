import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { ReputationService } from './reputation.js';
import { AgentPulseService } from './agent-pulse.js';
import { FileSystemService } from './filesystem.js';

let vault = '';
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-reputation-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

function value(result: any): any { return JSON.parse(result.content[0].text); }

test('reputation derives peer reaction levels in posts while selected-activity Pulse skips its optional read', async () => {
  const server = createServer(vault, { version: 'test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'reputation-test', version: '1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']);
    const catalog = value(await client.callTool({ name: 'search_capabilities', arguments: { query: 'level', limit: 10 } }));
    expect(catalog.endpoints.some((endpoint: any) => endpoint.endpointId === 'community.reputation')).toBe(true);
    const register = async (accountId: string, modelId: string) => value(await client.callTool({ name: 'register_scope_account', arguments: { accountId, modelId, password: `${accountId}-strong-password` } }));
    const author = await register('author-account', 'author-model');
    const raterOne = await register('rater-one-account', 'rater-one');
    const raterTwo = await register('rater-two-account', 'rater-two');

    const posts: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const slug = `reputation-post-${index}`;
      posts.push(slug);
      await client.callTool({ name: 'publish_blog_post', arguments: { accessToken: author.accessToken, slug, title: slug, content: 'A bounded public contribution.', expectedRevision: 'missing' } });
    }
    const initial = value(await client.callTool({ name: 'get_reputation', arguments: { identity: 'author-model' } }));
    expect(initial).toMatchObject({ level: 0, xp: 0, label: '뉴비' });

    // Self-reactions never affect reputation.
    await client.callTool({ name: 'toggle_reaction', arguments: { accessToken: author.accessToken, targetType: 'post', targetId: posts[0], reaction: 'like' } });
    expect(value(await client.callTool({ name: 'get_reputation', arguments: { identity: 'author-model' } })).xp).toBe(0);

    for (const slug of posts) {
      await client.callTool({ name: 'toggle_reaction', arguments: { accessToken: raterOne.accessToken, targetType: 'post', targetId: slug, reaction: 'dislike' } });
      await client.callTool({ name: 'toggle_reaction', arguments: { accessToken: raterTwo.accessToken, targetType: 'post', targetId: slug, reaction: 'dislike' } });
    }
    const negative = value(await client.callTool({ name: 'get_reputation', arguments: { identity: 'author-model' } }));
    expect(negative).toMatchObject({ xp: -20, level: -2, label: '위험 신호', dislikesReceived: 10 });

    const postsResult = value(await client.callTool({ name: 'list_blog_posts', arguments: { limit: 1 } }));
    expect(postsResult.posts[0]).toMatchObject({ author: 'author-model', authorLevel: -2, authorLevelLabel: '위험 신호' });
    const pulse = value(await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: author.accessToken, limit: 1 } }));
    expect(pulse.identity).toMatchObject({ modelId: 'author-model' });
    expect(pulse.coverage.reputation.state).toBe('skipped');
    for (const key of ['level', 'xp', 'levelLabel']) expect(pulse.identity).not.toHaveProperty(key);
    for (const key of ['level', 'xp']) expect(pulse.signals).not.toHaveProperty(key);
  } finally {
    await client.close();
    await server.close();
  }
});

test('idle fallback Pulse still loads real Markdown-derived reputation', async () => {
  const author = { accountId: 'author', modelId: 'author-model', role: 'model' as const };
  const rater = { accountId: 'rater', modelId: 'rater-model', role: 'model' as const };
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'Community/Posts/one.md', content: 'Contribution', frontmatter: {
    mcpvault_type: 'blog_post', post_id: 'one', status: 'published', author: author.modelId,
  } });
  await fs.writeNote({ path: 'Community/Reactions/post/one/rater-model.md', content: '', frontmatter: {
    mcpvault_type: 'reaction', reaction: 'like', target_type: 'post', target_id: 'one', actor: rater.modelId, active: true,
  } });
  const reputation = new ReputationService(fs, { listPrincipals: async () => [author, rater] } as any,
    { listBannedAccountIds: async () => new Set<string>() } as any);
  // Explicitly empty activity stages isolate the final fallback. Reputation
  // itself reads real Markdown and performs its real aggregation.
  const service = new AgentPulseService(
    { list: async () => ({ notifications: [], unreadCount: 0 }) } as any,
    { pulsePosts: async () => ({ activePosts: [], feedbackPosts: [], forumPosts: [], ownPublishedPosts: 0, activeTotal: 0 }) } as any,
    { listRooms: async () => ({ rooms: [], total: 0 }) } as any,
    { listAssignedOpen: async () => ({ tasks: [], total: 0, statusCounts: {} }) } as any,
    { read: async () => ({ exists: false }) } as any, reputation,
    undefined, undefined, undefined, undefined, undefined, undefined,
    // This positive aggregation case has explicit optional-activity admission.
    async () => ({ run: async <T>(reader: () => Promise<T>) => reader(),
      revalidate: async () => {}, assertFresh: () => {} }),
  );
  const result = await service.get({ principal: author });
  expect(result.coverage.reputation.state).toBe('loaded');
  expect(result.identity).toMatchObject({ modelId: author.modelId, xp: 2, level: 0 });
  expect(result.signals).toMatchObject({ xp: 2, level: 0 });
});

test('refreshes only changed reaction metadata after the initial aggregate build', async () => {
  const author = { accountId: 'author-account', modelId: 'author-model', role: 'model' as const };
  const rater = { accountId: 'rater-account', modelId: 'rater-model', role: 'model' as const };
  const post = { path: 'Community/Posts/one.md', frontmatter: { mcpvault_type: 'blog_post', post_id: 'one', status: 'published', author: 'author-model' } };
  const reactionPath = 'Community/Reactions/post/one/rater-model.md';
  let reaction = { path: reactionPath, frontmatter: { mcpvault_type: 'reaction', reaction: 'like', target_type: 'post', target_id: 'one', actor: 'rater-model', active: true } };
  const queryNotes = vi.fn(async (params: { pathPrefix?: string }) => {
    const notes = params.pathPrefix === 'Community/Posts' ? [post]
      : params.pathPrefix === 'Community/Reactions' ? [reaction]
        : [];
    return { notes, total: notes.length, truncated: false };
  });
  const readNote = vi.fn(async () => reaction);
  const fileSystem = { queryNotes, readNote };
  const auth = { listPrincipals: vi.fn(async () => [author, rater]) };
  const moderation = { listBannedAccountIds: vi.fn(async () => new Set<string>()) };
  const reputation = new ReputationService(fileSystem as any, auth as any, moderation as any);

  expect((await reputation.getMany(['author-model'])).get('author-model')?.xp).toBe(2);
  expect(queryNotes).toHaveBeenCalledTimes(3);

  reaction = { ...reaction, frontmatter: { ...reaction.frontmatter, reaction: 'dislike' } };
  reputation.invalidate(reactionPath, 'upsert');
  expect((await reputation.getMany(['author-model'])).get('author-model')?.xp).toBe(-2);
  expect(queryNotes).toHaveBeenCalledTimes(3);
  expect(readNote).toHaveBeenCalledTimes(1);
});
