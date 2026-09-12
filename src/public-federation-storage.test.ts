import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { federationStorageName, readFederationFile, writeFederationFileAtomic, removeFederationFile } from './public-federation-storage.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';

const roots: string[] = [];

async function fixture(): Promise<{ root: string; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), 'public-federation-storage-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'public-federation-storage-outside-'));
  roots.push(root, outside);
  return { root, outside };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('atomically writes and boundedly reads a root-relative federation file', async () => {
  const { root } = await fixture();
  const target = 'PublicCommunity/Imported/acme/Posts/post.md';
  await writeFederationFileAtomic(root, target, '# public\n', { maxBytes: 32 });
  expect(await readFederationFile(root, join(root, target), { maxBytes: 32 })).toBe('# public\n');
  await writeFederationFileAtomic(root, target, '# revised\n', { maxBytes: 32 });
  expect(await readFederationFile(root, target, { maxBytes: 32 })).toBe('# revised\n');
  await expect(readFederationFile(root, target, { maxBytes: 4 })).rejects.toThrow(/size limit/i);
  await expect(writeFederationFileAtomic(root, 'oversized.md', '12345', { maxBytes: 4 })).rejects.toThrow(/size limit/i);
});

test('rejects lexical and canonical targets outside the trusted root', async () => {
  const { root, outside } = await fixture();
  await expect(writeFederationFileAtomic(root, '../escape.md', 'no', { maxBytes: 10 })).rejects.toThrow(/outside.*root/i);
  await expect(readFederationFile(root, join(outside, 'missing.md'), { maxBytes: 10 })).rejects.toThrow(/outside.*root/i);
});

test.each(['PublicCommunity', '.mcpvault'])('rejects an existing %s junction component for reads and writes', async component => {
  const { root, outside } = await fixture();
  const externalFile = join(outside, 'keep.md');
  await writeFile(externalFile, 'keep\n');
  await symlink(outside, join(root, component), 'junction');

  await expect(writeFederationFileAtomic(root, `${component}/changed.md`, 'changed\n', { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
  await expect(readFederationFile(root, `${component}/keep.md`, { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
  expect(await readFile(externalFile, 'utf8')).toBe('keep\n');
});

test('rejects a linked child beneath existing federation directories', async () => {
  const { root, outside } = await fixture();
  await mkdir(join(root, '.mcpvault'), { recursive: true });
  await symlink(outside, join(root, '.mcpvault', 'public-federation'), 'junction');
  await expect(writeFederationFileAtomic(root, '.mcpvault/public-federation/state.json', '{}\n', { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
});

test('storage names cannot collide when separators or long identifiers differ', () => {
  expect(federationStorageName('actor:a_b:c')).not.toBe(federationStorageName('actor:a:b_c'));
  expect(federationStorageName('a'.repeat(300) + 'x')).not.toBe(federationStorageName('a'.repeat(300) + 'y'));
  expect(federationStorageName('a'.repeat(512)).length).toBeLessThan(128);
});

test('host fencing rejects both final replacement and cleanup deletion', async () => {
  const { root } = await fixture();
  await writeFile(join(root, 'checkpoint.json'), 'original');
  const fence = async () => { throw new Error('writer fence changed'); };
  await expect(writeFederationFileAtomic(root, 'checkpoint.json', 'replacement', { maxBytes: 32, beforeCommit: fence })).rejects.toThrow(/fence/);
  expect(await readFile(join(root, 'checkpoint.json'), 'utf8')).toBe('original');
  await expect(removeFederationFile(root, 'checkpoint.json', fence)).rejects.toThrow(/fence/);
  expect(await readFile(join(root, 'checkpoint.json'), 'utf8')).toBe('original');
});

test('refreshes owner write authority again after temporary IO and immediately before commit', async () => {
  const { root } = await fixture();
  const target = 'journal/0000000001.md';
  let allowed = true; let refreshes = 0;
  await expect(withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh() {},
    canAccessPath: path => allowed && path === target,
    beforeWrite: async path => {
      expect(path).toBe(target);
      refreshes += 1;
      if (refreshes === 2) allowed = false;
    },
  }, () => writeFederationFileAtomic(root, target, 'must not commit', { maxBytes: 32, ownerPath: target })))
    .rejects.toThrow(/owner activity|authority/i);
  expect(refreshes).toBe(2);
  await expect(readFile(join(root, target), 'utf8')).rejects.toThrow();
});

test('final owner refresh cannot publish through a replaced journal directory', async () => {
  const { root, outside } = await fixture();
  const target = 'journal/event.md';
  await mkdir(join(root, 'journal'));
  await writeFile(join(root, target), 'original event');
  let refreshes = 0;
  let moved = false;
  await expect(withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh() {}, canAccessPath: () => true,
    beforeWrite: async () => {
      if (++refreshes !== 2) return;
      await rename(join(root, 'journal'), join(outside, 'moved-journal'));
      moved = true;
      await symlink(join(outside, 'moved-journal'), join(root, 'journal'), 'junction');
    },
  }, () => writeFederationFileAtomic(root, target, 'unauthorized replacement', { maxBytes: 64, ownerPath: target }))).rejects.toThrow();
  expect(refreshes).toBe(2);
  // Windows can reject the directory move while the writer holds its temp
  // handle. On platforms allowing it, final canonical validation must reject.
  expect(await readFile(moved ? join(outside, 'moved-journal', 'event.md') : join(root, target), 'utf8')).toBe('original event');
});

test('final host fence cannot redirect cleanup deletion through a replaced parent', async () => {
  const { root, outside } = await fixture();
  await mkdir(join(root, 'host'));
  await writeFile(join(root, 'host', 'prepared.md'), 'owned intent');
  await writeFile(join(outside, 'prepared.md'), 'foreign sentinel');
  await expect(removeFederationFile(root, 'host/prepared.md', async () => {
    await rename(join(root, 'host'), join(root, 'old-host'));
    await symlink(outside, join(root, 'host'), 'junction');
  })).rejects.toThrow();
  expect(await readFile(join(outside, 'prepared.md'), 'utf8')).toBe('foreign sentinel');
});
