import { federationStorageName } from './public-federation-storage.js';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PublicFederationHub,
  makePublicActorId,
  makePublicObjectId,
  verifyPublicFederationFeed,
} from './public-federation.js';
import { PublicFederationClient, startPublicFederationHub } from './public-federation-http.js';
import { PublicFederationReplica } from './public-federation-replica.js';

let hubRoot: string;
let aliceRoot: string;
let bobRoot: string;

beforeEach(async () => {
  hubRoot = await mkdtemp(join(tmpdir(), 'mcpvault-public-hub-'));
  aliceRoot = await mkdtemp(join(tmpdir(), 'mcpvault-public-alice-'));
  bobRoot = await mkdtemp(join(tmpdir(), 'mcpvault-public-bob-'));
});

afterEach(async () => {
  await rm(hubRoot, { recursive: true, force: true });
  await rm(aliceRoot, { recursive: true, force: true });
  await rm(bobRoot, { recursive: true, force: true });
});

test('two HTTP replicas share social records and retry a durable outbox after hub restart', async () => {
  const alice = { origin: 'company-a', agentId: 'alice' } as const;
  const bob = { origin: 'company-b', agentId: 'bob' } as const;
  const credentials = { 'alice-token': alice, 'bob-token': bob };
  let handle = await startPublicFederationHub(hubRoot, { credentials });
  const publicKey = handle.hub.getPublicKey();
  let aliceClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'alice-token' });
  let bobClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'bob-token' });
  let aliceReplica = new PublicFederationReplica({ vaultPath: aliceRoot, identity: alice, client: aliceClient, trustedHubPublicKey: publicKey });
  let bobReplica = new PublicFederationReplica({ vaultPath: bobRoot, identity: bob, client: bobClient, trustedHubPublicKey: publicKey });
  const aliceActor = makePublicActorId(alice.origin, alice.agentId);
  const bobActor = makePublicActorId(bob.origin, bob.agentId);
  const alicePost = makePublicObjectId('post', alice.origin, alice.agentId, 'hello');
  const futureBobPost = makePublicObjectId('post', bob.origin, bob.agentId, 'future');
  const earlyComment = makePublicObjectId('comment', alice.origin, alice.agentId, 'early');

  expect((await aliceReplica.publish({ type: 'actor', actorId: aliceActor, expectedRevision: 0 }, 'alice-actor')).status).toBe('published');
  expect((await bobReplica.publish({ type: 'actor', actorId: bobActor, expectedRevision: 0 }, 'bob-actor')).status).toBe('published');
  await expect(aliceClient.publish({ type: 'actor', actorId: bobActor, expectedRevision: 0, origin: 'company-b' } as never, 'forged-http-origin')).rejects.toThrow(/actorId|unsupported/i);
  await aliceReplica.publish({ type: 'post', objectId: alicePost, actorId: aliceActor, expectedRevision: 0, title: 'Hello', body: 'Shared between companies.' }, 'alice-post');
  await aliceReplica.publish({ type: 'comment', objectId: earlyComment, actorId: aliceActor, expectedRevision: 0, postId: futureBobPost, body: 'Parent will arrive.' }, 'early-comment');
  const firstPull = await bobReplica.pull(100);
  expect(firstPull.pending).toContain(earlyComment);
  const importedBefore = (await readdir(join(bobRoot, 'PublicCommunity', 'Imported'), { recursive: true })).map(String);
  expect(importedBefore.some(name => name.includes('Pending'))).toBe(true);
  expect(await readFile(join(aliceRoot, 'PublicCommunity', 'Local', 'Posts', `${federationStorageName(alicePost)}.md`), 'utf8')).toContain('Shared between companies.');

  await bobReplica.publish({ type: 'post', objectId: futureBobPost, actorId: bobActor, expectedRevision: 0, title: 'Future', body: 'The parent arrived.' }, 'future-post');
  await bobReplica.pull(100);
  const importedAfter = (await readdir(join(bobRoot, 'PublicCommunity', 'Imported'), { recursive: true })).map(String);
  expect(importedAfter.some(name => name.includes('Comments'))).toBe(true);

  await handle.close();
  const offlinePost = makePublicObjectId('post', alice.origin, alice.agentId, 'offline');
  expect((await aliceReplica.publish({ type: 'post', objectId: offlinePost, actorId: aliceActor, expectedRevision: 0, title: 'Offline', body: 'Queued durably.' }, 'offline-post')).status).toBe('pending');
  expect((await readdir(join(aliceRoot, '.mcpvault', 'public-federation', 'outbox'))).length).toBe(1);

  handle = await startPublicFederationHub(hubRoot, { credentials });
  aliceClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'alice-token' });
  bobClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'bob-token' });
  aliceReplica = new PublicFederationReplica({ vaultPath: aliceRoot, identity: alice, client: aliceClient, trustedHubPublicKey: publicKey });
  bobReplica = new PublicFederationReplica({ vaultPath: bobRoot, identity: bob, client: bobClient, trustedHubPublicKey: publicKey });
  expect((await aliceReplica.flushOutbox()).published).toContain(offlinePost);
  expect((await readdir(join(aliceRoot, '.mcpvault', 'public-federation', 'outbox'))).length).toBe(0);
  expect((await bobReplica.pull(100)).applied).toContain(offlinePost);
  expect((await bobReplica.getObject(offlinePost))?.record.type).toBe('post');
  const listed = await bobReplica.listObjects({ type: 'post', origin: 'company-a', limit: 1 });
  expect(listed.objects).toHaveLength(1);
  expect(listed.truncated).toBe(true);
  expect(listed.nextCursor).toBeTruthy();
  await handle.close();
});

