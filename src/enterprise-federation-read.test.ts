import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { SocialService } from './social.js';
import { AgentDirectoryService } from './agent-directory.js';
import { EnterpriseFederationAdapter } from './enterprise-federation.js';
import { PublicFederationHub } from './public-federation.js';
import type { PublicFederationReplica, PublicFederationTransport } from './public-federation-replica.js';
import type { ScopePrincipal } from './scope-auth.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(comments = 0) {
  const root = await mkdtemp(join(tmpdir(), 'federation-read-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const hub = new PublicFederationHub(join(root, 'hub')); cleanups.push(() => hub.close());
  const identity = { origin: 'source', agentId: 'alice' }, actorId = 'actor:source:alice', postId = 'post:source:alice:topic';
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor');
  await hub.publish({ type: 'profile', actorId, expectedRevision: 0, displayName: 'Alice', bio: 'Verified public biography.' }, identity, 'profile');
  await hub.publish({ type: 'post', actorId, objectId: postId, expectedRevision: 0, title: 'Topic', body: 'Verified public body.' }, identity, 'post');
  const ids: string[] = [];
  for (let i = 0; i < comments; i++) {
    const id = `comment:source:alice:c${String(i).padStart(3, '0')}`; ids.push(id);
    await hub.publish({ type: 'comment', actorId, objectId: id, expectedRevision: 0, postId, body: `Comment ${i} ${'x'.repeat(80)}` }, identity, `comment-${i}`);
  }
  await mkdir(join(root, 'vault'));
  const fs = new FileSystemService(join(root, 'vault')), access = new ScopeAccessPolicy({ commandCenterId: 'reader' });
  const social = new SocialService(fs, access, new ReferenceService(fs, access), { getMany: async () => new Map(), getForPrincipal: async () => ({ level: 0, xp: 0, label: 'new' }) } as never,
    undefined, { communityRoot: 'PublicCommunity/Local', publicMode: true });
  const author: ScopePrincipal = { accountId: 'alice-account', modelId: 'codex', agentId: 'alice', role: 'agent', commandCenterId: 'source',
    capabilities: ['publish', 'comment', 'profile'], enterprise: { mode: 'public', realmId: 'source', runtimeId: 'alice-runtime', sharedMemoryEnabled: false } };
  const directory = new AgentDirectoryService(fs, { listPrincipals: async () => [author] } as never, { communityRoot: 'PublicCommunity/Local', publicMode: true });
  const adapter = new EnterpriseFederationAdapter({ vaultPath: fs.getVaultPath(), social, directory,
    config: { baseUrl: 'http://127.0.0.1:1', trustedHubPublicKey: hub.getPublicKey(), actors: {} } });
  const reader = (adapter as unknown as { reader: PublicFederationReplica }).reader;
  const transport = (reader as unknown as { client: PublicFederationTransport }).client;
  let mode: 'online' | 'offline' | 'signature' | 'partial' = 'online';
  // Replace only network delivery: signatures, replica application, storage and adapters remain real.
  const feed = vi.spyOn(transport, 'getFeed').mockImplementation(async (after, limit) => {
    if (mode === 'offline') throw new Error('offline E:/private-host/TOP-SECRET');
    const result = await hub.getFeed(after, mode === 'partial' ? 1 : limit);
    return mode === 'signature' ? { ...result, signature: 'invalid' } : result;
  });
  const read = (name: string, args: Record<string, unknown> = {}, principal?: ScopePrincipal) => adapter.dispatch(name, args, principal) as Promise<Record<string, any>>;
  return { root, fs, hub, identity, actorId, postId, ids, reader, social, directory, author, feed, read, setMode: (value: typeof mode) => { mode = value; } };
}

test('federated comments deliver 30 as 20 then 10 new comments with an explicit non-regressing cursor', async () => {
  const f = await fixture(30);
  const first = await f.read('list_blog_comments', { slug: f.postId, limit: 20, maxChars: 12000 });
  expect(first.comments.map((c: any) => c.commentId)).toEqual(f.ids.slice(0, 20));
  expect(first.total).toBe(30); expect(first.truncated).toBe(true); expect(first.nextCursor).toBe(f.ids[19]);
  expect(first.nextAction).toMatchObject({ endpointId: 'community.comments', arguments: { slug: f.postId, afterCommentId: f.ids[19] } });
  const second = await f.read('list_blog_comments', first.nextAction.arguments);
  expect(second.comments.map((c: any) => c.commentId).slice(second.contextBefore)).toEqual(f.ids.slice(20));
  expect(second.contextBefore).toBe(2); expect(second.nextCursor).toBe(f.ids[29]); expect(second.truncated).toBe(false);
  expect(second.nextAction).toBeUndefined();
}, 30000);

test('federated comments traverse beyond the replica 100-row window without loss and within the whole envelope budget', async () => {
  const f = await fixture(105);
  await f.read('public_federation_pull', { limit: 100 }); await f.read('public_federation_pull', { limit: 100 });
  f.setMode('offline');
  let args: Record<string, unknown> = { slug: f.postId, limit: 20, maxChars: 2500 };
  const delivered: string[] = [];
  for (let page = 0; page < 40; page++) {
    const result = await f.read('list_blog_comments', args);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2500);
    const fresh = result.comments.slice(result.contextBefore).map((c: any) => c.commentId);
    expect(fresh.length).toBeGreaterThan(0); delivered.push(...fresh);
    expect(result.nextCursor).toBe(fresh.at(-1));
    if (!result.truncated) break;
    args = result.nextAction.arguments;
  }
  expect(delivered).toEqual(f.ids);
}, 30000);

