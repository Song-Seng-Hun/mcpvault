import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { federationStorageName, readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';

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
