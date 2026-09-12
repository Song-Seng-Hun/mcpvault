import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { SocialService } from './social.js';
import { AgentDirectoryService } from './agent-directory.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { startPublicFederationHub } from './public-federation-http.js';
import { EnterpriseFederationAdapter } from './enterprise-federation.js';
import { makePublicObjectId } from './public-federation.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function services(vault: string) {
  const fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy({ commandCenterId: 'acme' });
  return {
    social: new SocialService(fs, access, new ReferenceService(fs, access), { getMany: async () => new Map(), getForPrincipal: async () => ({ level: 0, xp: 0, label: 'new' }) } as never, undefined, { communityRoot: 'PublicCommunity/Local', publicMode: true }),
    directory: new AgentDirectoryService(fs, {} as ScopeAuthService, { communityRoot: 'PublicCommunity/Local', publicMode: true }),
  };
}

function principal(origin: string, agentId: string): ScopePrincipal {
  return {
    accountId: `${agentId}-account`, modelId: 'codex', agentId, role: 'agent', commandCenterId: origin,
    capabilities: ['publish', 'comment', 'profile'],
    enterprise: { mode: 'public', realmId: origin, runtimeId: `${agentId}-runtime`, sharedMemoryEnabled: false },
  };
}

// Full signed-feed CRUD across three real filesystem roots takes just over
// five seconds on Windows. Retain real persistence and all visibility checks.
test('enterprise bridge publishes only public local service records and reads remote posts through ordinary names', async () => {
  const hubRoot = await mkdtemp(join(tmpdir(), 'enterprise-federation-hub-')); roots.push(hubRoot);
  const aliceRoot = await mkdtemp(join(tmpdir(), 'enterprise-federation-a-')); roots.push(aliceRoot);
  const bobRoot = await mkdtemp(join(tmpdir(), 'enterprise-federation-b-')); roots.push(bobRoot);
  const alice = principal('company-a', 'alice');
  const bob = principal('company-b', 'bob');
  const handle = await startPublicFederationHub(hubRoot, { credentials: {
    'alice-token': { origin: 'company-a', agentId: 'alice' },
    'bob-token': { origin: 'company-b', agentId: 'bob' },
  } });
  try {
    const aliceServices = services(aliceRoot);
    const bobServices = services(bobRoot);
    const shared = { baseUrl: `http://${handle.host}:${handle.port}`, trustedHubPublicKey: handle.hub.getPublicKey() };
    const aliceAdapter = new EnterpriseFederationAdapter({ vaultPath: aliceRoot, ...aliceServices, config: { ...shared, actors: { alice: { authToken: 'alice-token' } } } });
    const bobAdapter = new EnterpriseFederationAdapter({ vaultPath: bobRoot, ...bobServices, config: { ...shared, actors: { bob: { authToken: 'bob-token' } } } });

    await aliceAdapter.dispatch('update_agent_profile', { displayName: 'Alice Public', bio: 'Public only.', interests: ['private-project'], expectedRevision: 'missing' }, alice);
    const post = await aliceAdapter.dispatch('publish_blog_post', { slug: 'hello', title: 'Hello', content: 'Federated public post.', expectedRevision: 'missing', status: 'published' }, alice) as Record<string, any>;
    expect(post.federation.status).toBe('published');
    expect(await readFile(join(aliceRoot, 'PublicCommunity', 'Local', 'Posts', 'hello.md'), 'utf8')).toContain('Federated public post.');
    await expect(readFile(join(aliceRoot, 'PublicCommunity', 'Local', 'Posts', 'post_company-a_alice_hello.md'), 'utf8')).rejects.toThrow();
    await expect(aliceAdapter.dispatch('publish_blog_post', { slug: 'draft', title: 'Draft', content: 'Private draft.', expectedRevision: 'missing', status: 'draft' }, alice)).rejects.toThrow(/draft/i);

    await bobAdapter.dispatch('public_federation_pull', {});
    const listed = await bobAdapter.dispatch('list_blog_posts', { limit: 10 }) as Record<string, any>;
    expect(listed.posts[0]).toMatchObject({ slug: 'post:company-a:alice:hello', title: 'Hello' });
    expect(listed.posts[0]).not.toHaveProperty('content');
    const remotePostId = makePublicObjectId('post', 'company-a', 'alice', 'hello');
    const read = await bobAdapter.dispatch('read_blog_post', { slug: remotePostId }) as Record<string, any>;
    expect(read.content).toBe('Federated public post.');
    expect((await bobAdapter.dispatch('get_agent_profile', { role: 'agent', identity: 'actor:company-a:alice' })) as Record<string, any>).toMatchObject({ profile: { displayName: 'Alice Public', actorId: 'actor:company-a:alice' } });
    expect(((await bobAdapter.dispatch('list_agents', { limit: 10 })) as Record<string, any>).profiles[0]).toMatchObject({ displayName: 'Alice Public', actorId: 'actor:company-a:alice' });
    await expect(bobAdapter.dispatch('comment_on_blog_post', { slug: remotePostId, content: 'Hi @codex', commentId: 'bad-mention' }, bob)).rejects.toThrow(/exact @actor/);
    const comment = await bobAdapter.dispatch('comment_on_blog_post', { slug: remotePostId, content: 'Cross-company reply.', commentId: 'reply-one' }, bob) as Record<string, any>;
    expect(comment.federation.status).toBe('published');
    await aliceAdapter.dispatch('public_federation_pull', {});
    const comments = await aliceAdapter.dispatch('list_blog_comments', { slug: remotePostId, limit: 10 }) as Record<string, any>;
    expect(comments.comments[0]).toMatchObject({ content: 'Cross-company reply.', postId: remotePostId });
    const edited = await bobAdapter.dispatch('edit_blog_comment', { slug: remotePostId, commentId: comment.commentId, content: 'Edited cross-company reply.', expectedRevision: '1' }, bob) as Record<string, any>;
    expect(edited.federation.revision).toBe(2);
    await aliceAdapter.dispatch('public_federation_pull', {});
    expect(((await aliceAdapter.dispatch('list_blog_comments', { slug: remotePostId, limit: 10 })) as Record<string, any>).comments[0].content).toBe('Edited cross-company reply.');
    await bobAdapter.dispatch('delete_blog_comment', { slug: remotePostId, commentId: comment.commentId, expectedRevision: '2' }, bob);
    await aliceAdapter.dispatch('public_federation_pull', {});
    expect(((await aliceAdapter.dispatch('list_blog_comments', { slug: remotePostId, limit: 10 })) as Record<string, any>).comments).toEqual([]);

    const feedTypes = (await handle.hub.getFeed(0, 50)).events.map(event => event.record.type);
    expect(feedTypes).toEqual(['actor', 'profile', 'post', 'actor', 'comment', 'update', 'tombstone']);
  } finally {
    await handle.close();
  }
}, 15000);

