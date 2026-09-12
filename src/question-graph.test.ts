import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { SearchService } from './search.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { CollaborationService } from './scopes.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { RetrievalService } from './retrieval-service.js';
import { QuestionPacketService } from './question-packet.js';
import { VaultGraphIndex } from './vault-graph.js';

let vault: string, search: SearchService, fs: FileSystemService, access: ScopeAccessPolicy;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'wiki-graph-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  search = new SearchService(vault, new PathFilter());
});
afterEach(async () => { vi.restoreAllMocks(); await search.close(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fm: Record<string, unknown> = {}, body = 'Independent explanation.') {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`);
}
function packet() {
  const semantic = { search: async (): Promise<any> => ({ available: true, results: [] }) };
  return new QuestionPacketService(fs, access, new RetrievalService(search, new CollaborationService(fs, search), semantic, access, fs));
}
const args = { query: 'entrymarker', retrievalMode: 'evidence', graphDepth: 2, includeSemantic: false, maxChars: 12000 } as const;
async function chain() {
  await seed('Root.md', { llm_wiki_type: 'knowledge', supports: ['Claim.md'] }, 'entrymarker is a policy.');
  await seed('Claim.md', { llm_wiki_type: 'knowledge', evidence_paths: ['Original.md'] }, 'A supporting claim.');
  const body = '# Original\n\nOnly requests with authorization are allowed.';
  await seed('Original.md', { llm_wiki_type: 'source', immutable: true, content_sha256: createHash('sha256').update(body).digest('hex') }, body);
}

test('two edges reach an original and retain each relation author revision', async () => {
  await chain();
  const result = await packet().read(args);
  const original = result.sources.find((s: any) => s.path === 'Original.md');
  expect(original).toBeDefined();
  expect(original.passages.some((p: any) => p.text.includes('Only requests'))).toBe(true);
  expect(original.graphPaths[0].map((e: any) => e.relation)).toEqual(['supports', 'evidence']);
  expect(original.graphPaths[0].map((e: any) => [e.from, e.to])).toEqual([['Root.md', 'Claim.md'], ['Claim.md', 'Original.md']]);
  for (const edge of original.graphPaths[0]) {
    expect(edge.fromRevision).toBe((await fs.readNote(edge.from)).revision);
    expect(edge.toRevision).toBe((await fs.readNote(edge.to)).revision);
    expect(edge.direction).toBe('outgoing');
  }
  expect(original.readAction.arguments.expectedRevision).toBe((await fs.readNote('Original.md')).revision);
});

test('omission and explicit depth one retain existing evidence behavior', async () => {
  await chain();
  const { graphDepth: _, ...oldArgs } = args;
  const before = await packet().read(oldArgs);
  const depthOne = await packet().read({ ...oldArgs, graphDepth: 1 } as any);
  const stable = (value: unknown) => JSON.parse(JSON.stringify(value, (key, v) => key === 'asOf' ? undefined : v));
  expect(stable(depthOne)).toEqual(stable(before));
  expect(before.sources.map((s: any) => s.path)).not.toContain('Original.md');
});

test.each([0, 3, '2', null])('invalid depth %s is rejected', async graphDepth => {
  await expect(packet().read({ ...args, graphDepth } as any)).rejects.toThrow(/graphDepth/);
});
test('depth two requires evidence mode', async () => {
  await expect(packet().read({ ...args, retrievalMode: 'legacy' } as any)).rejects.toThrow(/evidence/);
});

test('strict query suppresses expansion with an explicit state', async () => {
  await chain();
  const r = await packet().read({ ...args, query: '"entrymarker"' });
  expect(r.retrieval.graph).toMatchObject({ depth: 2, state: 'suppressed_query_constraints' });
  expect(r.sources.map((s: any) => s.path)).toEqual(['Root.md']);
});

test('parallel relation kinds survive and cycles do not extend beyond two edges', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge', supports: ['Claim.md'], depends_on: ['Claim.md'] }, 'entrymarker');
  await seed('Claim.md', { llm_wiki_type: 'knowledge', derived_from: ['Original.md'], supports: ['Root.md'] });
  await seed('Original.md', { llm_wiki_type: 'source', evidence_paths: ['Third.md'] });
  await seed('Third.md', { llm_wiki_type: 'source' });
  const r = await packet().read(args);
  const original = r.sources.find((s: any) => s.path === 'Original.md');
  expect(original.graphPaths.map((p: any[]) => p[0].relation).sort()).toEqual(['depends_on', 'supports']);
  expect(original.graphPaths.every((p: any[]) => p.length === 2)).toBe(true);
  expect(r.sources.map((s: any) => s.path)).not.toContain('Third.md');
});

test('metadata-first body allocation retains late counterpoints ahead of root prose', async () => {
  for (let i = 0; i < 5; i++) await seed(`Root${i}.md`, { llm_wiki_type: 'knowledge', supports: [`Bridge${i}.md`] }, `entrymarker ${i}`);
  for (let i = 0; i < 5; i++) {
    await seed(`Bridge${i}.md`, { llm_wiki_type: 'knowledge', contradicts: [`Counter${i}.md`] });
    await seed(`Counter${i}.md`, { llm_wiki_type: 'knowledge' }, `Never proceed without condition ${i}.`);
  }
  const bodyRead = vi.spyOn(fs, 'readNote');
  const r = await packet().read(args);
  expect(r.sources.filter((s: any) => s.role === 'counterpoint')).toHaveLength(5);
  expect(new Set(bodyRead.mock.calls.map(c => c[0])).size).toBeLessThanOrEqual(8);
  expect(r.status).toBe('partial');
});

test('inbound contradictions keep their authored direction', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  await seed('Counter.md', { llm_wiki_type: 'knowledge', contradicts: ['Root.md'] }, 'Never apply this policy unconditionally.');
  const r = await packet().read(args);
  const row = r.sources.find((s: any) => s.path === 'Counter.md');
  expect(row.graphPaths[0][0]).toMatchObject({ from: 'Counter.md', to: 'Root.md', relation: 'contradicts', direction: 'incoming' });
  expect(row.role).toBe('counterpoint');
});

test('hidden and ambiguous reference candidates are not auto-selected or disclosed', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge', supports: ['Claim.md', '_scopes/users/other/Secret.md'] }, 'entrymarker');
  await seed('a/Claim.md', { llm_wiki_type: 'knowledge' });
  await seed('b/Claim.md', { llm_wiki_type: 'knowledge' });
  await seed('_scopes/users/other/Secret.md', { llm_wiki_type: 'knowledge' }, 'HIDDEN_SENTINEL');
  const r = await packet().read(args);
  expect(r.sources.map((s: any) => s.path)).toEqual(['Root.md']);
  expect(JSON.stringify(r)).not.toMatch(/HIDDEN_SENTINEL|Secret|a\/Claim|b\/Claim/);
  expect(r.gaps).toContain('unresolved_evidence_or_relation');
});

test.each([1800, 4000, 12000])('graph output fits complete JSON budget %s', async maxChars => {
  await chain();
  const r = await packet().read({ ...args, maxChars, prettyPrint: true });
  expect(JSON.stringify(r, null, 2).length).toBeLessThanOrEqual(maxChars);
  for (const s of r.sources) expect(s.graphPaths?.length || 0).toBeLessThanOrEqual(3);
});

test('reverse discovery shares the forty-document metadata window', async () => {
  for (let i = 0; i < 5; i++) {
    await seed(`Root${i}.md`, { llm_wiki_type: 'knowledge' }, `entrymarker ${i}`);
    for (let j = 0; j < 12; j++) await seed(`Counter${i}-${j}.md`, { llm_wiki_type: 'knowledge', contradicts: [`Root${i}.md`] });
  }
  const read = vi.spyOn(fs, 'readNoteMetadata');
  const r = await packet().read(args);
  expect(new Set(read.mock.calls.flatMap(c => c[0])).size).toBeLessThanOrEqual(40);
  expect(r.status).toBe('partial');
  expect(r.sources.length).toBeGreaterThan(0);
});

test('revision change in a metadata-only intermediate discards all prior context', async () => {
  for (let i = 0; i < 5; i++) {
    await seed(`Root${i}.md`, { llm_wiki_type: 'knowledge', supports: [`Bridge${i}.md`] }, `entrymarker ${i}`);
    await seed(`Bridge${i}.md`, { llm_wiki_type: 'knowledge', contradicts: [`Counter${i}.md`] });
    await seed(`Counter${i}.md`, { llm_wiki_type: 'knowledge' });
  }
  const read = fs.readNote.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...a) => {
    const note = await read(...a);
    if (!changed) { changed = true; await seed('Bridge0.md', { llm_wiki_type: 'knowledge' }, 'Changed relation'); }
    return note;
  });
  const r = await packet().read(args);
  expect(r.sources).toEqual([]);
  expect(r.gaps).toEqual(['context_changed_or_unavailable']);
  expect(r.nextAction.arguments.graphDepth).toBe(2);
});

test('final access revocation of an intermediate discards graph paths and text', async () => {
  await chain();
  let denied = false;
  const revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...a) => {
    const rv = await revision(...a);
    if (a[0] === 'Original.md') denied = true;
    return rv;
  });
  const allowed = access.canAccessPhysicalPath.bind(access);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => !(denied && path === 'Claim.md') && allowed(path, principal));
  const r = await packet().read(args);
  expect(r.sources).toEqual([]);
  expect(JSON.stringify(r)).not.toContain('Only requests');
});

test('relation budget retains complete bounded paths and an exact continuation', async () => {
  const references = Array.from({ length: 100 }, (_, i) => i % 2 ? '[[Claim.md#Section]]' : 'Claim.md');
  await seed('Root.md', { llm_wiki_type: 'knowledge', supports: references }, 'entrymarker');
  await seed('Claim.md', { llm_wiki_type: 'knowledge' });
  const r = await packet().read(args);
  expect(r.gaps).toContain('graph_relation_window_exhausted');
  expect(r.status).toBe('partial');
  expect(r.nextAction.arguments.expectedRevision).toBeDefined();
});

test('non-contradicting backlinks do not consume the counterpoint discovery window', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  for (let i = 0; i < 50; i++) await seed(`Other${i}.md`, { llm_wiki_type: 'knowledge', supports: ['Root.md'] });
  await seed('ZCounter.md', { llm_wiki_type: 'knowledge', contradicts: ['Root.md'] }, 'Do not proceed.');
  const r = await packet().read(args);
  expect(r.sources.some((s: any) => s.path === 'ZCounter.md' && s.role === 'counterpoint')).toBe(true);
});

test('reverse ambiguity cannot create a definite contradiction edge', async () => {
  await seed('a/Claim.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  await seed('b/Claim.md', { llm_wiki_type: 'knowledge' });
  await seed('Counter.md', { llm_wiki_type: 'knowledge', contradicts: ['Claim.md'] });
  const r = await packet().read(args);
  expect(r.sources.map((s: any) => s.path)).not.toContain('Counter.md');
  expect(r.gaps).toContain('unresolved_evidence_or_relation');
});

test('backlink inspection stops before its shared occurrence budget is exceeded', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  await seed('Counter.md', { llm_wiki_type: 'knowledge', contradicts: Array.from({ length: 200 }, () => 'Root.md') });
  const budget = { remaining: 80 };
  const result = await fs.getBacklinks('Root.md', 20, () => true, 0, { includeSourceRevision: true, relations: ['contradicts'], inspectionBudget: budget } as any);
  expect(result.total).toBeLessThanOrEqual(80);
  expect(budget.remaining).toBe(0);
  expect(result.truncated).toBe(true);
});

test('metadata exhaustion preserves reverse counterpoints already verified', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  for (let i = 0; i < 40; i++) await seed(`Counter${i}.md`, { llm_wiki_type: 'knowledge', contradicts: ['Root.md'] }, 'Do not proceed.');
  const r = await packet().read(args);
  expect(r.sources.some((s: any) => s.role === 'counterpoint')).toBe(true);
  expect(r.status).toBe('partial');
  expect(r.nextAction.arguments.path).toMatch(/Counter/);
  expect(r.nextAction.arguments.expectedRevision).toBeDefined();
  expect(r.sources.map((s: any) => s.path)).not.toContain(r.nextAction.arguments.path);
});

test('path display truncation cannot remove later counterpoint classification', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge', evidence: [{ path: 'T.md', heading: 'One' }, { path: 'T.md', heading: 'Two' }], supports: ['T.md', 'Bridge.md'] }, 'entrymarker');
  await seed('T.md', { llm_wiki_type: 'knowledge' }, '# One\n\nA condition.\n\n# Two\n\nA restriction.');
  await seed('Bridge.md', { llm_wiki_type: 'knowledge', contradicts: ['T.md'] });
  const r = await packet().read(args);
  const target = r.sources.find((s: any) => s.path === 'T.md');
  expect(target.selectionReasons).toContain('explicit_counterpoint');
  expect(target.graphPaths.length).toBeLessThanOrEqual(3);
  expect(target.graphPaths.some((p: any[]) => p.some(e => e.relation === 'contradicts'))).toBe(true);
});

test('metadata-declared negative knowledge gets a body before bulk originals', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge', knowledge_polarity: 'negative', evidence_paths: Array.from({ length: 8 }, (_, i) => `Source${i}.md`) }, 'entrymarker must never run without approval.');
  for (let i = 0; i < 8; i++) await seed(`Source${i}.md`, { llm_wiki_type: 'source' });
  const r = await packet().read(args);
  expect(r.sources.some((s: any) => s.path === 'Root.md' && s.role === 'counterpoint')).toBe(true);
});

test('private-to-public incoming contradictions require only the authored reference direction', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  const privatePath = '_scopes/models/testmodel/Counter.md';
  await seed(privatePath, { llm_wiki_type: 'knowledge', contradicts: ['Root.md'] });
  const principal = { accountId: 'graph-test', modelId: 'testmodel', role: 'model' } as const;
  expect(access.canAccessPhysicalPath(privatePath, principal)).toBe(true);
  expect(access.canReferenceFrom(privatePath, 'Root.md')).toBe(true);
  expect(access.canReferenceFrom('Root.md', privatePath)).toBe(false);
  const r = await packet().read({ ...args, principal });
  expect(r.sources.some((s: any) => s.path === access.toPublicPath(privatePath))).toBe(true);
});

test.each(['[[Root.md#^claim-a]]', 'Root.md#^claim-a'])('reverse target locator %s survives without a fabricated author line', async target => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker. ^claim-a');
  await seed('Counter.md', { llm_wiki_type: 'knowledge', contradicts: [target] }, 'Counterpoint text has no target block.');
  const r = await packet().read(args);
  const counter = r.sources.find((s: any) => s.path === 'Counter.md');
  expect(counter.graphPaths[0][0].locator).toMatchObject({ path: 'Root.md', blockId: 'claim-a', revision: (await fs.readNote('Root.md')).revision });
  expect(counter.graphPaths[0][0].authorLocator).toMatchObject({ path: 'Counter.md', propertyPath: 'contradicts[0]' });
  expect(counter.graphPaths[0][0].authorLocator.startLine).toBeUndefined();
  expect(counter.passages.some((p: any) => p.text.includes('Counterpoint text'))).toBe(true);
  expect(r.gaps).not.toContain('stale_evidence_locator');
});

test('compact backlink discovery never projects or validates unrelated author context', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge' }, 'entrymarker');
  await seed('Counter.md', { llm_wiki_type: 'knowledge', contradicts: Array.from({ length: 200 }, () => 'Root.md'), supports: ['Other.md'] });
  await seed('Other.md', { llm_wiki_type: 'knowledge' });
  const project = vi.spyOn(VaultGraphIndex.prototype as any, 'linkProjector');
  const revision = vi.spyOn(fs, 'readNoteRevision');
  const budget = { remaining: 80 };
  const result = await fs.getBacklinks('Root.md', 20, () => true, 0, { includeSourceRevision: true, includeSnapshot: true, relations: ['contradicts'], inspectionBudget: budget, compact: true } as any);
  expect(project).not.toHaveBeenCalled();
  expect(revision.mock.calls.map(c => c[0])).not.toContain('Other.md');
  expect(result.backlinks.every(link => link.context === '' && link.heading === undefined)).toBe(true);
  expect(budget.remaining).toBe(0);
});

test.each([{ startLine: 0, endLine: 0 }, { revision: 12 }, { heading: ['not-a-heading'] }])('malformed locator %j is not downgraded to an omitted pin', async fields => {
  await chain();
  await seed('Root.md', { llm_wiki_type: 'knowledge', evidence: [{ path: 'Original.md', ...fields }] }, 'entrymarker');
  const r = await packet().read(args);
  const original = r.sources.find((s: any) => s.path === 'Original.md');
  expect(original.evidence.locator).toBe('stale');
  expect(r.gaps).toContain('stale_evidence_locator');
  expect(r.gaps).toContain('no_verified_immutable_evidence');
});

test('truncated claim declarations report partial coverage even before any relation is found', async () => {
  await seed('Root.md', { llm_wiki_type: 'knowledge', claims: [...Array.from({ length: 81 }, (_, i) => ({ id: `c${i}`, text: 'No references.' })), { id: 'last', evidence_paths: ['Original.md'] }] }, 'entrymarker');
  await seed('Original.md', { llm_wiki_type: 'source' });
  const r = await packet().read(args);
  expect(r.status).toBe('partial');
  expect(r.gaps).toContain('evidence_declaration_window_exhausted');
  expect(r.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Root.md', expectedRevision: (await fs.readNote('Root.md')).revision } });
});
