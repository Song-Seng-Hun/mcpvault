import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readHostFile, writeHostFileAtomic, removeHostFile } from './host-storage.js';

const roots: string[] = [];

async function fixture(): Promise<{ root: string; outside: string }> {
  const root = await mkdtemp(join(tmpdir(), 'host-storage-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'host-storage-outside-'));
  roots.push(root, outside);
  return { root, outside };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('atomically writes and boundedly reads a root-relative federation file', async () => {
  const { root } = await fixture();
  const target = 'PublicCommunity/Imported/acme/Posts/post.md';
  await writeHostFileAtomic(root, target, '# public\n', { maxBytes: 32 });
  expect(await readHostFile(root, join(root, target), { maxBytes: 32 })).toBe('# public\n');
  await writeHostFileAtomic(root, target, '# revised\n', { maxBytes: 32 });
  expect(await readHostFile(root, target, { maxBytes: 32 })).toBe('# revised\n');
  await expect(readHostFile(root, target, { maxBytes: 4 })).rejects.toThrow(/size limit/i);
  await expect(writeHostFileAtomic(root, 'oversized.md', '12345', { maxBytes: 4 })).rejects.toThrow(/size limit/i);
});

test('rejects lexical and canonical targets outside the trusted root', async () => {
  const { root, outside } = await fixture();
  await expect(writeHostFileAtomic(root, '../escape.md', 'no', { maxBytes: 10 })).rejects.toThrow(/outside.*root/i);
  await expect(readHostFile(root, join(outside, 'missing.md'), { maxBytes: 10 })).rejects.toThrow(/outside.*root/i);
});

test.each(['PublicCommunity', '.mcpvault'])('rejects an existing %s junction component for reads and writes', async component => {
  const { root, outside } = await fixture();
  const externalFile = join(outside, 'keep.md');
  await writeFile(externalFile, 'keep\n');
  await symlink(outside, join(root, component), 'junction');

  await expect(writeHostFileAtomic(root, `${component}/changed.md`, 'changed\n', { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
  await expect(readHostFile(root, `${component}/keep.md`, { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
  expect(await readFile(externalFile, 'utf8')).toBe('keep\n');
});

test('rejects a linked child beneath existing federation directories', async () => {
  const { root, outside } = await fixture();
  await mkdir(join(root, '.mcpvault'), { recursive: true });
  await symlink(outside, join(root, '.mcpvault', 'public-federation'), 'junction');
  await expect(writeHostFileAtomic(root, '.mcpvault/public-federation/state.json', '{}\n', { maxBytes: 32 }))
    .rejects.toThrow(/symbolic link|junction/i);
});

test('host fencing rejects both final replacement and cleanup deletion', async () => {
  const { root } = await fixture();
  await writeFile(join(root, 'checkpoint.json'), 'original');
  const fence = async () => { throw new Error('writer fence changed'); };
  await expect(writeHostFileAtomic(root, 'checkpoint.json', 'replacement', { maxBytes: 32, beforeCommit: fence })).rejects.toThrow(/fence/);
  expect(await readFile(join(root, 'checkpoint.json'), 'utf8')).toBe('original');
  await expect(removeHostFile(root, 'checkpoint.json', fence)).rejects.toThrow(/fence/);
  expect(await readFile(join(root, 'checkpoint.json'), 'utf8')).toBe('original');
});

test('a commit fence cannot publish through a replaced journal directory', async () => {
  const { root, outside } = await fixture();
  const target = 'journal/event.md';
  await mkdir(join(root, 'journal'));
  await writeFile(join(root, target), 'original event');
  let moved = false;
  await expect(writeHostFileAtomic(root, target, 'unauthorized replacement', { maxBytes: 64, beforeCommit: async () => {
    await rename(join(root, 'journal'), join(outside, 'moved-journal'));
    moved = true;
    await symlink(join(outside, 'moved-journal'), join(root, 'journal'), 'junction');
  } })).rejects.toThrow();
  // Windows can reject the directory move while the writer holds its temp
  // handle. On platforms allowing it, final canonical validation must reject.
  expect(await readFile(moved ? join(outside, 'moved-journal', 'event.md') : join(root, target), 'utf8')).toBe('original event');
});

test('final host fence cannot redirect cleanup deletion through a replaced parent', async () => {
  const { root, outside } = await fixture();
  await mkdir(join(root, 'host'));
  await writeFile(join(root, 'host', 'prepared.md'), 'owned intent');
  await writeFile(join(outside, 'prepared.md'), 'foreign sentinel');
  await expect(removeHostFile(root, 'host/prepared.md', async () => {
    await rename(join(root, 'host'), join(root, 'old-host'));
    await symlink(outside, join(root, 'host'), 'junction');
  })).rejects.toThrow();
  expect(await readFile(join(outside, 'prepared.md'), 'utf8')).toBe('foreign sentinel');
});
