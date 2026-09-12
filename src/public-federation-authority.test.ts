import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PublicFederationHub, makePublicActorId, makePublicObjectId } from './public-federation.js';
import { PublicFederationReplica } from './public-federation-replica.js';
import { federationStorageName } from './public-federation-storage.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { OwnerActivityPolicy } from './owner-activity.js';
import { OwnerActivityRuntime } from './owner-activity-runtime.js';

const roots: string[] = [];
const hubs: PublicFederationHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const principal = { accountId: 'reader', modelId: 'model', agentId: 'worker', role: 'agent' as const };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'federation-authority-')); roots.push(root);
  const hubRoot = await mkdtemp(join(tmpdir(), 'federation-authority-hub-')); roots.push(hubRoot);
  const hub = new PublicFederationHub(hubRoot), identity = { origin: 'remote', agentId: 'writer' };
  hubs.push(hub);
  const actorId = makePublicActorId(identity.origin, identity.agentId);
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor');
  const ids: string[] = [], paths: string[] = [];
  for (const name of ['a-hidden', 'b-visible', 'c-visible']) {
    const id = makePublicObjectId('post', identity.origin, identity.agentId, name); ids.push(id);
    paths.push(`PublicCommunity/Imported/remote/Posts/${federationStorageName(id)}.md`);
    await hub.publish({ type: 'post', objectId: id, actorId, expectedRevision: 0, title: name, body: `${name} body` }, identity, name);
  }
  const options = { vaultPath: root, identity: { origin: 'local', agentId: 'reader' },
    client: { getFeed: (after?: number, limit?: number) => hub.getFeed(after, limit),
      publish: async () => { throw new Error('No publish in read tests'); } }, trustedHubPublicKey: hub.getPublicKey() };
  const replica = new PublicFederationReplica(options);
  await replica.pull(100);
  return { root, hub, ids, paths, replica, reopen: (pathFilter?: PathFilter) => new PublicFederationReplica({ ...options, pathFilter } as any) };
}
async function scoped<T>(prefixes: string[], run: () => Promise<T>, access = new ScopeAccessPolicy()) {
  const policy = new OwnerActivityPolicy({ version: 1, owners: { reader: 'owner' }, grants: [{
    id: 'grant', ownerId: 'owner', accountIds: ['reader'], activities: ['collaboration'],
    actions: ['discover', 'read', 'execute'], dataPrefixes: prefixes, executionTargets: ['runtime'], expiresAt: '2999-01-01T00:00:00.000Z',
  }] });
  const runtime = new OwnerActivityRuntime({ policy: () => policy, execution: () => ({ accountId: 'reader', executionTarget: 'runtime' }) });
  const operation = await runtime.begin('collaboration', 'read', [], principal);
  return withEnterpriseStorageContext({ access, principal, assertFresh: operation.assertFresh,
    canAccessPath: operation.canAccessPath, canTraversePath: operation.canTraversePath, beforeWrite: operation.beforeWrite }, run);
}

test.each(['warm', 'cold'] as const)('%s replica cannot return a remote body or existence outside the original grant', async mode => {
  const f = await fixture(), replica = mode === 'warm' ? f.replica : f.reopen();
  await scoped(['Community/Posts/allowed.md'], async () => {
    expect(await replica.getObject(f.ids[0]!)).toBeUndefined();
    expect(await replica.listObjects({ type: 'post', limit: 1 })).toMatchObject({ objects: [], total: 0, truncated: false });
    await expect(replica.getImportedReadTarget(f.ids[0]!, 1)).rejects.toThrow(/unavailable|denied/i);
  });
});

