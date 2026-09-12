import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SearchService, memorySourceMatches } from './search.js';
import { SemanticSearchService } from './semantic-search.js';
import { RetrievalService } from './retrieval-service.js';
import { CollaborationService } from './scopes.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { SEMANTIC_EMBEDDING_PROFILE } from './semantic-profile.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

let vault: string;
let search: SearchService;
let semantic: SemanticSearchService;
let retrieval: RetrievalService;
let host: Awaited<ReturnType<typeof derivedStorageFixture>>;
const revision = 'a'.repeat(64);
const vector = Array.from({ length: 384 }, (_, i) => Number(i === 0));

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'memory-candidates-'));
  const filter = new PathFilter();
  const access = new ScopeAccessPolicy();
  const fs = new FileSystemService(vault);
  search = new SearchService(vault, filter);
  host = await derivedStorageFixture(vault);
  semantic = new SemanticSearchService(vault, filter, access, undefined, undefined, undefined, host.host);
  retrieval = new RetrievalService(search, new CollaborationService(fs, search), semantic, access, fs);
});
afterEach(async () => {
  await search.close();
  await semantic.close();
  await host.close();
  vi.restoreAllMocks();
  await rm(vault, { recursive: true, force: true });
});
async function note(path: string, content: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), content);
}
async function warmIndexWithoutRetainingBodies() {
  // Index initialization/maintenance is separate from candidate projection.
  await (search as any).ensureIndex();
  for (const document of (search as any).documentsById.values()) {
    delete document.body;
    delete document.frontmatterText;
    delete document.frontmatter;
  }
  return vi.spyOn(search as any, 'loadText').mockRejectedValue(new Error('Candidate hydration forbidden'));
}

test('ordinary candidates exceed the standard 20-hit cap without loading evicted bodies', async () => {
  for (let i = 0; i < 25; i++) await note(`Memory/${i}.md`, 'ordinaryneedle experience');
  const hydration = await warmIndexWithoutRetainingBodies();
  const result = await retrieval.memoryCandidates({ query: 'ordinaryneedle', semantic: false, canAccessPath: () => true });
  expect(result.complete).toBe(true);
  expect(result.results).toHaveLength(25);
  expect(result.results.every(hit => hit.ex === '' && /^[a-f0-9]{64}$/.test(hit.rv || ''))).toBe(true);
  expect(hydration).not.toHaveBeenCalled();
});

test('indexed aliases and retrieval cues survive body eviction', async () => {
  await note('Alias.md', '---\naliases: [aliasneedle]\n---\nOther words');
  await note('Cue.md', '---\nretrieval_cues: [cueneedle]\n---\nOther words');
  const hydration = await warmIndexWithoutRetainingBodies();
  for (const [query, path] of [['aliasneedle', 'Alias.md'], ['cueneedle', 'Cue.md']]) {
    const result = await retrieval.memoryCandidates({ query: query!, semantic: false, canAccessPath: () => true });
    expect(result.results.map(hit => hit.p)).toEqual([path]);
    expect(result.complete).toBe(true);
  }
  expect(hydration).not.toHaveBeenCalled();
});

test('lexical predicates are applied before the candidate limit and never cached across callers', async () => {
  for (const path of ['A.md', 'B.md', '_scopes/agents/other/Private.md']) await note(path, 'scopefixture');
  await warmIndexWithoutRetainingBodies();
  for (const path of ['A.md', 'B.md']) {
    const result = await retrieval.memoryCandidates({ query: 'scopefixture', limit: 1, semantic: false, canAccessPath: p => p === path });
    expect(result.results.map(hit => hit.p)).toEqual([path]);
    expect(result.complete).toBe(true);
  }
});

test('candidate overflow is explicit, with no false exhaustion or hidden counts', async () => {
  for (const path of ['A.md', 'B.md', 'C.md']) await note(path, 'overflowfixture');
  await warmIndexWithoutRetainingBodies();
  const result = await retrieval.memoryCandidates({ query: 'overflowfixture', limit: 2, semantic: false, canAccessPath: () => true });
  expect(result.results).toHaveLength(2);
  expect(result.complete).toBe(false);
  expect(result).not.toHaveProperty('total');
});