test('a first comment too large for its envelope returns a budget retry, never false completion or a context-only advancing cursor', async () => {
  const f = await fixture(3);
  const page = await f.read('list_blog_comments', { slug: f.postId, afterCommentId: f.ids[0], maxChars: 512, limit: 2 });
  expect(JSON.stringify(page).length).toBeLessThanOrEqual(512);
  expect(page.comments).toEqual([]); expect(page.truncated).toBe(true); expect(page.nextCursor).toBe(f.ids[0]);
  expect(page.reason).toBe('budget_exhausted');
  expect(page.nextAction.arguments.afterCommentId).toBe(f.ids[0]); expect(page.nextAction.arguments.maxChars).toBeGreaterThan(512);
  await expect(f.read('list_blog_comments', { slug: f.postId, maxChars: 1 })).rejects.toThrow(/budget|maxChars/i);
  await expect(f.read('list_blog_comments', { slug: f.postId, afterCommentId: 'comment:source:alice:missing' })).rejects.toThrow(/cursor/i);
});

test.each(['offline', 'signature'] as const)('all federated read surfaces label their last verified cache after %s failure', async mode => {
  const f = await fixture(1); await f.read('public_federation_pull', { limit: 100 }); f.setMode(mode);
  const calls: Array<[string, Record<string, unknown>]> = [
    ['read_blog_post', { slug: f.postId }], ['list_blog_posts', {}], ['list_blog_comments', { slug: f.postId }],
    ['get_agent_profile', { identity: f.actorId }], ['list_agent_profiles', {}],
    ['public_federation_get', { objectId: f.postId }], ['public_federation_list', {}],
  ];
  for (const [name, args] of calls) {
    const value = await f.read(name, args);
    expect(value.sync).toMatchObject({ state: 'unavailable', cursor: 4 });
    expect(value.sync.reasons).toEqual([mode === 'signature' ? 'invalid_feed' : 'hub_unavailable']);
    expect(JSON.stringify(value)).not.toMatch(/TOP-SECRET|private-host|E:\//);
  }
  expect((await f.read('read_blog_post', { slug: f.postId })).content).toBe('Verified public body.');
  const absent = await f.read('public_federation_get', { objectId: 'post:source:alice:missing' });
  expect(absent).toMatchObject({ found: false, absence: 'unverified', sync: { state: 'unavailable' } });
});

test('partial sync is not authoritative absence and later verified deletion removes the cached body', async () => {
  const f = await fixture(); f.setMode('partial');
  const partial = await f.read('public_federation_get', { objectId: f.postId });
  expect(partial).toMatchObject({ found: false, absence: 'unverified', sync: { state: 'partial', cursor: 1, reasons: ['more_events'] } });
  f.setMode('online');
  expect((await f.read('read_blog_post', { slug: f.postId })).sync.state).toBe('caught_up');
  await f.hub.publish({ type: 'tombstone', actorId: f.actorId, objectId: 'tombstone:source:alice:removed', targetObjectId: f.postId,
    expectedRevision: 1, reason: 'Author removed this post.' }, f.identity, 'removed');
  f.setMode('offline'); expect((await f.read('read_blog_post', { slug: f.postId })).content).toBe('Verified public body.');
  f.setMode('online');
  const removed = await f.read('public_federation_get', { objectId: f.postId });
  expect(removed).toMatchObject({ found: false, absence: 'verified', sync: { state: 'caught_up' } });
  expect(JSON.stringify(removed)).not.toContain('Verified public body.');
});

test('a failed cache refresh returns the previous complete verified snapshot without exposing storage errors', async () => {
  const f = await fixture(); await f.read('public_federation_pull', { limit: 100 });
  await f.hub.publish({ type: 'update', actorId: f.actorId, objectId: 'update:source:alice:changed', targetObjectId: f.postId,
    expectedRevision: 1, body: 'New body not committed to the complete cache.' }, f.identity, 'changed');
  vi.spyOn(f.reader as any, 'reconcile').mockRejectedValueOnce(new Error('E:/private-host/TOP-SECRET cache write failed'));
  const value = await f.read('read_blog_post', { slug: f.postId });
  expect(value.content).toBe('Verified public body.');
  expect(value.sync).toMatchObject({ state: 'unavailable', cursor: 3, reasons: ['cache_unavailable'] });
  expect(JSON.stringify(value)).not.toMatch(/TOP-SECRET|private-host/);
  expect((await f.read('read_blog_post', { slug: f.postId })).content).toBe('New body not committed to the complete cache.');
});

test('direct object and list envelopes include sync in their exact output budget', async () => {
  const f = await fixture();
  await f.hub.publish({ type: 'update', actorId: f.actorId, objectId: 'update:source:alice:long', targetObjectId: f.postId,
    expectedRevision: 1, body: '\"\\\n'.repeat(1000) }, f.identity, 'long');
  for (const maxChars of [512, 1024]) {
    const value = await f.read('public_federation_get', { objectId: f.postId, maxChars });
    expect(value.truncated).toBe(true); expect(value.record.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(maxChars); expect(value.sync.state).toBe('caught_up');
    const list = await f.read('public_federation_list', { maxChars });
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(maxChars); expect(list.sync.state).toBe('caught_up');
  }
});

test.each(['hide', 'tombstone'] as const)('verified %s blocks local author fallback, local slug reads and merged post lists', async action => {
  const f = await fixture();
  await f.social.publishBlogPost({ principal: f.author, slug: 'topic', title: 'Local title', content: 'LOCAL-BODY-MARKER', expectedRevision: 'missing', status: 'published' });
  await f.read('public_federation_pull', { limit: 100 });
  if (action === 'hide') await f.hub.moderate({ objectId: f.postId, action: 'hide', reason: 'Reviewed moderation.', expectedRevision: 0 },
    { origin: 'hub', agentId: 'moderator', role: 'moderator' }, 'hide');
  else await f.hub.publish({ type: 'tombstone', actorId: f.actorId, objectId: 'tombstone:source:alice:local', targetObjectId: f.postId,
    expectedRevision: 1, reason: 'Author removed the object.' }, f.identity, 'tombstone');
  for (const slug of [f.postId, 'topic']) {
    const value = await f.read('read_blog_post', { slug }, f.author);
    expect(value).toMatchObject({ found: false, absence: 'verified', sync: { state: 'caught_up' } });
    expect(JSON.stringify(value)).not.toMatch(/LOCAL-BODY-MARKER|Local title/);
  }
  const list = await f.read('list_blog_posts', { includeExcerpt: true }, f.author);
  expect(list.posts).toEqual([]); expect(list.total).toBe(0); expect(JSON.stringify(list)).not.toMatch(/LOCAL-BODY-MARKER|Local title/);
});

test('both post slug forms include content, metadata and sync inside the requested response budget', async () => {
  const f = await fixture(), content = '\"\\\n'.repeat(1000);
  await f.social.publishBlogPost({ principal: f.author, slug: 'topic', title: 'Topic', content, expectedRevision: 'missing', status: 'published' });
  await f.hub.publish({ type: 'update', actorId: f.actorId, objectId: 'update:source:alice:post-budget', targetObjectId: f.postId,
    expectedRevision: 1, body: content }, f.identity, 'post-budget');
  for (const slug of [f.postId, 'topic']) for (const maxChars of [512, 1200]) {
    const value = await f.read('read_blog_post', { slug, maxChars }, f.author);
    expect(value.truncated).toBe(true); expect(value.sync.state).toBe('caught_up');
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(maxChars);
    expect(value.revision).toBeTruthy(); expect(value.fm.post_id).toBeTruthy();
  }
});

test('a cold adapter state parse failure does not disclose raw state text or host paths', async () => {
  const f = await fixture(), path = join(f.root, 'vault', '.mcpvault', 'public-federation', 'enterprise-state.json');
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'TOP-SECRET E:/private-host broken JSON');
  const failure = await f.read('public_federation_get', { objectId: f.postId }).catch(error => error);
  expect(failure).toBeInstanceOf(Error); expect(failure.message).toMatch(/state unavailable/i);
  expect(failure.message).not.toMatch(/TOP-SECRET|private-host|federation-read-/);
});

test('local profile identities cannot bypass a verified public profile hide', async () => {
  const f = await fixture();
  await f.directory.update({ principal: f.author, displayName: 'LOCAL-PROFILE-MARKER', bio: 'Local biography.', expectedRevision: 'missing' });
  await f.hub.moderate({ objectId: 'profile:source:alice', action: 'hide', reason: 'Reviewed moderation.', expectedRevision: 0 },
    { origin: 'hub', agentId: 'moderator', role: 'moderator' }, 'hide-profile');
  for (const identity of ['alice', f.actorId]) {
    const value = await f.read('get_agent_profile', { role: 'agent', identity });
    expect(value).toMatchObject({ found: false, sync: { state: 'caught_up' } });
    expect(JSON.stringify(value)).not.toMatch(/LOCAL-PROFILE-MARKER|biography/);
  }
});

test('pretty-printed federation windows count formatting inside the total response budget', async () => {
  const f = await fixture(10);
  for (const [name, args] of [
    ['list_blog_comments', { slug: f.postId, limit: 10 }], ['public_federation_list', { type: 'comment', limit: 10 }],
  ] as const) {
    const value = await f.read(name, { ...args, maxChars: 1800, prettyPrint: true });
    expect(JSON.stringify(value, null, 2).length).toBeLessThanOrEqual(1800);
    expect(value.truncated).toBe(true);
  }
});

test('a maximum-budget oversized comment offers a revision-pinned raw read before explicit traversal continuation', async () => {
  const f = await fixture(2), body = 'LONG-COMMENT-' + 'x'.repeat(25000);
  await f.hub.publish({ type: 'update', actorId: f.actorId, objectId: 'update:source:alice:oversized', targetObjectId: f.ids[0]!,
    expectedRevision: 1, body }, f.identity, 'oversized');
  const page = await f.read('list_blog_comments', { slug: f.postId, maxChars: 20000, limit: 2 });
  expect(page.reason).toBe('oversized_item'); expect(page.comments).toEqual([]); expect(page.truncated).toBe(true);
  expect(page.nextCursor).toBeUndefined(); expect(JSON.stringify(page).length).toBeLessThanOrEqual(20000);
  expect(page.nextAction.endpointId).toBe('mcp.read_note_lines');
  const target = await f.fs.readNote(page.nextAction.arguments.path);
  expect(page.nextAction.arguments.expectedRevision).toBe(target.revision);
  expect(page.nextAction.arguments).toMatchObject({ startLine: 1, endLine: target.originalContent.split(/\r\n|\n|\r/).length, maxChars: 12000 });
  expect(target.content).toContain(body);
  expect(page.continuationAfterRead.arguments.afterCommentId).toBe(f.ids[0]);
  const following = await f.read('list_blog_comments', page.continuationAfterRead.arguments);
  expect(following.comments.slice(following.contextBefore).map((c: any) => c.commentId)).toEqual([f.ids[1]]);
  expect(following.truncated).toBe(false);
  await writeFile(join(f.fs.getVaultPath(), page.nextAction.arguments.path), 'TAMPERED-PROJECTION-MARKER');
  await expect(f.reader.getImportedReadTarget(f.ids[0]!, 2)).rejects.toThrow(/projection.*unavailable|projection.*changed/i);
  await expect(f.reader.getImportedReadTarget(f.ids[0]!, 1)).rejects.toThrow(/changed|unavailable/i);
});
