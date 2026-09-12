import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { PathFilter } from './pathfilter.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'original-preservation-')); fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test.each(['_sources/raw.md', 'Community/_sources/raw.md', '_scopes/agents/alice/_sources/raw.md', '_scopes/models/gpt/_sources/raw.md'])('filesystem refuses replacement, deletion and relocation of original %s', async path => {
  const original = Buffer.from('# Original\r\n\r\nKeep every byte.');
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), original);
  await expect(fs.writeNote({ path, content: 'replace', expectedRevision: sha(original) })).rejects.toThrow(/immutable|original/i);
  await expect(fs.writeNote({ path, content: 'append', mode: 'append' })).rejects.toThrow(/immutable|original/i);
  await expect(fs.deleteNote({ path, confirmPath: path })).rejects.toThrow(/immutable|original/i);
  await expect(fs.moveNote({ oldPath: path, newPath: 'Moved.md' })).rejects.toThrow(/immutable|original/i);
  expect(await readFile(join(root, path))).toEqual(original);
});

test('public source mutation checks include Community and Windows aliases', () => {
  for (const path of ['Community/_sources/a.md', 'Community\\_sources\\a.md', '_sources./a.md', '_scopes/users/alice/SharedMemory/_sources/a.md']) {
    expect(() => access.assertMutationAllowed(path, 'edit')).toThrow(/immutable|original/i);
  }
});

test('capture preserves the original separately from the existing Markdown source projection', async () => {
  const input = '\uFEFF---\r\ntitle: Original metadata\r\n---\r\n# 原本\r\n\r\nExact file, no final newline.';
  const result = await wiki.ingestSource({ scopeRoot: '', sourceId: 'lossless', title: 'Captured title', content: input, capturedBy: 'tester' });
  const note = await fs.readNote(result.path);
  expect(note.frontmatter.original_path).toBe('_sources/lossless/original.txt');
  expect(note.frontmatter.original_sha256).toBe(sha(input));
  expect(await readFile(join(root, note.frontmatter.original_path))).toEqual(Buffer.from(input));
  const retry = await wiki.ingestSource({ scopeRoot: '', sourceId: 'lossless', title: 'Captured title', content: input, capturedBy: 'tester' });
  expect(retry.created).toBe(false);
  // Equal parsed text must not silently replace a different original file.
  await expect(wiki.ingestSource({ scopeRoot: '', sourceId: 'lossless', title: 'Captured title', content: input.replace(/\r\n/g, '\n'), capturedBy: 'tester' })).rejects.toThrow(/original|different|immutable/i);
});

test('successful parsing, parser failure and cache disposal cannot split or modify the original', async () => {
  const path = '_sources/preserved/original.txt', original = Buffer.from('# One\r\n\r\nKeep.\r\n\r\n# Two\r\n\r\nKeep too.');
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), original);
  const reader = new DocumentResourceReader(fs, new PathFilter(), access);
  const index = new DocumentIndex(reader);
  await index.load(path); index.invalidate(path); await index.load(path); index.close();
  const failed = new DocumentIndex(reader, undefined, { parse: () => { throw Error('parser failed'); } });
  await expect(failed.load(path)).rejects.toThrow('parser failed'); failed.close();
  expect(await readFile(join(root, path))).toEqual(original);
});

test('ordinary Wiki knowledge remains editable independently of immutable originals', async () => {
  await fs.writeNote({ path: 'Knowledge.md', content: 'Draft', expectedRevision: 'missing' });
  await fs.writeNote({ path: 'Knowledge.md', content: 'Improved', expectedRevision: (await fs.readNote('Knowledge.md')).revision });
  expect((await fs.readNote('Knowledge.md')).content).toBe('Improved');
});

test('binary capture owns its input bytes across asynchronous preparation', async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 0, 128]); const expected = Buffer.from(bytes);
  const pending = fs.preserveOriginal('_sources/binary/original.pdf', bytes);
  bytes.fill(42);
  const receipt = await pending;
  expect(await readFile(join(root, receipt.path))).toEqual(expected);
  expect(receipt.sha256).toBe(sha(expected));
});