test('hub persists signed public records and reconstructs idempotency after restart', async () => {
  const identity = { origin: 'company-a', agentId: 'agent-a' } as const;
  const actorId = makePublicActorId(identity.origin, identity.agentId);
  const objectId = makePublicObjectId('post', identity.origin, identity.agentId, 'launch');
  const hub = new PublicFederationHub(hubRoot, { hubId: 'public-hub' });

  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor-1');
  const post = await hub.publish({ type: 'post', objectId, actorId, expectedRevision: 0, title: 'Launch', body: 'Public update.' }, identity, 'post-1');
  const duplicate = await hub.publish({ type: 'post', objectId, actorId, expectedRevision: 0, title: 'Launch', body: 'Public update.' }, identity, 'post-1');
  expect(duplicate.eventId).toBe(post.eventId);

  const key = hub.exportSigningPrivateKey();
  const publicKey = hub.getPublicKey();
  const firstFeed = await hub.getFeed(0, 10);
  expect(verifyPublicFederationFeed(firstFeed, publicKey)).toBe(true);
  expect(firstFeed.events.map(event => event.record.type)).toEqual(['actor', 'post']);
  await hub.close();

  const restarted = new PublicFederationHub(hubRoot, { hubId: 'public-hub', signingPrivateKey: key });
  expect((await restarted.publish({ type: 'post', objectId, actorId, expectedRevision: 0, title: 'Launch', body: 'Public update.' }, identity, 'post-1')).eventId).toBe(post.eventId);
  await expect(restarted.publish({ type: 'post', objectId, actorId, expectedRevision: 0, title: 'Changed', body: 'Public update.' }, identity, 'post-1')).rejects.toThrow('idempotency');
  expect(await readFile(join(hubRoot, 'records', '000000000002.md'), 'utf8')).toContain('Public update.');
  await restarted.close();
});

test('hub root has one process-lifetime writer and releases its durable lock on close', async () => {
  const first = new PublicFederationHub(hubRoot);
  await first.getFeed(0, 1);
  const key = first.exportSigningPrivateKey();
  const second = new PublicFederationHub(hubRoot, { signingPrivateKey: key });
  await expect(second.getFeed(0, 1)).rejects.toThrow(/already in use/);
  await first.close();
  await second.close();

  const restarted = new PublicFederationHub(hubRoot, { signingPrivateKey: key });
  await expect(restarted.getFeed(0, 1)).resolves.toMatchObject({ latestSequence: 0 });
  await restarted.close();
});