test('prepared bridge intent recovers a local-write crash gap and publishes once', async () => {
  const hubRoot = await mkdtemp(join(tmpdir(), 'enterprise-federation-gap-hub-')); roots.push(hubRoot);
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-federation-gap-')); roots.push(vault);
  const alice = principal('company-a', 'alice');
  const handle = await startPublicFederationHub(hubRoot, { credentials: { token: { origin: 'company-a', agentId: 'alice' } } });
  try {
    const actual = services(vault);
    const crashingSocial = Object.create(actual.social) as SocialService;
    crashingSocial.publishBlogPost = async params => {
      await actual.social.publishBlogPost(params);
      throw new Error('simulated process loss after local write');
    };
    const config = { baseUrl: `http://${handle.host}:${handle.port}`, trustedHubPublicKey: handle.hub.getPublicKey(), actors: { alice: { authToken: 'token' } } };
    const crashing = new EnterpriseFederationAdapter({ vaultPath: vault, social: crashingSocial, directory: actual.directory, config });
    await expect(crashing.dispatch('publish_blog_post', { slug: 'recovered', title: 'Recovered', content: 'Committed locally.', expectedRevision: 'missing', accessToken: 'SECRET-TOKEN', password: 'SECRET-PASSWORD', invitation: 'SECRET-INVITE', principal: principal('company-b', 'mallory') }, alice)).rejects.toThrow('simulated');
    const intentRoot = join(vault, '.mcpvault', 'public-federation', 'enterprise-intents');
    const intentNames = (await import('node:fs/promises')).readdir(intentRoot, { recursive: true });
    const intentPath = (await intentNames).map(String).find(name => name.endsWith('.md'))!;
    const persisted = await readFile(join(intentRoot, intentPath), 'utf8');
    expect(persisted).not.toMatch(/SECRET-|mallory|accessToken|password|invitation|principal/);
    const restartedServices = services(vault);
    const restarted = new EnterpriseFederationAdapter({ vaultPath: vault, ...restartedServices, config });
    const retry = await restarted.dispatch('public_federation_retry', {}, alice) as Record<string, any>;
    expect(retry.recovered).toContain('post:company-a:alice:recovered');
    expect((await handle.hub.getFeed(0, 20)).events.filter(event => event.record.type === 'post')).toHaveLength(1);
  } finally {
    await handle.close();
  }
});

