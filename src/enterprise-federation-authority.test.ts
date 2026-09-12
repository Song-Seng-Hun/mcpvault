import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { EnterpriseFederationAdapter } from './enterprise-federation.js';
import { startPublicFederationHub, PublicFederationClient } from './public-federation-http.js';
import { federationStorageName } from './public-federation-storage.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { OwnerActivityPolicy } from './owner-activity.js';
import { OwnerActivityRuntime } from './owner-activity-runtime.js';
import type { ScopePrincipal } from './scope-auth.js';
import { FileSystemService } from './filesystem.js';
import { SocialService } from './social.js';
import { ReferenceService } from './references.js';
import { AgentDirectoryService } from './agent-directory.js';

const roots: string[] = [], handles: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const principal: ScopePrincipal = { accountId: 'reader', modelId: 'model', agentId: 'reader', role: 'agent', commandCenterId: 'local',
  capabilities: ['publish', 'comment', 'profile'], enterprise: { mode: 'public', realmId: 'local', runtimeId: 'runtime', sharedMemoryEnabled: false } };
const postId = 'post:remote:writer:post', commentId = 'comment:local:reader:reply';
const source = `PublicCommunity/Imported/remote/Posts/${federationStorageName(postId)}.md`;
const destination = `PublicCommunity/Local/FederatedComments/${federationStorageName(commentId)}.md`;
const args = { slug: postId, content: 'An authorized reply', commentId: 'reply' };

async function fixture(pathFilter?: PathFilter) {
  const root = await mkdtemp(join(tmpdir(), 'federation-write-authority-')); roots.push(root);
  const hubRoot = await mkdtemp(join(tmpdir(), 'federation-write-hub-')); roots.push(hubRoot);
  const handle = await startPublicFederationHub(hubRoot, { credentials: { token: { origin: 'local', agentId: 'reader' } } }); handles.push(handle);
  const writer = { origin: 'remote', agentId: 'writer' };
  await handle.hub.publish({ type: 'actor', actorId: 'actor:remote:writer', expectedRevision: 0 }, writer, 'actor');
  await handle.hub.publish({ type: 'post', objectId: postId, actorId: 'actor:remote:writer', expectedRevision: 0, title: 'Post', body: 'Public post' }, writer, 'post');
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const social = new SocialService(fs, access, new ReferenceService(fs, access),
    { getMany: async () => new Map(), getForPrincipal: async () => ({ level: 0, xp: 0, label: 'new' }) } as any,
    undefined, { communityRoot: 'PublicCommunity/Local', publicMode: true });
  const directory = new AgentDirectoryService(fs, {} as any, { communityRoot: 'PublicCommunity/Local', publicMode: true });
  const adapter = new EnterpriseFederationAdapter({ vaultPath: root, social, directory, pathFilter,
    config: { baseUrl: `http://${handle.host}:${handle.port}`, trustedHubPublicKey: handle.hub.getPublicKey(), actors: { reader: { authToken: 'token' } } } });
  await adapter.dispatch('public_federation_pull', {});
  return { root, handle, adapter };
}
async function scoped<T>(prefixes: string[], run: () => Promise<T>, options: { access?: ScopeAccessPolicy; beforeWrite?: (path: string) => void; allowed?: () => boolean } = {}) {
  const policy = new OwnerActivityPolicy({ version: 1, owners: { reader: 'owner' }, grants: [{
    id: 'grant', ownerId: 'owner', accountIds: ['reader'], activities: ['collaboration'], actions: ['discover', 'read', 'execute'],
    dataPrefixes: prefixes, executionTargets: ['runtime'], expiresAt: '2999-01-01T00:00:00.000Z',
  }] });
  const runtime = new OwnerActivityRuntime({ policy: () => policy, execution: () => ({ accountId: 'reader', executionTarget: 'runtime' }) });
  const op = await runtime.begin('collaboration', 'execute', [], principal);
  return withEnterpriseStorageContext({ access: options.access ?? new ScopeAccessPolicy(), principal, publicCommunityWriter: true,
    assertFresh: op.assertFresh, canAccessPath: path => options.allowed?.() !== false && op.canAccessPath(path), canTraversePath: op.canTraversePath,
    beforeWrite: async path => { options.beforeWrite?.(path); await op.beforeWrite(path); } }, run);
}

test('a source-only grant cannot create a remote reply, prepare an intent, or publish an actor', async () => {
  const f = await fixture(), before = await f.handle.hub.getFeed(0, 100);
  await scoped([source], () => expect(f.adapter.dispatch('comment_on_blog_post', args, principal)).rejects.toThrow(/denied|unavailable/i));
  await expect(readFile(join(f.root, destination))).rejects.toThrow(/ENOENT/);
  expect(await readdir(join(f.root, '.mcpvault/public-federation/enterprise-intents'), { recursive: true }).catch(() => [])).toEqual([]);
  expect(await f.handle.hub.getFeed(0, 100)).toEqual(before);
});