test('the internal metadata response has a hard 10000-hit ceiling', async () => {
  await note('Seed.md', 'capfixture');
  await warmIndexWithoutRetainingBodies();
  const seed = [...(search as any).documents.values()][0];
  // Expand an initialized metadata-only index, without 10,001 filesystem writes.
  for (let i = 0; i < 10_001; i++) {
    const document = { ...seed, relativePath: `Synthetic/${i}.md`, documentId: 100 + i };
    (search as any).documents.set(document.relativePath, document);
    (search as any).documentsById.set(document.documentId, document);
    (search as any).pathDocuments.get('').add(document.documentId);
  }
  const result = await retrieval.memoryCandidates({ query: '', limit: 50_000, semantic: false, canAccessPath: p => p.startsWith('Synthetic/') });
  expect(result.results).toHaveLength(10_000);
  expect(result.complete).toBe(false);
});

test('unindexed admitted revisions are incomplete without revealing filtered hidden notes', async () => {
  await note('Hidden.md', '---\nmoderation_status: hidden\n---\nhiddenneedle');
  await warmIndexWithoutRetainingBodies();
  const result = await retrieval.memoryCandidates({ query: 'hiddenneedle', semantic: false, canAccessPath: p => p !== 'Hidden.md', candidateRevisions: new Map([['Missing.md', revision]]) });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
  expect(JSON.stringify(result)).not.toContain('Hidden.md');
});

test.each(['"retry exact phrase"', 'retry -payments', 'tag:approved retry', 'section:(retry policy)'])('constrained query %s is not weakened when source verification is unavailable', async query => {
  await note('A.md', 'retry payments exact unrelated phrase');
  await warmIndexWithoutRetainingBodies();
  const result = await retrieval.memoryCandidates({ query, semantic: true, canAccessPath: () => true });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
  expect(result.usedQuery).toBe(query);
  expect(result.expanded).toBe(false);
  expect(result.semantic.state).toBe('filtered');
});

test('current metadata revisions cannot silently select an obsolete lexical index row', async () => {
  await note('A.md', 'oldneedle');
  await warmIndexWithoutRetainingBodies();
  const result = await retrieval.memoryCandidates({ query: 'oldneedle', semantic: false, canAccessPath: () => true, candidateRevisions: new Map([['A.md', 'b'.repeat(64)]]) });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
});

type VectorRow = { id: string; path: string; hash: string; embeddingProfile: string; _distance: number };
function row(path: string, distance = 0): VectorRow {
  return { id: `${path}#0`, path, hash: revision, embeddingProfile: SEMANTIC_EMBEDDING_PROFILE, _distance: distance };
}
async function vectorBackend(rows: VectorRow[]) {
  await (semantic as any).manifestReady;
  await (semantic as any).pendingReady;
  (semantic as any).manifest = Object.fromEntries(rows.map(r => [r.path, { hash: r.hash, scope: 'global', embeddingProfile: SEMANTIC_EMBEDDING_PROFILE }]));
  vi.spyOn(semantic as any, 'acquireIndexLease').mockResolvedValue(false);
  vi.spyOn(semantic as any, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
  const predicates: string[] = [];
  // Only the native vector backend is replaced. This double applies its SQL
  // path allowlist BEFORE LIMIT, so a post-query predicate cannot pass the test.
  vi.spyOn(semantic as any, 'getTable').mockResolvedValue({
    schema: async () => ({ fields: [{ name: 'embeddingProfile' }] }),
    vectorSearch: () => {
      let predicate = ''; let limit = Infinity;
      return {
        where(value: string) { predicate = value; predicates.push(value); return this; },
        distanceType() { return this; },
        limit(value: number) { limit = value; return this; },
        toArray: async () => {
          const paths = [...predicate.matchAll(/path = '((?:''|[^'])*)'/g)].map(match => match[1]!.replace(/''/g, "'"));
          return rows.filter(r => !paths.length || paths.includes(r.path)).slice(0, limit);
        },
      };
    },
  });
  const hydration = vi.spyOn(semantic as any, 'hydrateRows').mockRejectedValue(new Error('Candidate hydration forbidden'));
  return { predicates, hydration };
}