test('exact allowed projection succeeds and hidden candidates never affect the visible limit or cursor', async () => {
  const f = await fixture();
  await scoped([f.paths[1]!, f.paths[2]!], async () => {
    expect((await f.replica.getObject(f.ids[1]!))?.record).toMatchObject({ body: 'b-visible body' });
    const first = await f.replica.listObjects({ type: 'post', limit: 1 });
    expect(first).toMatchObject({ total: 2, truncated: true, nextCursor: f.ids[1] });
    expect(first.objects.map(row => row.objectId)).toEqual([f.ids[1]]);
    const next = await f.replica.listObjects({ type: 'post', limit: 1, after: first.nextCursor });
    expect(next.objects.map(row => row.objectId)).toEqual([f.ids[2]]);
    await expect(f.replica.listObjects({ type: 'post', after: f.ids[0] })).rejects.toThrow(/cursor/i);
  });
});

test('owner-allowed projections still obey document revocation and PathFilter on a warm replica', async () => {
  const f = await fixture(); let confidential = false;
  const access = new ScopeAccessPolicy({ documentRules: () => confidential ? [{ path: f.paths[1]!, confidential: true }] : [] });
  await scoped(['PublicCommunity'], async () => {
    expect(await f.replica.getObject(f.ids[1]!)).toBeDefined();
    confidential = true;
    expect(await f.replica.getObject(f.ids[1]!)).toBeUndefined();
    expect(JSON.stringify(await f.replica.listObjects({ type: 'post' }))).not.toContain('b-visible');
  }, access);
  const filtered = f.reopen(new PathFilter({ ignoredPatterns: [f.paths[1]!] }));
  await scoped(['PublicCommunity'], async () => {
    expect(await filtered.getObject(f.ids[1]!)).toBeUndefined();
    expect(JSON.stringify(await filtered.listObjects({ type: 'post' }))).not.toContain('b-visible');
  });
});

test('request-driven reconciliation does not touch an unauthorized projection or report its identity', async () => {
  const f = await fixture(), original = await readFile(join(f.root, f.paths[0]!), 'utf8');
  await scoped([f.paths[1]!], async () => {
    const pulled = await f.replica.pull(100);
    expect(JSON.stringify(pulled)).not.toContain(f.ids[0]);
    expect(await f.replica.getObject(f.ids[0]!)).toBeUndefined();
  });
  expect(await readFile(join(f.root, f.paths[0]!), 'utf8')).toBe(original);
});

test('request-bound sync never exposes the global cursor or hidden-feed completion', async () => {
  const f = await fixture();
  expect(await f.replica.getCursor()).toBe(4);
  await scoped([f.paths[1]!], async () => {
    const before = await f.replica.pull(100);
    expect(before).toMatchObject({ progress: 'scoped' });
    expect(before).not.toHaveProperty('cursor');
    expect(before).not.toHaveProperty('hasMore');
    expect(await f.replica.getCursor()).toBeUndefined();
    await f.hub.publish({ type: 'post', objectId: 'post:remote:writer:new-hidden', actorId: 'actor:remote:writer',
      expectedRevision: 0, title: 'Secret activity', body: 'Not in grant' }, { origin: 'remote', agentId: 'writer' }, 'new-hidden');
    // The unrelated event changes neither exposed progress nor visible IDs.
    expect(await f.replica.pull(100)).toEqual(before);
  });
  expect(await f.replica.getCursor()).toBe(5);
});

test('an exact active-post grant cannot resurrect a tombstone when its marker path is outside the grant', async () => {
  const f = await fixture();
  await f.hub.publish({ type: 'tombstone', objectId: 'tombstone:remote:writer:remove', targetObjectId: f.ids[1]!,
    actorId: 'actor:remote:writer', expectedRevision: 1, reason: 'Author removal' }, { origin: 'remote', agentId: 'writer' }, 'remove');
  await scoped([f.paths[1]!], async () => {
    await f.replica.pull(100).catch(() => undefined);
    expect((await f.replica.getObject(f.ids[1]!))?.status).not.toBe('active');
    expect(JSON.stringify(await f.replica.listObjects({ type: 'post' }))).not.toContain('b-visible body');
  });
  await expect(readFile(join(f.root, f.paths[1]!))).rejects.toThrow(/ENOENT/);
  await scoped([f.paths[1]!], async () => expect((await f.reopen().getObject(f.ids[1]!))?.status).not.toBe('active'));
});