test('hub binds ownership to transport identity, enforces CAS, and retains missing parents', async () => {
  const hub = new PublicFederationHub(hubRoot);
  const alice = { origin: 'company-a', agentId: 'alice' } as const;
  const bob = { origin: 'company-b', agentId: 'bob' } as const;
  const aliceActor = makePublicActorId(alice.origin, alice.agentId);
  const bobActor = makePublicActorId(bob.origin, bob.agentId);
  const missingPost = makePublicObjectId('post', bob.origin, bob.agentId, 'later');
  const earlyComment = makePublicObjectId('comment', alice.origin, alice.agentId, 'early');
  await hub.publish({ type: 'actor', actorId: aliceActor, expectedRevision: 0 }, alice, 'alice-actor');
  await hub.publish({ type: 'actor', actorId: bobActor, expectedRevision: 0 }, bob, 'bob-actor');

  const pending = await hub.publish({ type: 'comment', objectId: earlyComment, actorId: aliceActor, expectedRevision: 0, postId: missingPost, body: 'Waiting for its parent.' }, alice, 'early-comment');
  expect(pending.status).toBe('pending-parent');
  await hub.publish({ type: 'post', objectId: missingPost, actorId: bobActor, expectedRevision: 0, title: 'Arrived', body: 'Parent now exists.' }, bob, 'later-post');

  await expect(hub.publish({ type: 'update', objectId: makePublicObjectId('update', bob.origin, bob.agentId, 'steal'), actorId: bobActor, targetObjectId: missingPost, expectedRevision: 1, body: 'forged' }, alice, 'forged-origin')).rejects.toThrow('actorId');
  await expect(hub.publish({ type: 'update', objectId: makePublicObjectId('update', bob.origin, bob.agentId, 'wrong-rev'), actorId: bobActor, targetObjectId: missingPost, expectedRevision: 7, body: 'wrong revision' }, bob, 'wrong-rev')).rejects.toThrow('revision conflict');
  await expect(hub.publish({ type: 'post', objectId: makePublicObjectId('post', alice.origin, alice.agentId, 'private'), actorId: aliceActor, expectedRevision: 0, title: 'No', body: 'See [[Community/private-thread]].' }, alice, 'private-ref')).rejects.toThrow('private');
  await expect(hub.publish({ type: 'profile', actorId: aliceActor, expectedRevision: 0, displayName: 'Alice', email: 'alice@example.test' } as never, alice, 'private-field')).rejects.toThrow('unsupported or private field');
  await expect(hub.publish({ type: 'update', objectId: makePublicObjectId('update', bob.origin, bob.agentId, 'profile-on-post'), actorId: bobActor, targetObjectId: missingPost, expectedRevision: 1, displayName: 'Wrong kind' }, bob, 'wrong-update-kind')).rejects.toThrow('does not apply');
  await expect(hub.publish({ type: 'post', objectId: missingPost, actorId: bobActor, expectedRevision: 0, title: 'Changed', body: 'different' }, bob, 'later-post')).rejects.toThrow('idempotency');
  await hub.close();
});