test('every social mutation prepares a durable intent that restart recovery publishes once', async () => {
  const hubRoot = await mkdtemp(join(tmpdir(), 'enterprise-federation-crud-hub-')); roots.push(hubRoot);
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-federation-crud-')); roots.push(vault);
  const alice = principal('company-a', 'alice');
  const handle = await startPublicFederationHub(hubRoot, { credentials: { token: { origin: 'company-a', agentId: 'alice' } } });
  try {
    const config = { baseUrl: `http://${handle.host}:${handle.port}`, trustedHubPublicKey: handle.hub.getPublicKey(), actors: { alice: { authToken: 'token' } } };
    let actual = services(vault);
    let adapter = new EnterpriseFederationAdapter({ vaultPath: vault, ...actual, config });
    const post = await adapter.dispatch('publish_blog_post', { slug: 'crud', title: 'CRUD', content: 'Body', expectedRevision: 'missing' }, alice) as Record<string, any>;

    const crashDelete = Object.create(actual.social) as SocialService;
    crashDelete.deleteBlogPost = async params => { await actual.social.deleteBlogPost(params); throw new Error('delete crash'); };
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, social: crashDelete, directory: actual.directory, config });
    await expect(adapter.dispatch('delete_blog_post', { slug: 'crud', expectedRevision: post.revision }, alice)).rejects.toThrow('delete crash');
    actual = services(vault);
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, ...actual, config });
    const deleteRetry = await adapter.dispatch('public_federation_retry', {}, alice) as Record<string, any>;
    expect(deleteRetry.recovered).toContain('post:company-a:alice:crud');

    const base = await adapter.dispatch('publish_blog_post', { slug: 'comments', title: 'Comments', content: 'Body', expectedRevision: 'missing' }, alice) as Record<string, any>;
    expect(base.revision).toBeTruthy();
    const crashComment = Object.create(actual.social) as SocialService;
    crashComment.commentOnBlogPost = async params => { await actual.social.commentOnBlogPost(params); throw new Error('comment crash'); };
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, social: crashComment, directory: actual.directory, config });
    await expect(adapter.dispatch('comment_on_blog_post', { slug: 'comments', content: 'First', commentId: 'one', requestId: 'crud-comment' }, alice)).rejects.toThrow('comment crash');
    actual = services(vault);
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, ...actual, config });
    expect(((await adapter.dispatch('public_federation_retry', {}, alice)) as Record<string, any>).recovered).toContain('comment:company-a:alice:one');

    const localComment = await actual.social.getBlogComment({ principal: alice, slug: 'comments', commentId: 'one' });
    const crashEdit = Object.create(actual.social) as SocialService;
    crashEdit.editBlogComment = async params => { await actual.social.editBlogComment(params); throw new Error('edit crash'); };
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, social: crashEdit, directory: actual.directory, config });
    await expect(adapter.dispatch('edit_blog_comment', { slug: 'comments', commentId: 'one', content: 'Edited', expectedRevision: localComment.revision }, alice)).rejects.toThrow('edit crash');
    actual = services(vault);
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, ...actual, config });
    expect(((await adapter.dispatch('public_federation_retry', {}, alice)) as Record<string, any>).recovered).toContain('comment:company-a:alice:one');

    const edited = await actual.social.getBlogComment({ principal: alice, slug: 'comments', commentId: 'one' });
    const crashCommentDelete = Object.create(actual.social) as SocialService;
    crashCommentDelete.deleteBlogComment = async params => { await actual.social.deleteBlogComment(params); throw new Error('comment delete crash'); };
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, social: crashCommentDelete, directory: actual.directory, config });
    await expect(adapter.dispatch('delete_blog_comment', { slug: 'comments', commentId: 'one', expectedRevision: edited.revision }, alice)).rejects.toThrow('comment delete crash');
    actual = services(vault);
    adapter = new EnterpriseFederationAdapter({ vaultPath: vault, ...actual, config });
    expect(((await adapter.dispatch('public_federation_retry', {}, alice)) as Record<string, any>).recovered).toContain('comment:company-a:alice:one');
    expect((await handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment' || event.record.type === 'update' || event.record.type === 'tombstone')).toHaveLength(4);
  } finally {
    await handle.close();
  }
});
