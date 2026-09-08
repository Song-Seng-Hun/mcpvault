import { federationStorageName } from './public-federation-storage.js';
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicFederationHub, type PublicPublishInput } from './public-federation.js';
import { PublicFederationReplica } from './public-federation-replica.js';
const roots: string[] = [];
const hubs: PublicFederationHub[] = [];
afterEach(async () => { for (const hub of hubs.splice(0)) await hub.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'federation-hardening-')); roots.push(root);
  const vault = join(root, 'vault'); await mkdir(vault);
  const hub = new PublicFederationHub(join(root, 'hub')); hubs.push(hub);
  const identity = { origin: 'acme', agentId: 'network' };
  const actor: PublicPublishInput = { type: 'actor', actorId: 'actor:acme:network', expectedRevision: 0 };
  return { root, vault, hub, identity, actor };
}
test('forged or mismatched publish acknowledgements retain the durable outbox', async () => {
  const { vault, hub, identity, actor } = await setup();
  let tamper = true;
  const client = { getFeed: hub.getFeed.bind(hub), publish: async (input: PublicPublishInput, key: string) => {
    const event = await hub.publish(input, identity, key);
    return tamper ? { ...event, signature: 'forged' } : event;
  } };
  const replica = new PublicFederationReplica({ vaultPath: vault, identity, client, trustedHubPublicKey: hub.getPublicKey() });
  expect(await replica.publish(actor, 'actor')).toMatchObject({ status: 'pending', error: expect.stringMatching(/acknowledgement/) });
  expect(await readdir(join(vault, '.mcpvault/public-federation/outbox'))).toHaveLength(1);
  tamper = false;
  expect((await replica.flushOutbox()).published).toEqual([actor.actorId]);
  expect(await readdir(join(vault, '.mcpvault/public-federation/outbox'))).toHaveLength(0);
  expect((await hub.getFeed()).events).toHaveLength(1);
});
test('offline successors stay ordered and a failed predecessor stops the flush', async () => {
  const { vault, hub, identity, actor } = await setup();
  let offline = true;
  const sent: string[] = [];
  const client = { getFeed: hub.getFeed.bind(hub), publish: async (input: PublicPublishInput, key: string) => {
    sent.push(key); if (offline) throw new Error('offline'); return hub.publish(input, identity, key);
  } };
  const replica = new PublicFederationReplica({ vaultPath: vault, identity, client, trustedHubPublicKey: hub.getPublicKey() });
  await replica.publish(actor, 'actor');
  await replica.publish({ type: 'post', actorId: actor.actorId, expectedRevision: 0, objectId: 'post:acme:network:hello', title: 'Hello', body: 'body' }, 'post');
  expect(sent).toEqual(['actor']);
  expect((await replica.flushOutbox()).pending).toHaveLength(2);
  expect(sent).toEqual(['actor', 'actor']);
  offline = false;
  expect((await replica.flushOutbox()).published).toHaveLength(2);
  expect((await hub.getFeed()).events.map(event => event.record.type)).toEqual(['actor', 'post']);
});
test('corrupt state and junction sidecars fail closed without changing external files', async () => {
  const { root, vault, hub, identity, actor } = await setup();
  const client = { getFeed: hub.getFeed.bind(hub), publish: (input: PublicPublishInput, key: string) => hub.publish(input, identity, key) };
  const options = { vaultPath: vault, identity, client, trustedHubPublicKey: hub.getPublicKey() };
  const state = join(vault, '.mcpvault/public-federation/replica-state.json');
  await mkdir(join(vault, '.mcpvault/public-federation'), { recursive: true });
  await writeFile(state, '{corrupt');
  await expect(new PublicFederationReplica(options).pull()).rejects.toThrow();
  expect(await readFile(state, 'utf8')).toBe('{corrupt');
  const linkedVault = join(root, 'linked-vault'); await mkdir(linkedVault);
  const outside = join(root, 'outside'); await mkdir(outside);
  await symlink(outside, join(linkedVault, '.mcpvault'), 'junction');
  await expect(new PublicFederationReplica({ ...options, vaultPath: linkedVault }).publish(actor, 'actor')).rejects.toThrow(/junction/);
  expect(await readdir(outside)).toEqual([]);
});
test('unavailable diagnostic views and Markdown omit deleted content after restart', async () => {
  const { vault, hub, identity, actor } = await setup();
  await hub.publish(actor, identity, 'actor');
  await hub.publish({ type: 'post', actorId: actor.actorId, objectId: 'post:acme:network:secret', expectedRevision: 0, title: 'Removed title', body: 'Removed body' }, identity, 'post');
  await hub.publish({ type: 'tombstone', actorId: actor.actorId, objectId: 'tombstone:acme:network:delete', targetObjectId: 'post:acme:network:secret', expectedRevision: 1, reason: 'author deletion' }, identity, 'delete');
  const options = { vaultPath: vault, identity: { origin: 'other', agentId: 'reader' }, client: { getFeed: hub.getFeed.bind(hub), publish: (input: PublicPublishInput, key: string) => hub.publish(input, identity, key) }, trustedHubPublicKey: hub.getPublicKey() };
  await new PublicFederationReplica(options).pull(100);
  const restarted = new PublicFederationReplica(options);
  expect(await restarted.getObject('post:acme:network:secret')).toBeUndefined();
  const diagnostic = await restarted.getObject('post:acme:network:secret', { includeUnavailable: true });
  expect(JSON.stringify(diagnostic)).not.toMatch(/Removed (body|title)/);
  expect(await readFile(join(vault, `PublicCommunity/Imported/acme/Tombstones/${federationStorageName('post:acme:network:secret')}.md`), 'utf8')).not.toMatch(/Removed (body|title)/);
});