test('vector admission is in WHERE before topK and global dot means the vault root', async () => {
  const allowed = "Memory/O'Brien.md";
  const rows = [...Array.from({ length: 50 }, (_, i) => row(`Noise/${i}.md`)), row(allowed, 0.5)];
  const { predicates, hydration } = await vectorBackend(rows);
  const result = await retrieval.memoryCandidates({ query: 'semanticneedle', queryVector: vector, semantic: true, pathPrefix: '.', limit: 1, canAccessPath: p => p === allowed });
  expect(result.results.map(hit => hit.p)).toEqual([allowed]);
  expect(result.complete).toBe(true);
  expect(result.semantic.state).toBe('available');
  expect(predicates.length).toBeGreaterThan(0);
  expect(predicates.every(p => p.includes("path = 'Memory/O''Brien.md'"))).toBe(true);
  expect(hydration).not.toHaveBeenCalled();
});

test('vector candidates read no source bodies even for more than eight admitted documents', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(`Memory/${i}.md`));
  // No source files exist: candidate discovery must use the index only.
  const { hydration } = await vectorBackend(rows);
  const result = await retrieval.memoryCandidates({ query: 'semanticneedle', semantic: true, queryVector: vector, canAccessPath: () => true });
  expect(result.results).toHaveLength(20);
  expect(result.complete).toBe(false);
  expect(result.results.every(hit => hit.ex === '' && hit.rv === revision)).toBe(true);
  expect(hydration).not.toHaveBeenCalled();
});

test('semantic candidates keep the globally nearest 20 and reject nonpositive cosine similarity', async () => {
  const near = Array.from({ length: 25 }, (_, i) => row(`Near/${i}.md`, i / 100));
  await vectorBackend([...near].reverse().concat([row('Noise.md', 1), row('Opposite.md', 1.8)]));
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector, canAccessPath: () => true });
  expect(result.results.map(hit => hit.p)).toEqual(near.slice(0, 20).map(hit => hit.path));
  expect(result.results[0]?.semanticDistance).toBe(0);
  expect(result.complete).toBe(false);
});

test('available vectors with only orthogonal or opposite candidates produce no semantic leads', async () => {
  await vectorBackend([row('Noise.md', 1), row('Opposite.md', 1.8)]);
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector, canAccessPath: () => true });
  expect(result).toEqual({ results: [], available: true, complete: true });
});

test('source confirmation rejects ngram false positives but accepts current aliases and cues', () => {
  const params = { query: 'abcd', path: 'Plain.md', content: 'abc and bcd are separated' };
  expect(memorySourceMatches(params)).toBe(false);
  expect(memorySourceMatches({ ...params, content: 'The actual abcd condition' })).toBe(true);
  expect(memorySourceMatches({ ...params, frontmatter: { aliases: ['ABCD'] } })).toBe(true);
  expect(memorySourceMatches({ ...params, frontmatter: { retrieval_cues: ['abcd condition'] } })).toBe(true);
  expect(memorySourceMatches({ ...params, query: '"abcd condition"' })).toBeUndefined();
  expect(memorySourceMatches({ ...params, query: 'abc -bcd' })).toBeUndefined();
  expect(memorySourceMatches({ ...params, query: '가', content: 'unrelated body' })).toBe(false);
  expect(memorySourceMatches({ ...params, query: '가', content: '가 조건' })).toBe(true);
  expect(memorySourceMatches({ ...params, query: 'missing OR abc' })).toBe(true);
  expect(memorySourceMatches({ ...params, query: 'missing abc' })).toBe(true);
});

test('vector candidate cache never reuses another admission predicate', async () => {
  await vectorBackend([row('A.md'), row('B.md')]);
  for (const path of ['A.md', 'B.md']) {
    const result = await retrieval.memoryCandidates({ query: 'semanticneedle', semantic: true, queryVector: vector, canAccessPath: p => p === path });
    expect(result.results.map(hit => hit.p)).toEqual([path]);
  }
});

test('stale vector revisions are incomplete and never hydrated', async () => {
  await vectorBackend([row('A.md')]);
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector, canAccessPath: () => true, candidateRevisions: new Map([['A.md', 'b'.repeat(64)]]) });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
});