test('replicas distinguish origin tombstones, global moderation, and local hides', async () => {
  const alice = { origin: 'company-a', agentId: 'alice' } as const;
  const bob = { origin: 'company-b', agentId: 'bob' } as const;
  const moderator = { origin: 'hub-ops', agentId: 'moderator', role: 'moderator' as const };
  const handle = await startPublicFederationHub(hubRoot, { credentials: { alice: alice, bob: bob, moderator } });
  try {
    const aliceClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'alice' });
    const bobClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'bob' });
    const moderatorClient = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'moderator' });
    const aliceReplica = new PublicFederationReplica({ vaultPath: aliceRoot, identity: alice, client: aliceClient, trustedHubPublicKey: handle.hub.getPublicKey() });
    const bobReplica = new PublicFederationReplica({ vaultPath: bobRoot, identity: bob, client: bobClient, trustedHubPublicKey: handle.hub.getPublicKey() });
    const actorId = makePublicActorId(alice.origin, alice.agentId);
    const deletedPost = makePublicObjectId('post', alice.origin, alice.agentId, 'deleted');
    const moderatedPost = makePublicObjectId('post', alice.origin, alice.agentId, 'moderated');
    const locallyHiddenPost = makePublicObjectId('post', alice.origin, alice.agentId, 'locally-hidden');
    const hiddenReply = makePublicObjectId('comment', alice.origin, alice.agentId, 'hidden-reply');
    await aliceReplica.publish({ type: 'actor', actorId, expectedRevision: 0 }, 'actor');
    await aliceReplica.publish({ type: 'profile', actorId, expectedRevision: 0, displayName: 'Alice Public', bio: 'A public profile.' }, 'profile');
    for (const [objectId, title] of [[deletedPost, 'Deleted'], [moderatedPost, 'Moderated'], [locallyHiddenPost, 'Local']] as const) {
      await aliceReplica.publish({ type: 'post', objectId, actorId, expectedRevision: 0, title, body: `${title} body` }, `post-${title}`);
    }
    await aliceReplica.publish({ type: 'comment', objectId: hiddenReply, actorId, expectedRevision: 0, postId: locallyHiddenPost, body: 'Child body must also disappear.' }, 'hidden-reply');
    await aliceReplica.publish({ type: 'update', objectId: makePublicObjectId('update', alice.origin, alice.agentId, 'deleted-v2'), actorId, targetObjectId: deletedPost, expectedRevision: 1, body: 'Updated before deletion.' }, 'update-deleted');
    await aliceReplica.publish({ type: 'tombstone', objectId: makePublicObjectId('tombstone', alice.origin, alice.agentId, 'deleted-v3'), actorId, targetObjectId: deletedPost, expectedRevision: 2, reason: 'Author removed it.' }, 'delete-post');
    await moderatorClient.moderate({ objectId: moderatedPost, action: 'hide', reason: 'Global policy violation.', expectedRevision: 0 }, 'moderate-post');
    expect((await moderatorClient.moderate({ objectId: moderatedPost, action: 'hide', reason: 'Global policy violation.', expectedRevision: 0 }, 'moderate-post')).record.type).toBe('moderation');

    const pulled = await bobReplica.pull(100);
    expect(pulled.hidden).toEqual(expect.arrayContaining([deletedPost, moderatedPost]));
    await bobReplica.hideLocally(locallyHiddenPost, 'Personal preference.');
    const importedNames = (await readdir(join(bobRoot, 'PublicCommunity', 'Imported'), { recursive: true })).map(String);
    expect(importedNames.some(name => name.includes('Tombstones'))).toBe(true);
    expect(importedNames.some(name => name.includes('Moderated'))).toBe(true);
    expect(importedNames.some(name => name.includes('LocallyHidden'))).toBe(true);
    const importedFiles = importedNames.filter(name => name.endsWith('.md'));
    const importedBodies = await Promise.all(importedFiles.map(name => readFile(join(bobRoot, 'PublicCommunity', 'Imported', name), 'utf8')));
    expect(importedBodies.some(body => body.includes('state: origin-tombstone'))).toBe(true);
    expect(importedBodies.some(body => body.includes('state: global-moderation'))).toBe(true);
    expect(importedBodies.some(body => body.includes('state: local-hide'))).toBe(true);
    const unavailable = await Promise.all([
      readFile(join(bobRoot, 'PublicCommunity', 'Imported', 'company-a', 'Tombstones', `${federationStorageName(deletedPost)}.md`), 'utf8'),
      readFile(join(bobRoot, 'PublicCommunity', 'Imported', 'company-a', 'Moderated', `${federationStorageName(moderatedPost)}.md`), 'utf8'),
      readFile(join(bobRoot, 'PublicCommunity', 'Imported', 'company-a', 'LocallyHidden', `${federationStorageName(locallyHiddenPost)}.md`), 'utf8'),
      readFile(join(bobRoot, 'PublicCommunity', 'Imported', 'company-a', 'Pending', `${federationStorageName(hiddenReply)}.md`), 'utf8'),
    ]);
    expect(unavailable.join('\n')).not.toMatch(/Deleted body|Moderated body|Local body|Child body|actor:company-a:alice/);
    expect(await bobReplica.getObject(deletedPost)).toBeUndefined();
    expect((await bobReplica.getObject(deletedPost, { includeUnavailable: true }))?.status).toBe('origin-tombstone');
    expect((await bobReplica.listObjects({ type: 'post' })).objects.every(view => view.status === 'active')).toBe(true);
    expect((await handle.hub.getFeed(0, 100)).events.filter(event => event.record.type === 'moderation')).toHaveLength(1);
  } finally {
    await handle.close();
  }
});

