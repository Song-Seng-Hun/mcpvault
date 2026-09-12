import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { SearchService } from './search.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { CollaborationService } from './scopes.js';
import { RetrievalService } from './retrieval-service.js';

let vault: string, search: SearchService, fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService;
let snapshotHost: Awaited<ReturnType<typeof derivedStorageFixture>> | undefined;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-fiction-search-'));
  search = new SearchService(vault, new PathFilter()); fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => ({ results: [], available: false, indexed: 0, pending: 0 }) }, access, fs);
});
afterEach(async () => {
  await search.close(); vi.restoreAllMocks();
  await snapshotHost?.close(); snapshotHost = undefined;
  const target = await realpath(vault), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-fiction-search-')) throw Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(path: string, raw: string) { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), raw); }

test('indexed fiction is excluded before ranking and text hydration, not after the top K', async () => {
  for (let i = 0; i < 22; i++) await seed(`Knowledge/Fiction${i}.md`, '---\nfiction_domain: roleplay\n---\nfictionneedle');
  await seed('Legacy.md', 'fictionneedle real condition');
  const load = vi.spyOn(search as any, 'loadText');
  const result = await search.search({ query: 'fictionneedle', fictionDomain: 'exclude', limit: 1 } as any);
  expect(result.map(hit => hit.p)).toEqual(['Legacy.md']);
  expect(load.mock.calls.map(([document]) => (document as any).relativePath)).toEqual(['Legacy.md']);
});

test('only fiction uses canonical markers, managed Story paths and the existing access predicate', async () => {
  await seed('Community/Stories/book/Exports/raw.md', 'fictionneedle manuscript');
  await seed('Turn.md', '---\nmcpvault_type: roleplay_turn\n---\nfictionneedle turn');
  await seed('Marked.md', '\ufeff---json\n{"fiction_domain":["roleplay"]}\n---\nfictionneedle marked');
  await seed('Real.md', 'fictionneedle actual');
  await seed('_scopes/agents/other/Hidden.md', '---\nfiction_domain: roleplay\n---\nfictionneedle private');
  const result = await search.search({ query: 'fictionneedle', fictionDomain: 'only', limit: 20, canAccessPath: p => !p.startsWith('_scopes/') } as any);
  expect(result.map(hit => hit.p).sort()).toEqual(['Community/Stories/book/Exports/raw.md', 'Marked.md', 'Turn.md']);
});

test('fiction classification persists without cached text and old version seven snapshots rebuild', async () => {
  await search.close(); snapshotHost = await derivedStorageFixture(vault);
  search = new SearchService(vault, new PathFilter(), undefined, undefined, snapshotHost.host);
  await seed('Fiction.md', '---\nfiction_domain: roleplay\n---\nfictionneedle');
  await seed('Real.md', 'fictionneedle real');
  await search.search({ query: 'fictionneedle' });
  await (search as any).flushSnapshot();
  const snapshotPath = snapshotHost.path('search-index.snapshot.bin');
  const snapshot = await readFile(snapshotPath);
  await search.close();
  search = new SearchService(vault, new PathFilter(), undefined, undefined, snapshotHost.host);
  await (search as any).snapshotReady;
  const load = vi.spyOn(search as any, 'loadText');
  expect((await search.search({ query: 'fictionneedle', fictionDomain: 'exclude' } as any)).map(hit => hit.p)).toEqual(['Real.md']);
  expect(load.mock.calls.map(([document]) => (document as any).relativePath)).not.toContain('Fiction.md');
  await search.close();
  snapshot.writeUInt32LE(7, 8); // A pre-classification cache is unknown, never nonfiction.
  await writeFile(snapshotPath, snapshot);
  search = new SearchService(vault, new PathFilter(), undefined, undefined, snapshotHost.host);
  await (search as any).snapshotReady;
  expect((search as any).documents.size).toBe(0);
  expect((await search.search({ query: 'fictionneedle', fictionDomain: 'exclude' } as any)).map(hit => hit.p)).toEqual(['Real.md']);
}, 30000);

test('a text load rechecks classification changed since the indexed generation', async () => {
  await seed('Changing.md', 'fictionneedle originally real');
  await search.search({ query: 'fictionneedle' });
  // Freeze index delivery, then evict only text as the ordinary cache does.
  await search.close();
  vi.spyOn(search as any, 'ensureIndex').mockResolvedValue(undefined);
  const document = (search as any).documents.get('Changing.md');
  delete document.body; delete document.frontmatterText; delete document.frontmatter;
  await seed('Changing.md', '---\nfiction_domain: roleplay\n---\nfictionneedle now fiction');
  expect(await search.search({ query: 'fictionneedle', fictionDomain: 'exclude', canAccessPath: () => true } as any)).toEqual([]);
});

test('filtered retrieval does not enumerate a 10001-row advisory metadata inventory', async () => {
  await seed('Real.md', 'fictionneedle real');
  // Reproduce the old full-inventory ceiling without creating unrelated files.
  // The selected note, lexical index and final metadata read remain real.
  let offset = 0;
  const inventory = vi.spyOn(fs, 'queryNotes').mockImplementation(async () => {
    const count = Math.min(500, 10001 - offset); offset += count;
    return { notes: Array.from({ length: count }, (_, i) => ({ path: `Advisory/${offset - count + i}.md`, frontmatter: {} })),
      truncated: offset < 10001, nextCursor: { path: String(offset) } } as any;
  });
  const metadata = vi.spyOn(fs, 'readNoteMetadata');
  const result = await retrieval.searchNotes({ query: 'fictionneedle', fictionDomain: 'exclude' });
  expect(result.map(hit => hit.p)).toEqual(['Real.md']);
  expect(inventory).not.toHaveBeenCalled();
  expect(metadata.mock.calls.flatMap(([paths]) => paths)).toEqual(['Real.md']);
  expect(result[0]).not.toHaveProperty('rv');
});

test.each(['classification', 'revision', 'revocation'] as const)('selected retrieval rejects current %s drift after index discovery', async mode => {
  await seed('Real.md', 'fictionneedle ORIGINAL');
  const lexical = search.search.bind(search);
  vi.spyOn(search, 'search').mockImplementation(async params => {
    const hits = await lexical(params);
    if (hits.length) {
      if (mode === 'classification') await seed('Real.md', '---\nfiction_domain: roleplay\n---\nfictionneedle FICTION');
      if (mode === 'revision') await seed('Real.md', 'fictionneedle CHANGED');
      if (mode === 'revocation') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
    }
    return hits;
  });
  const result = retrieval.searchNotes({ query: 'fictionneedle', pathPrefix: '.', fictionDomain: 'exclude', includeRevisions: true });
  if (mode === 'revocation') await expect(result).rejects.toThrow(/unavailable|access changed/i);
  else expect(await result).toEqual([]);
});

test('Skill projections cannot replace a nonfiction match with a fiction excerpt', async () => {
  await seed('Real.md', 'fictionneedle actual');
  await seed('Candidate.md', '---\nfiction_domain: roleplay\n---\nfictionneedle FICTION');
  const candidate = await fs.readNote('Candidate.md');
  retrieval.attachSkillEvolution({ discoveryAllowed: () => true, projectDiscovery: async () => [{ p: 'Candidate.md', t: 'Candidate', ex: 'FICTION', mc: 1, rv: candidate.revision }] });
  expect(await retrieval.searchNotes({ query: 'fictionneedle', fictionDomain: 'exclude' })).toEqual([]);
});

test('scoped fiction-only retrieval retains revision and cannot expose another agent scope', async () => {
  await seed('_scopes/models/codex/Story.md', '---\nfiction_domain: roleplay\n---\nfictionneedle model');
  await seed('_scopes/agents/other/Secret.md', '---\nfiction_domain: roleplay\n---\nfictionneedle PRIVATE');
  await seed('Real.md', 'fictionneedle real');
  const result = await retrieval.searchNotes({ query: 'fictionneedle', fictionDomain: 'only', includeRevisions: true,
    principal: { accountId: 'worker', modelId: 'codex', role: 'model' } });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ p: 'Story.md', physicalPath: '_scopes/models/codex/Story.md', rv: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test.each(['exclude', 'only'] as const)('context expansion preserves the %s admission revision even without requested revisions', async fictionDomain => {
  const before = fictionDomain === 'only' ? '---\nfiction_domain: roleplay\n---\nfictionneedle before' : 'fictionneedle before';
  const after = fictionDomain === 'exclude' ? '---\nfiction_domain: roleplay\n---\nfictionneedle AFTER' : 'fictionneedle AFTER';
  await seed('Changing.md', before);
  const retrieve = retrieval.retrieve.bind(retrieval);
  vi.spyOn(retrieval, 'retrieve').mockImplementation(async (...args) => {
    const result = await retrieve(...args);
    await seed('Changing.md', after);
    return result;
  });
  expect(await retrieval.searchNotes({ query: 'fictionneedle', fictionDomain, excerptMode: 'context' })).toEqual([]);
});

test('context expansion rechecks caller admission after the final revision read', async () => {
  await seed('Real.md', 'fictionneedle private after revocation');
  let allowed = true, expanding = false;
  const retrieve = retrieval.retrieve.bind(retrieval), revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(retrieval, 'retrieve').mockImplementation(async (...args) => {
    const result = await retrieve(...args); expanding = true; return result;
  });
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const value = await revision(...args); if (expanding) allowed = false; return value;
  });
  await expect(retrieval.searchNotes({ query: 'fictionneedle', fictionDomain: 'exclude', excerptMode: 'context', canAccessPath: () => allowed })).rejects.toThrow(/changed|unavailable/i);
});

test('a later selected revision read cannot revoke an earlier hit without final admission revalidation', async () => {
  await seed('A.md', 'fictionneedle first'); await seed('B.md', 'fictionneedle second');
  let firstAllowed = true;
  const revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const value = await revision(...args); if (args[0] === 'B.md') firstAllowed = false; return value;
  });
  await expect(retrieval.searchNotes({ query: 'fictionneedle', fictionDomain: 'exclude', canAccessPath: path => path !== 'A.md' || firstAllowed })).rejects.toThrow(/changed|unavailable/i);
});
