import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { parseDocumentStructure } from './document-structure.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

let root: string, cache: string, reader: DocumentResourceReader;
let host: Awaited<ReturnType<typeof derivedStorageFixture>>;
const indexes: DocumentIndex[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-document-index-'));
  host = await derivedStorageFixture(root); cache = host.host;
  reader = new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy());
});
afterEach(async () => { for (const index of indexes.splice(0)) await index.close(); await host.close(); await rm(root, { recursive: true, force: true }); });
function index(parse = vi.fn(parseDocumentStructure)) {
  const result = new DocumentIndex(reader, undefined, { cacheDir: cache, parse }); indexes.push(result); return { result, parse };
}

test('reuses a structure only for the current original revision', async () => {
  await writeFile(join(root, 'note.md'), '# Topic\n\nOld text');
  const { result, parse } = index();
  const old = await result.load('note.md');
  expect(old.structure.raw).toBe('# Topic\n\nOld text');
  expect((await result.load('note.md')).structure).toEqual(old.structure);
  expect(parse).toHaveBeenCalledTimes(1);
  await writeFile(join(root, 'note.md'), '# Topic\n\nNew text');
  const next = await result.load('note.md');
  expect(next.structure.revision).not.toBe(old.structure.revision);
  expect(next.structure.raw).toContain('New text');
  expect(parse).toHaveBeenCalledTimes(2);
  await expect(result.load('note.md', undefined, old.structure.revision)).rejects.toThrow(/stale|revision/i);
});

test('persists only local derived structure and rebuilds after cache loss', async () => {
  await writeFile(join(root, 'note.md'), '# Topic\n\nA fact.');
  const firstIndex = index().result, first = await firstIndex.load('note.md'); await firstIndex.close();
  const second = index();
  expect((await second.result.load('note.md')).structure).toEqual(first.structure);
  expect(second.parse).not.toHaveBeenCalled();
  for (const entry of await readdir(cache)) if (entry.endsWith('.structure.json.gz')) await rm(join(cache, entry), { force: true });
  const third = index();
  expect((await third.result.load('note.md')).structure).toEqual(first.structure);
  expect(third.parse).toHaveBeenCalledTimes(1);
}, 30000);

test('never lets a warm cache hide deletion or newly hidden moderation', async () => {
  await writeFile(join(root, 'note.md'), '# Visible');
  const { result } = index();
  await result.load('note.md');
  await writeFile(join(root, 'note.md'), '---\nmoderation_status: hidden\n---\n# Hidden');
  await expect(result.load('note.md')).rejects.toThrow(/unavailable/i);
  await rm(join(root, 'note.md'));
  await expect(result.load('note.md')).rejects.toThrow();
});

test('plain scripts are indexed as text rather than Markdown headings', async () => {
  await writeFile(join(root, 'run.sh'), '#!/bin/sh\necho test');
  const { structure } = await index().result.load('run.sh');
  expect(structure.raw).toBe('#!/bin/sh\necho test');
  expect(structure.fragments.some(f => f.kind === 'section')).toBe(false);
});

test('cache is not allowed inside the authoritative Vault', async () => {
  expect(() => new DocumentIndex(reader, undefined, { cacheDir: join(root, 'cache') })).toThrow(/outside|local|Vault/i);
  expect(() => new DocumentIndex(reader, undefined, { cacheDir: join(root, '..cache') })).toThrow(/outside|local|Vault/i);
});

test('count eviction removes only enough own cache files to meet the bound', async () => {
  await writeFile(join(root, 'note.md'), 'current');
  const names = Array.from({ length: 513 }, (_, n) => n.toString(16).padStart(64, '0') + '.structure.json.gz');
  await Promise.all(names.map(name => writeFile(join(cache, name), 'old')));
  const current = index().result; await current.load('note.md'); await current.close();
  expect((await readdir(cache)).filter(name => name.endsWith('.structure.json.gz'))).toHaveLength(512);
}, 30000);

test('unsupported binary parsing is explicit and leaves original bytes alone', async () => {
  await writeFile(join(root, 'image.png'), Buffer.from([0, 1, 2]));
  await expect(index().result.load('image.png')).rejects.toThrow(/unsupported|parser/i);
});

test('cache results cannot be mutated to poison later revision-checked reads', async () => {
  await writeFile(join(root, 'note.md'), '# Title\n\nOriginal');
  const { result } = index(), first = await result.load('note.md');
  expect(() => { first.structure.raw = 'poison'; }).toThrow();
  expect(() => { first.structure.fragments[0]!.children.push('forged'); }).toThrow();
  expect((await result.load('note.md')).structure.raw).toBe('# Title\n\nOriginal');
});

test('oversized repeated heading metadata skips disk serialization before allocating huge JSON', async () => {
  await writeFile(join(root, 'note.md'), '# ' + 'H'.repeat(16384) + '\n\n' + Array(1200).fill('small').join('\n\n'));
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    const loaded = await index().result.load('note.md');
    expect(loaded.structure.fragments.length).toBeGreaterThan(1200);
    expect(stringify.mock.calls.some(([value]) => value && typeof value === 'object' && ('structure' in value || 'fragments' in value))).toBe(false);
    expect((await readdir(cache)).filter(name => name.endsWith('.structure.json.gz'))).toEqual([]);
  } finally { stringify.mockRestore(); }
});