test('replica rejects forged, duplicated, and out-of-order feed pages without advancing', async () => {
  const alice = { origin: 'company-a', agentId: 'alice' } as const;
  const actorId = makePublicActorId(alice.origin, alice.agentId);
  const postId = makePublicObjectId('post', alice.origin, alice.agentId, 'signed');
  const hub = new PublicFederationHub(hubRoot);
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, alice, 'actor');
  await hub.publish({ type: 'post', objectId: postId, actorId, expectedRevision: 0, title: 'Signed', body: 'Untampered.' }, alice, 'post');
  const feed = await hub.getFeed(0, 100);
  const tampered = { ...feed, events: [{ ...feed.events[0]!, record: { ...feed.events[0]!.record, actorId: 'actor:forged:agent' } }, feed.events[0]!] } as typeof feed;
  const client = { publish: (input: Parameters<typeof hub.publish>[0], key: string) => hub.publish(input, alice, key), getFeed: async () => tampered };
  const replica = new PublicFederationReplica({ vaultPath: bobRoot, identity: { origin: 'company-b', agentId: 'bob' }, client, trustedHubPublicKey: hub.getPublicKey() });
  const result = await replica.pull(100);
  expect(result.cursor).toBe(0);
  expect(result.applied).toEqual([]);
  expect(result.errors[0]).toMatch(/signature|order|hash/i);
  await hub.close();
});

test('offline outbox is bounded and rejects idempotency-key reuse with another payload', async () => {
  const alice = { origin: 'company-a', agentId: 'alice' } as const;
  const actorId = makePublicActorId(alice.origin, alice.agentId);
  const offlineClient = {
    publish: async (): Promise<never> => { throw new Error('offline'); },
    getFeed: async (): Promise<never> => { throw new Error('offline'); },
  };
  const keyPairHub = new PublicFederationHub(hubRoot);
  const replica = new PublicFederationReplica({ vaultPath: aliceRoot, identity: alice, client: offlineClient, trustedHubPublicKey: keyPairHub.getPublicKey(), maxOutboxRecords: 1 });
  const first = { type: 'post', objectId: makePublicObjectId('post', alice.origin, alice.agentId, 'one'), actorId, expectedRevision: 0, title: 'One', body: 'First payload.' } as const;
  const different = { ...first, title: 'Different' };
  await expect(replica.publish(first, '')).rejects.toThrow('idempotency');
  expect((await replica.publish(first, 'same-key')).status).toBe('pending');
  expect((await replica.publish(first, 'same-key')).status).toBe('pending');
  await expect(replica.publish(different, 'same-key')).rejects.toThrow('idempotency');
  const second = { ...first, objectId: makePublicObjectId('post', alice.origin, alice.agentId, 'two') };
  await expect(replica.publish(second, 'second-key')).rejects.toThrow('outbox quota');
  await expect(readdir(join(aliceRoot, 'Community'))).rejects.toThrow();
  await keyPairHub.close();
});

