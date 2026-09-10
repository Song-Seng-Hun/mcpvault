import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PublicFederationHub } from './public-federation.js';
import { PublicFederationReplica } from './public-federation-replica.js';
import * as storage from './public-federation-storage.js';

const faults = vi.hoisted(() => ({ renameTarget: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, rename: async (...args: Parameters<typeof real.rename>) => {
    if (String(args[1]) === faults.renameTarget) throw Object.assign(Error('injected rename failure'), { code: 'EIO' });
    return real.rename(...args);
  } };
});

let root: string, vault: string, hub: PublicFederationHub, replica: PublicFederationReplica;
const identity = { origin: 'remote', agentId: 'author' }, actorId = 'actor:remote:author';
const post = 'post:remote:author:note', comment = 'comment:remote:author:reply';
const location = (category: string, id: string) => join(vault, 'PublicCommunity/Imported/remote', category, `${storage.federationStorageName(id)}.md`);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-reconcile-')); vault = join(root, 'vault'); await mkdir(vault);
  hub = new PublicFederationHub(join(root, 'hub'));
  replica = new PublicFederationReplica({ vaultPath: vault, identity: { origin: 'local', agentId: 'reader' }, trustedHubPublicKey: hub.getPublicKey(),
    client: { getFeed: hub.getFeed.bind(hub), publish: (input, key) => hub.publish(input, identity, key) } });
  await hub.publish({ type: 'actor', actorId, expectedRevision: 0 }, identity, 'actor');
});
afterEach(async () => {
  faults.renameTarget = ''; vi.restoreAllMocks(); await hub.close();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-reconcile-')) throw Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(parent = true) {
  if (parent) await hub.publish({ type: 'post', objectId: post, actorId, expectedRevision: 0, title: 'Note', body: 'Original post body' }, identity, 'post');
  await hub.publish({ type: 'comment', objectId: comment, actorId, expectedRevision: 0, postId: post, body: 'Original child body' }, identity, 'comment');
  await replica.pull(100);
}
async function update() {
  await hub.publish({ type: 'update', objectId: 'update:remote:author:edit', targetObjectId: post, actorId, expectedRevision: 1, body: 'Updated post body' }, identity, 'update');
}
function writes() {
  const spy = vi.spyOn(replica as any, 'writeAtomic');
  return { spy, imported: () => spy.mock.calls.filter(([path]) => String(path).includes(`${sep}Imported${sep}`)).map(([path]) => path) };
}

test('identical pulls perform zero imported writes and never unlink the existing target', async () => {
  await seed(); const log = writes(), removals = vi.spyOn(storage, 'removeFederationFile');
  const before = await readFile(location('Posts', post), 'utf8');
  const result = await replica.pull(100);
  expect(result.applied).toEqual([]); expect(log.imported()).toEqual([]);
  expect(removals.mock.calls.some(([, path]) => path === location('Posts', post))).toBe(false);
  expect(await readFile(location('Posts', post), 'utf8')).toBe(before);
});

test('a changed active target is replaced once while its old bytes remain present until replacement', async () => {
  await seed(); await update(); const original = (replica as any).writeAtomic.bind(replica);
  const log = writes(); log.spy.mockImplementation(async (path: any, content: any) => {
    if (path === location('Posts', post)) expect(await readFile(path, 'utf8')).toContain('Original post body');
    return original(path, content);
  });
  await replica.pull(100);
  expect(log.imported()).toEqual([location('Posts', post)]);
  expect(await readFile(location('Posts', post), 'utf8')).toContain('Updated post body');
});

test('failed replacement preserves old active bytes and the verified cursor for a successful retry', async () => {
  await seed(); const cursor = await replica.getCursor(), before = await readFile(location('Posts', post), 'utf8'); await update();
  const original = (replica as any).writeAtomic.bind(replica);
  const spy = vi.spyOn(replica as any, 'writeAtomic').mockImplementation(async (path: any, content: any) => {
    if (path === location('Posts', post)) throw Error('injected replacement failure');
    return original(path, content);
  });
  await expect(replica.pull(100)).rejects.toThrow('injected replacement failure');
  expect(await replica.getCursor()).toBe(cursor);
  expect(await readFile(location('Posts', post), 'utf8')).toBe(before);
  spy.mockRestore(); await replica.pull(100);
  expect(await readFile(location('Posts', post), 'utf8')).toContain('Updated post body');
});

test('an empty feed repairs only a missing projection and cleans obsolete duplicates without rewriting the correct target', async () => {
  await seed(); await rm(location('Comments', comment));
  const duplicate = location('Pending', post); await mkdir(dirname(duplicate), { recursive: true }); await writeFile(duplicate, 'stale category duplicate');
  const log = writes(); await replica.pull(100);
  expect(log.imported()).toEqual([location('Comments', comment)]);
  await expect(readFile(duplicate)).rejects.toMatchObject({ code: 'ENOENT' });
  log.spy.mockClear(); await replica.pull(100); expect(log.imported()).toEqual([]);
});

test('a storage rename failure keeps the old destination, removes its temporary file and permits retry', async () => {
  await seed(); const target = location('Posts', post), before = await readFile(target, 'utf8'), cursor = await replica.getCursor();
  await update(); faults.renameTarget = target;
  await expect(replica.pull(100)).rejects.toMatchObject({ code: 'EIO' });
  expect(await readFile(target, 'utf8')).toBe(before);
  expect((await readdir(dirname(target))).some(name => name.endsWith('.tmp'))).toBe(false);
  expect(await replica.getCursor()).toBe(cursor);
  faults.renameTarget = ''; await replica.pull(100);
  expect(await readFile(target, 'utf8')).toContain('Updated post body');
});

test('a newly arriving parent activates its unchanged child and removes only the obsolete pending category', async () => {
  await seed(false); const childRevision = (await replica.getObject(comment, { includeUnavailable: true }))!.revision;
  await hub.publish({ type: 'post', objectId: post, actorId, expectedRevision: 0, title: 'Arrived', body: 'Parent arrived' }, identity, 'post');
  await replica.pull(100);
  expect(await replica.getObject(comment)).toMatchObject({ status: 'active', revision: childRevision });
  expect(await readFile(location('Comments', comment), 'utf8')).toContain('Original child body');
  await expect(readFile(location('Pending', comment))).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['hide', 'tombstone'] as const)('all affected public copies disappear before a %s marker write can fail', async mode => {
  await seed(); const category = mode === 'hide' ? 'Moderated' : 'Tombstones';
  if (mode === 'hide') await hub.moderate({ objectId: post, action: 'hide', expectedRevision: 0, reason: 'Public policy' }, { origin: 'ops', agentId: 'moderator', role: 'moderator' }, 'hide');
  else await hub.publish({ type: 'tombstone', objectId: 'tombstone:remote:author:delete', targetObjectId: post, actorId, expectedRevision: 1, reason: 'Author removal' }, identity, 'delete');
  const original = (replica as any).writeAtomic.bind(replica);
  const spy = vi.spyOn(replica as any, 'writeAtomic').mockImplementation(async (path: any, content: any) => {
    if (path === location(category, post)) throw Error('injected marker failure');
    return original(path, content);
  });
  await expect(replica.pull(100)).rejects.toThrow('injected marker failure');
  for (const path of [location('Posts', post), location('Comments', comment)]) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  spy.mockRestore(); await replica.pull(100);
  expect(await readFile(location(category, post), 'utf8')).not.toContain('Original post body');
  expect(await readFile(location('Pending', comment), 'utf8')).not.toContain('Original child body');
});

test('a denied projection read is not treated as a missing file or overwritten', async () => {
  await seed(); const before = await readFile(location('Posts', post), 'utf8');
  const read = storage.readFederationFile;
  vi.spyOn(storage, 'readFederationFile').mockImplementation(async (...args) => {
    if (args[1] === location('Posts', post)) throw Object.assign(Error('fixture denied'), { code: 'EACCES' });
    return read(...args);
  });
  await expect(replica.pull(100)).rejects.toMatchObject({ code: 'EACCES' });
  expect(await readFile(location('Posts', post), 'utf8')).toBe(before);
});