test('lazy metadata revisions filter semantic-only candidates before top-k', async () => {
  await vectorBackend([row('Stale.md', 0), row('SemanticOnly.md', 0.1)]);
  const result = await retrieval.memoryCandidates({ query: 'semanticneedle', queryVector: vector, semantic: true, limit: 1,
    canAccessPath: () => true, candidateRevision: path => path === 'SemanticOnly.md' ? revision : 'b'.repeat(64) });
  expect(result.results.map(hit => hit.p)).toEqual(['SemanticOnly.md']);
  expect(result.complete).toBe(false);
});

test('lazy metadata revisions are rechecked after semantic awaits', async () => {
  await vectorBackend([row('A.md')]);
  let current = revision;
  vi.spyOn(semantic as any, 'getTableNames').mockImplementation(async () => {
    current = 'b'.repeat(64); return new Set(['chunks_global']);
  });
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector,
    canAccessPath: () => true, candidateRevision: () => current });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
});

test('a saturated duplicate-chunk window does not claim vector exhaustion', async () => {
  const rows = Array.from({ length: 10_001 }, (_, i) => ({ ...row('A.md'), id: `A.md#${i}` }));
  await vectorBackend(rows);
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector, canAccessPath: () => true });
  expect(result.results.map(hit => hit.p)).toEqual(['A.md']);
  expect(result.complete).toBe(false);
});

test('permissions changing across a vector await invalidate the candidate projection', async () => {
  await vectorBackend([row('A.md')]);
  let readable = true;
  vi.spyOn(semantic as any, 'getTableNames').mockImplementation(async () => { readable = false; return new Set(['chunks_global']); });
  const result = await semantic.memoryCandidates({ query: 'semanticneedle', queryVector: vector, canAccessPath: () => readable });
  expect(result.results).toEqual([]);
  expect(result.complete).toBe(false);
});

test('semantic failure is partial and cannot erase lexical candidates or echo backend secrets', async () => {
  await note('A.md', 'fallbackneedle');
  await warmIndexWithoutRetainingBodies();
  vi.spyOn(semantic, 'memoryCandidates').mockRejectedValue(new Error('SECRET_TOKEN backend failure'));
  const result = await retrieval.memoryCandidates({ query: 'fallbackneedle', semantic: true, canAccessPath: () => true });
  expect(result.results.map(hit => hit.p)).toEqual(['A.md']);
  expect(result.complete).toBe(false);
  expect(result.semantic.state).toBe('unavailable');
  expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
});

test('standard search keeps its existing limit and body excerpt contract', async () => {
  for (let i = 0; i < 25; i++) await note(`${i}.md`, 'standardneedle body');
  const result = await search.search({ query: 'standardneedle', limit: 100, maxChars: 12000 });
  expect(result).toHaveLength(20);
  expect(result.every(hit => hit.ex.includes('standardneedle'))).toBe(true);
});

test('retrieval forwards indexed fiction admission and current revision requirements before semantic top-k', async () => {
  const fiction = Array.from({ length: 20 }, (_, i) => ({ p: `Fiction/${i}.md`, t: `Fiction ${i}`, ex: '', mc: 0 }));
  for (const hit of fiction) await note(hit.p, '---\nfiction_domain: roleplay\n---\nUnrelated indexed text.');
  await note('Knowledge/Real.md', 'Unrelated indexed text.');
  const fs = new FileSystemService(vault);
  const candidates = await Promise.all([...fiction, { p: 'Knowledge/Real.md', t: 'Real', ex: '', mc: 0 }]
    .map(async hit => ({ ...hit, rv: await fs.readNoteRevision(hit.p), fiction: hit.p.startsWith('Fiction/') })));
  vi.spyOn(semantic, 'search').mockImplementation(async params => {
    expect(params).toMatchObject({ fictionDomain: 'exclude', includeRevisions: true });
    // This adapter-contract double models the current backend predicate. Real
    // native vector admission is covered by semantic-reuse.test.ts.
    const admitted = candidates.filter(hit => (params.fictionDomain !== 'exclude' || !hit.fiction)
      && (!params.canAccessPath || params.canAccessPath(hit.p)));
    return { results: admitted.slice(0, 1).map(({ fiction: _fiction, ...hit }) => hit), available: true, indexed: candidates.length, pending: 0 };
  });
  const result = await retrieval.retrieve({ query: 'semanticfictionneedle', semantic: true, fictionDomain: 'exclude', limit: 1 });
  expect(result.results.map(hit => hit.p)).toEqual(['Knowledge/Real.md']);
});