test('hub bounds public payloads and signed feed pages', async () => {
  const identity = { origin: 'company-a', agentId: 'alice' } as const;
  const actorId = makePublicActorId(identity.origin, identity.agentId);
  const hub = new PublicFederationHub(hubRoot, { maxRecords: 2 });
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor');
  await expect(hub.publish({ type: 'post', objectId: makePublicObjectId('post', identity.origin, identity.agentId, 'oversized'), actorId, expectedRevision: 0, title: 'Large', body: 'x'.repeat(32 * 1024 + 1) }, identity, 'large')).rejects.toThrow(/at most|exceeds/i);
  await hub.publish({ type: 'post', objectId: makePublicObjectId('post', identity.origin, identity.agentId, 'bounded'), actorId, expectedRevision: 0, title: 'Bounded', body: 'Small.' }, identity, 'post');
  await expect(hub.publish({ type: 'post', objectId: makePublicObjectId('post', identity.origin, identity.agentId, 'quota'), actorId, expectedRevision: 0, title: 'Quota', body: 'Third.' }, identity, 'third')).rejects.toThrow('quota');
  const first = await hub.getFeed(0, 1);
  const second = await hub.getFeed(first.cursor, 1);
  expect(first.hasMore).toBe(true);
  expect(second.anchorHash).toBe(first.events[0]!.eventHash);
  expect(verifyPublicFederationFeed(first, hub.getPublicKey())).toBe(true);
  expect(verifyPublicFederationFeed(second, hub.getPublicKey())).toBe(true);
  await hub.close();
});

test('HTTP client supports public read-only feed access without a write credential', async () => {
  const identity = { origin: 'company-a', agentId: 'alice' } as const;
  const handle = await startPublicFederationHub(hubRoot, { credentials: { publisher: identity } });
  try {
    const writer = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'publisher' });
    const reader = new PublicFederationClient({ baseUrl: `http://${handle.host}:${handle.port}` });
    const actorId = makePublicActorId(identity.origin, identity.agentId);
    await writer.publish({ type: 'actor', actorId, expectedRevision: 0 }, 'actor');
    expect((await reader.getFeed()).events).toHaveLength(1);
    await expect(reader.publish({ type: 'actor', actorId, expectedRevision: 0 }, 'forbidden')).rejects.toThrow('write credential');
  } finally {
    await handle.close();
  }
});

test('outbox preserves dependent revision order across an offline restart', async () => {
  const identity = { origin: 'company-a', agentId: 'alice' } as const;
  const actorId = makePublicActorId(identity.origin, identity.agentId);
  const postId = makePublicObjectId('post', identity.origin, identity.agentId, 'ordered');
  const hub = new PublicFederationHub(hubRoot);
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor');
  let online = false;
  const transport = {
    publish: (input: Parameters<typeof hub.publish>[0], key: string) => online ? hub.publish(input, identity, key) : Promise.reject(new Error('offline')),
    getFeed: (after?: number, limit?: number) => hub.getFeed(after, limit),
  };
  let replica = new PublicFederationReplica({ vaultPath: aliceRoot, identity, client: transport, trustedHubPublicKey: hub.getPublicKey() });
  expect((await replica.publish({ type: 'post', objectId: postId, actorId, expectedRevision: 0, title: 'First', body: 'Initial.' }, 'create')).status).toBe('pending');
  expect((await replica.publish({ type: 'update', objectId: makePublicObjectId('update', identity.origin, identity.agentId, 'ordered-v2'), actorId, targetObjectId: postId, expectedRevision: 1, body: 'Second.' }, 'update')).status).toBe('pending');
  online = true;
  replica = new PublicFederationReplica({ vaultPath: aliceRoot, identity, client: transport, trustedHubPublicKey: hub.getPublicKey() });
  expect((await replica.flushOutbox()).published).toEqual([postId, postId]);
  expect((await hub.getFeed(0, 10)).events.map(event => event.record.type)).toEqual(['actor', 'post', 'update']);
  await hub.close();
});