test.each(['publish_blog_post', 'update_agent_profile'])('%s rejects an unrelated grant before actor publication', async operation => {
  const f = await fixture(), before = await f.handle.hub.getFeed(0, 100);
  await scoped([source], () => expect(f.adapter.dispatch(operation, {
    slug: 'unapproved', title: 'Title', content: 'Content', displayName: 'Profile', expectedRevision: 'missing',
  }, principal)).rejects.toThrow(/denied|unavailable/i));
  expect(await f.handle.hub.getFeed(0, 100)).toEqual(before);
});

test.each(['path-filter', 'document-policy'] as const)('remote writes require destination %s permission even with owner consent', async kind => {
  const f = await fixture(kind === 'path-filter' ? new PathFilter({ ignoredPatterns: [destination] }) : undefined);
  const access = new ScopeAccessPolicy({ documentRules: () => kind === 'document-policy' ? [{ path: destination, confidential: true }] : [] });
  await scoped([source, destination], () => expect(f.adapter.dispatch('comment_on_blog_post', args, principal)).rejects.toThrow(/denied|unavailable/i), { access });
  await expect(readFile(join(f.root, destination))).rejects.toThrow(/ENOENT/);
  expect((await f.handle.hub.getFeed(0, 100)).events).toHaveLength(2);
});

test('the exact source and destination grant permits the reply without a folder-wide grant', async () => {
  const f = await fixture();
  const reply: any = await scoped([source, destination], () => f.adapter.dispatch('comment_on_blog_post', args, principal));
  expect(reply.federation.status).toBe('published');
  expect(await readFile(join(f.root, destination), 'utf8')).toContain(args.content);
});

test('permission loss at the final write guard prevents both local content and comment publication', async () => {
  const f = await fixture(); let allowed = true, checks = 0;
  await scoped([source, destination], () => expect(f.adapter.dispatch('comment_on_blog_post', args, principal)).rejects.toThrow(/denied|unavailable/i), {
    allowed: () => allowed, beforeWrite: path => { if (path === destination && ++checks === 3) allowed = false; },
  });
  expect(checks).toBeGreaterThanOrEqual(3);
  await expect(readFile(join(f.root, destination))).rejects.toThrow(/ENOENT/);
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toEqual([]);
});

test('an offline reply cannot be published from an outbox after destination consent is lost', async () => {
  const f = await fixture(), publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'comment') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  const reply: any = await scoped([source, destination], () => f.adapter.dispatch('comment_on_blog_post', args, principal));
  expect(reply.federation.status).toBe('pending'); offline.mockRestore();
  const original = await readFile(join(f.root, destination), 'utf8');
  await scoped([source], () => expect(f.adapter.dispatch('public_federation_retry', {}, principal)).rejects.toThrow(/denied|unavailable/i));
  expect(await readFile(join(f.root, destination), 'utf8')).toBe(original);
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toEqual([]);
  const retry: any = await scoped([source, destination], () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect(retry.recovered).toContain(commentId);
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toHaveLength(1);
});

test('scoped bridge reads mark absence unverified and never return a global cursor', async () => {
  const f = await fixture();
  const result: any = await scoped([source], () => f.adapter.dispatch('read_blog_post', { slug: 'post:remote:writer:missing' }, principal));
  expect(result).toMatchObject({ found: false, absence: 'unverified', sync: { state: 'scoped', reasons: ['scope_limited'] } });
  expect(result.sync).not.toHaveProperty('cursor');
});

test.each(['edit_blog_comment', 'delete_blog_comment'])('%s cannot write a remote reply with only imported read consent', async operation => {
  const f = await fixture();
  await f.adapter.dispatch('comment_on_blog_post', args, principal);
  const original = await readFile(join(f.root, destination), 'utf8'), before = await f.handle.hub.getFeed(0, 100);
  const importedComment = `PublicCommunity/Imported/local/Comments/${federationStorageName(commentId)}.md`;
  await scoped([source, importedComment], () => expect(f.adapter.dispatch(operation, {
    slug: postId, commentId, content: 'Forbidden edit', expectedRevision: '1',
  }, principal)).rejects.toThrow(/denied|unavailable/i));
  expect(await readFile(join(f.root, destination), 'utf8')).toBe(original);
  expect(await f.handle.hub.getFeed(0, 100)).toEqual(before);
});

test('offline replay rechecks original post access, not just permission for the reply destination', async () => {
  const f = await fixture(), publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'comment') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  await scoped([source, destination], () => f.adapter.dispatch('comment_on_blog_post', args, principal)); offline.mockRestore();
  await scoped([destination], () => expect(f.adapter.dispatch('public_federation_retry', {}, principal)).rejects.toThrow(/denied|unavailable/i));
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toEqual([]);
});

test('a committed local post intent cannot bypass current destination consent on retry', async () => {
  const f = await fixture(), publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'post') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  const postPath = 'PublicCommunity/Local/Posts/local-post.md';
  await f.adapter.dispatch('publish_blog_post', { slug: 'local-post', title: 'Local', content: 'Stored payload', expectedRevision: 'missing' }, principal);
  offline.mockRestore();
  await scoped([source], () => expect(f.adapter.dispatch('public_federation_retry', {}, principal)).rejects.toThrow(/denied|unavailable/i));
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'post' && event.record.objectId === 'post:local:reader:local-post')).toEqual([]);
  const retry: any = await scoped([postPath], () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect(retry.recovered).toContain('post:local:reader:local-post');
});

