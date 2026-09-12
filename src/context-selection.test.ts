import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { CollaborationService } from './scopes.js';
import { RetrievalService } from './retrieval-service.js';
import { selectSituationCandidates } from './context-selection.js';
import { VaultMetadataIndex } from './vault-index.js';
import { FrontmatterHandler } from './frontmatter.js';
import { derivedCacheBudget } from './cache-budget.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, retrieval: RetrievalService, fixtureSearch: SearchService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'context-quota-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  fixtureSearch = new SearchService(root, new PathFilter());
  retrieval = new RetrievalService(fixtureSearch, new CollaborationService(fs, fixtureSearch), undefined, access, fs);
});
afterEach(async () => { vi.restoreAllMocks(); await fixtureSearch.close(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, body: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body);
}
const select = () => selectSituationCandidates(fs, access, retrieval, 'watcher', { context: 'NAS', intent: 'execute', explain: true });

test('lexical posting lookup checks admission only for matching candidates', async () => {
  for (let i = 0; i < 40; i++) await note(`Knowledge/A${i}.md`, i === 0 ? 'watcher' : 'unrelated ordinary');
  const search = new SearchService(root, new PathFilter());
  try {
    const canAccessPath = vi.fn(() => true);
    const result = await search.memoryCandidates({ query: 'watcher', limit: 12, canAccessPath });
    expect(result.results.map(hit => hit.p)).toEqual(['Knowledge/A0.md']);
    expect(canAccessPath.mock.calls.length).toBeLessThan(5);
  } finally { await search.close(); }
});

test.each([0, 1, 2, 3])('reserves at most two of twelve slots for %i condition-only candidates', async count => {
  for (let i = 0; i < 12; i++) await note(`Knowledge/A${String(i).padStart(2, '0')}.md`, '---\nnote_kind: atomic\n---\nwatcher regular');
  for (let i = 0; i < count; i++) await note(`Knowledge/Z${i}.md`, '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS]\n---\nSpecific reconnect prerequisite.');
  await note('_scopes/agents/other/Hidden.md', '---\ncontext_rules:\n  all: [NAS]\n---\nHIDDEN_CANARY');
  await note('Knowledge/Unmatched.md', '---\ncontext_rules:\n  all: [OTHER]\n---\nwatcher');
  const reads = vi.spyOn(fs, 'readNote');
  const result = await select();
  expect(result.results).toHaveLength(12);
  const paths = result.results.map(h => h.p);
  expect(paths.filter(p => p?.startsWith('Knowledge/Z'))).toHaveLength(Math.min(count, 2));
  expect(paths.filter(p => p?.startsWith('Knowledge/A'))).toHaveLength(12 - Math.min(count, 2));
  expect(new Set(paths).size).toBe(12);
  expect(JSON.stringify(result)).not.toMatch(/Hidden|HIDDEN_CANARY/);
  expect(paths).not.toContain('Knowledge/Unmatched.md');
  expect(reads).not.toHaveBeenCalled();
});

test('already retrieved activation is not duplicated and sparse windows remain usable', async () => {
  await note('Knowledge/A.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS]\n---\nwatcher active');
  await note('Knowledge/B.md', '---\nnote_kind: atomic\n---\nwatcher ordinary');
  const result = await select();
  expect(result.results.map(h => h.p).sort()).toEqual(['Knowledge/A.md', 'Knowledge/B.md']);
});

test('warm indexed situation selection does not enumerate unrelated frontmatter rows', async () => {
  for (let start = 0; start < 250; start += 25) await Promise.all(Array.from({ length: 25 }, (_, i) => {
    const n = start + i;
    return note(`Knowledge/A${String(n).padStart(3, '0')}.md`, `---\nnote_kind: atomic\n---\n${n < 16 ? 'watcher' : 'unrelated'} ordinary`);
  }));
  await note('Knowledge/Z.md', '---\ncontext_rules:\n  all: [NAS]\n  exclude: [remote]\n  intents: [execute]\n---\nSpecific prerequisite');
  const filter = new PathFilter(), metadata = new VaultMetadataIndex(root, filter, new FrontmatterHandler());
  const indexedFs = new FileSystemService(root, filter, undefined, undefined, metadata);
  const search = new SearchService(root, filter);
  const indexedRetrieval = new RetrievalService(search, new CollaborationService(indexedFs, search), undefined, access, indexedFs);
  try {
    await metadata.list();
    await indexedRetrieval.memoryCandidates({ query: 'watcher', limit: 12, canAccessPath: () => true });
    let frontmatterReads = 0;
    for (const entry of (metadata as any).entries.values()) {
      const frontmatter = entry.frontmatter;
      Object.defineProperty(entry, 'frontmatter', { configurable: true, get() { frontmatterReads++; return frontmatter; } });
    }
    const enumerate = vi.spyOn(indexedFs, 'queryNotes');
    const result = await selectSituationCandidates(indexedFs, access, indexedRetrieval, 'watcher', { context: 'NAS', intent: 'execute', explain: true });
    expect(result.results).toHaveLength(12);
    expect(result.results.map(hit => hit.p)).toContain('Knowledge/Z.md');
    expect(enumerate).not.toHaveBeenCalled();
    expect(frontmatterReads).toBeLessThan(20);
  } finally { await metadata.close(); await search.close(); }
}, 30000);

test('indexed conditions preserve fallback admission and notice later metadata or ACL changes', async () => {
  const bodies: Record<string, string> = {
    'Ordinary.md': 'watcher ordinary',
    'Match.md': '---\ncontext_rules:\n  any: [ＮＡＳ, alternative]\n  all: [watcher]\n  exclude: [remote]\n  intents: [execute]\n---\nprerequisite',
    'NoTrigger.md': '---\ncontext_rules:\n  exclude: [remote]\n---\nwatcher excluded remotely',
    'Unmatched.md': '---\ncontext_rules:\n  all: [OTHER]\n---\nwatcher',
    'Invalid.md': '---\ncontext_rules:\n  script: DO_NOT_EXECUTE\n---\nwatcher',
    'Hidden.md': '---\nmoderation_status: hidden\n---\nwatcher',
    'Memory.md': '---\nmemory_role: core\n---\nwatcher',
    'Fiction.md': '---\nfiction_domain: roleplay\n---\nwatcher',
    'Managed.md': '---\nmcpvault_type: work\n---\nwatcher',
    '_scopes/agents/other/Private.md': 'watcher',
  };
  for (const [path, body] of Object.entries(bodies)) await note(path, body);
  const filter = new PathFilter(), metadata = new VaultMetadataIndex(root, filter, new FrontmatterHandler());
  const indexedFs = new FileSystemService(root, filter, undefined, undefined, metadata);
  const search = new SearchService(root, filter);
  const indexedRetrieval = new RetrievalService(search, new CollaborationService(indexedFs, search), undefined, access, indexedFs);
  try {
    for (const context of ['NAS', 'NAS remote']) {
      const options = { context, intent: 'execute' as const, explain: true };
      const expected = await selectSituationCandidates(fs, access, retrieval, 'watcher', options);
      const actual = await selectSituationCandidates(indexedFs, access, indexedRetrieval, 'watcher', options);
      expect(actual.results.map(h => h.p).sort()).toEqual(expected.results.map(h => h.p).sort());
      expect(actual.diagnostics.some(d => d.reason === 'invalid_context_rules')).toBe(true);
      expect(JSON.stringify(actual)).not.toMatch(/Private|DO_NOT_EXECUTE/);
    }
    let allowed = true;
    const prepared = (await indexedFs.prepareSituation('watcher NAS', 'execute', true, () => allowed))!;
    expect(prepared.canSelect('Ordinary.md')).toBe(true);
    allowed = false;
    expect(prepared.canSelect('Ordinary.md')).toBe(false);
    allowed = true;
    await note('Ordinary.md', '---\ncontext_rules:\n  all: [OTHER]\n---\nwatcher');
    metadata.invalidate('Ordinary.md', 'upsert'); search.invalidate('Ordinary.md');
    expect(() => prepared.assertFresh()).toThrow(/changed/i);
    const refreshed = (await indexedFs.prepareSituation('watcher NAS', 'execute', true, () => allowed))!;
    expect(refreshed.canSelect('Ordinary.md')).toBe(false);
  } finally { await metadata.close(); await search.close(); }
}, 30000);

test('literal dotted property names do not create explicit condition activations', async () => {
  await note('Fake.md', '---\n"context_rules.any": [NAS]\n---\nUnrelated prose');
  await note('Real.md', 'watcher ordinary');
  const filter = new PathFilter(), metadata = new VaultMetadataIndex(root, filter, new FrontmatterHandler());
  const indexedFs = new FileSystemService(root, filter, undefined, undefined, metadata);
  try {
    const result = await selectSituationCandidates(indexedFs, access, retrieval, 'watcher', { context: 'NAS', intent: 'execute', explain: true });
    expect(result.results.map(h => h.p)).toEqual(['Real.md']);
    expect(result.activatedPaths).toEqual([]);
  } finally { await metadata.close(); }
});

test.each(['missing', 'stale', 'rehydrated'] as const)('indexed situation cannot report lexical exhaustion with %s postings', async mode => {
  await note('A.md', 'oldneedle ordinary');
  const filter = new PathFilter(), metadata = new VaultMetadataIndex(root, filter, new FrontmatterHandler());
  const indexedFs = new FileSystemService(root, filter, undefined, undefined, metadata);
  const search = new SearchService(root, filter);
  const indexedRetrieval = new RetrievalService(search, new CollaborationService(indexedFs, search), undefined, access, indexedFs);
  try {
    const options = { context: 'NAS', intent: 'execute' as const, explain: true };
    expect((await selectSituationCandidates(indexedFs, access, indexedRetrieval, 'oldneedle', options)).complete).toBe(true);
    // Simulate a missed lexical delivery while metadata receives the edit.
    (search as any).watcher?.close();
    const target = mode === 'missing' ? 'B.md' : 'A.md';
    await note(target, 'newneedle ordinary'); metadata.invalidate(target, 'upsert');
    if (mode === 'rehydrated') {
      const doc = (search as any).documents.get(target);
      delete doc.body; delete doc.frontmatterText;
      await (search as any).loadText(doc);
    }
    const stale = await selectSituationCandidates(indexedFs, access, indexedRetrieval, 'newneedle', options);
    expect(stale.results).toEqual([]);
    expect(stale.complete).toBe(false);
    search.invalidate(target);
    const fresh = await selectSituationCandidates(indexedFs, access, indexedRetrieval, 'newneedle', options);
    expect(fresh.results.map(h => h.p)).toEqual([target]);
    expect(fresh.complete).toBe(true);
  } finally { await metadata.close(); await search.close(); }
});

test('coverage is registered again after invalidation without a metadata generation change', async () => {
  await note('A.md', 'watcher');
  const metadata = new VaultMetadataIndex(root, new PathFilter(), new FrontmatterHandler());
  const index = {}, revision = vi.fn(() => undefined);
  try {
    const first = await metadata.prepareSituation('watcher', 'execute', false, () => true);
    expect(first.coverage(index, 1, revision)).toBe(false);
    expect(revision).toHaveBeenCalledTimes(1);
    metadata.invalidate('irrelevant.bin', 'upsert');
    const next = await metadata.prepareSituation('watcher', 'execute', false, () => true);
    expect(next.coverage(index, 1, revision)).toBe(false);
    expect(revision).toHaveBeenCalledTimes(2);
    await metadata.close();
    expect((metadata as any).situationCoverage.get(index)).toBeUndefined();
  } finally { await metadata.close(); }
});

test('warm coverage skips revision walks but still checks current conditions, caller and cache eviction', async () => {
  await note('Rule.md', '---\ncontext_rules:\n  all: [NAS]\n---\nwatcher');
  const metadata = new VaultMetadataIndex(root, new PathFilter(), new FrontmatterHandler());
  const index = {}, revision = vi.fn(() => undefined);
  let allowed = true;
  try {
    const first = await metadata.prepareSituation('NAS', 'execute', false, () => allowed);
    expect(first.coverage(index, 1, revision)).toBe(false);
    expect(first.coverage(index, 1, revision)).toBe(false);
    expect(revision).toHaveBeenCalledTimes(1);
    allowed = false; expect(first.coverage(index, 1, revision)).toBe(true);
    allowed = true; expect(first.coverage(index, 1, revision)).toBe(false);
    const otherContext = await metadata.prepareSituation('OTHER', 'execute', false, () => allowed);
    expect(otherContext.coverage(index, 1, revision)).toBe(true);
    expect(revision).toHaveBeenCalledTimes(1);
    expect(first.coverage({}, 1, revision)).toBe(false);
    expect(revision).toHaveBeenCalledTimes(2);
    const reservation = derivedCacheBudget.reserveWork(derivedCacheBudget.workSnapshot().maxBytes);
    reservation.release();
    expect(first.coverage(index, 1, revision)).toBe(false);
    expect(revision).toHaveBeenCalledTimes(3);
  } finally { await metadata.close(); }
});