test('committed local reply replay rechecks the parent comment scope', async () => {
  const f = await fixture();
  await f.adapter.dispatch('publish_blog_post', { slug: 'thread', title: 'Thread', content: 'Post', expectedRevision: 'missing' }, principal);
  await f.adapter.dispatch('comment_on_blog_post', { slug: 'thread', commentId: 'parent', content: 'Parent' }, principal);
  const publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'comment') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  await f.adapter.dispatch('comment_on_blog_post', { slug: 'thread', commentId: 'child', content: 'Child', replyTo: 'parent' }, principal);
  offline.mockRestore();
  const paths = ['PublicCommunity/Local/Posts/thread.md', 'PublicCommunity/Local/Comments/thread/child.md'];
  await scoped(paths, () => expect(f.adapter.dispatch('public_federation_retry', {}, principal)).rejects.toThrow(/denied|unavailable/i));
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment' && event.record.objectId.endsWith(':child'))).toEqual([]);
  const retry: any = await scoped([...paths, 'PublicCommunity/Local/Comments/thread/parent.md'], () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect(retry.recovered).toContain('comment:local:reader:child');
}, 15000);

test('an outbox payload cannot borrow authorization from a different intent with the same object ID', async () => {
  const f = await fixture(), secondPost = 'post:remote:writer:second';
  await f.handle.hub.publish({ type: 'post', objectId: secondPost, actorId: 'actor:remote:writer', expectedRevision: 0, title: 'Second', body: 'Other post' },
    { origin: 'remote', agentId: 'writer' }, 'second');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const intentName = (postId: string, body: string) => sha(`comment:${commentId}:${sha(JSON.stringify({ postId, body }))}`);
  const firstName = intentName(postId, args.content);
  const secondBody = Array.from({ length: 100 }, (_, i) => `Second reply ${i}`).find(body => intentName(secondPost, body) < firstName)!;
  expect(secondBody).toBeDefined();
  const publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'comment') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  await f.adapter.dispatch('comment_on_blog_post', args, principal);
  await f.adapter.dispatch('comment_on_blog_post', { ...args, slug: secondPost, content: secondBody }, principal);
  offline.mockRestore();
  const secondSource = `PublicCommunity/Imported/remote/Posts/${federationStorageName(secondPost)}.md`;
  await scoped([secondSource, destination], () => expect(f.adapter.dispatch('public_federation_retry', {}, principal)).rejects.toThrow(/denied|unavailable/i));
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toEqual([]);
}, 15000);

test('fully authorized offline intents recover in queue order even when filename order is reversed', async () => {
  const f = await fixture(), secondId = 'comment:local:reader:second-reply';
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const intentName = (id: string, body: string) => sha(`comment:${id}:${sha(JSON.stringify({ postId, body }))}`);
  const firstName = intentName(commentId, args.content);
  const body = Array.from({ length: 1000 }, (_, i) => `Independent reply ${i}`).find(text => intentName(secondId, text) < firstName)!;
  expect(body).toBeDefined();
  const publish = PublicFederationClient.prototype.publish;
  const offline = vi.spyOn(PublicFederationClient.prototype, 'publish').mockImplementation(function(input, key) {
    if (input.type === 'comment') return Promise.reject(new Error('Simulated offline delivery'));
    return publish.call(this, input, key);
  });
  await f.adapter.dispatch('comment_on_blog_post', args, principal);
  await f.adapter.dispatch('comment_on_blog_post', { ...args, commentId: 'second-reply', content: body }, principal);
  offline.mockRestore();
  const paths = [source, destination, `PublicCommunity/Local/FederatedComments/${federationStorageName(secondId)}.md`];
  const result: any = await scoped(paths, () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect(result.recovered).toEqual(expect.arrayContaining([commentId, secondId]));
  await scoped(paths, () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'comment')).toHaveLength(2);
}, 15000);

test('retry restores actor creation after interruption between intent persistence and actor publication', async () => {
  const f = await fixture(), postPath = 'PublicCommunity/Local/Posts/interrupted.md';
  vi.spyOn(f.adapter as any, 'ensureActor').mockRejectedValueOnce(new Error('Simulated interruption before actor creation'));
  await expect(f.adapter.dispatch('publish_blog_post', { slug: 'interrupted', title: 'Interrupted', content: 'Recover me', expectedRevision: 'missing' }, principal)).rejects.toThrow(/Simulated interruption/);
  await expect(readFile(join(f.root, postPath))).rejects.toThrow(/ENOENT/);
  expect((await f.handle.hub.getFeed(0, 100)).events.some(event => event.record.actorId === 'actor:local:reader')).toBe(false);
  const retry: any = await scoped([postPath], () => f.adapter.dispatch('public_federation_retry', {}, principal));
  expect(retry.recovered).toContain('post:local:reader:interrupted');
  expect(await readFile(join(f.root, postPath), 'utf8')).toContain('Recover me');
  expect((await f.handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'actor' && event.record.actorId === 'actor:local:reader')).toHaveLength(1);
});
