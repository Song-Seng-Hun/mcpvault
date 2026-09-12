import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SearchService } from './search.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { CollaborationService } from './scopes.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { RetrievalService } from './retrieval-service.js';
import { QuestionPacketService } from './question-packet.js';
import { createHash } from 'node:crypto';

let vault: string, search: SearchService, fs: FileSystemService, access: ScopeAccessPolicy;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'wiki-evidence-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  search = new SearchService(vault, new PathFilter());
});
afterEach(async () => { vi.restoreAllMocks(); await search.close(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, content: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content);
}
function services(semantic = { search: async (_params: any): Promise<any> => ({ available: true, results: [] }) }) {
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), semantic, access, fs);
  return { retrieval, packet: new QuestionPacketService(fs, access, retrieval) };
}
test('evidence RRF promotes agreement across channels without changing legacy ranking', async () => {
  await seed('A.md', '# token\ntoken token token token');
  await seed('B.md', '# Other\ntoken');
  const semantic = { search: vi.fn(async () => ({ available: true, results: [{ p: 'B.md', t: 'Other', ex: 'token', mc: 1 }] })) };
  const { retrieval } = services(semantic);
  const args = { query: 'token', semantic: true, limit: 2, maxChars: 4000 };
  const legacy = await retrieval.retrieve(args);
  expect(legacy.results[0].p).toBe('A.md');
  const evidence = await retrieval.retrieve({ ...args, retrievalMode: 'evidence' } as any);
  expect(evidence.results[0].p).toBe('B.md');
  expect(semantic.search.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 20 });
});
test('unknown retrieval mode is rejected, not silently interpreted as legacy', async () => {
  await expect(services().retrieval.retrieve({ query: 'token', retrievalMode: 'wrong' } as any)).rejects.toThrow(/retrievalMode/);
});
test('evidence lexical-only and failed semantic backends retain the requested top-K', async () => {
  for (let i = 0; i < 4; i++) await seed(`${i}.md`, '# token\ntoken');
  const backend = { search: vi.fn(async (): Promise<any> => { throw Error('unavailable'); }) };
  const { retrieval } = services(backend);
  for (const semantic of [false, true]) {
    const result = await retrieval.retrieve({ query: 'token', limit: 1, semantic, retrievalMode: 'evidence', maxChars: 4000 } as any);
    expect(result.results).toHaveLength(1);
    expect(result.semantic.state).toBe(semantic ? 'unavailable' : 'disabled');
  }
});
test('evidence filters deny hidden paths before fusion and duplicate semantic rows do not add votes', async () => {
  await seed('A.md', '# token\ntoken token token'); await seed('B.md', '# Other\ntoken');
  const backend = { search: vi.fn(async (): Promise<any> => ({ available: true, results: [
    { p: '_scopes/users/other/Secret.md', t: 'SECRET', ex: 'secret', mc: 1 },
    ...Array.from({ length: 5 }, () => ({ p: 'B.md', t: 'Other', ex: 'token', mc: 1 })),
  ] })) };
  const { retrieval } = services(backend);
  const result = await retrieval.retrieve({ query: 'token', semantic: true, retrievalMode: 'evidence', limit: 2, maxChars: 4000 } as any);
  expect(result.results.map(r => r.p)).toEqual(['B.md', 'A.md']);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(backend.search.mock.calls[0][0].canAccessPath('_scopes/users/other/Secret.md')).toBe(false);
});
test.each(['"token"', 'token -forbidden', 'path:Missing token'])('strict evidence query %s never calls semantic inference', async query => {
  await seed('A.md', '# token\ntoken permitted');
  const backend = { search: vi.fn(async (): Promise<any> => ({ available: true, results: [] })) };
  const result = await services(backend).retrieval.retrieve({ query, semantic: true, retrievalMode: 'evidence', limit: 2 } as any);
  expect(backend.search).not.toHaveBeenCalled(); expect(result.semantic.state).toBe('filtered');
});
test('semantic-only evidence candidate reads its current exact source anchor', async () => {
  const raw = '# Guide\n\nUnrelated introductory paragraph.\n\n## 제한\n\n결제는 자동 재전송하면 안 됩니다.\n';
  await seed('A.md', raw);
  const revision = (await fs.readNote('A.md')).revision;
  const backend = { search: async (): Promise<any> => ({ available: true, results: [
    { p: 'A.md', t: 'Guide', ex: '결제는 자동 재전송하면 안 됩니다.', mc: 1, vs: true, rv: revision, ln: 7, why: ['semantic_match'] },
  ] }) };
  const result = await services(backend).packet.read({ query: 'payment retry restrictions', retrievalMode: 'evidence', maxChars: 4000 } as any);
  expect(result.sources[0].passages[0].text).toContain('결제는 자동 재전송하면 안 됩니다.');
  expect(result.sources[0].readAction.arguments.expectedRevision).toBe(revision);
});
test('evidence packets do not relax quoted queries through linked notes', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\nrelated: [Other.md]\n---\n# Rule\nexact token applies.');
  await seed('Other.md', '# Other\nexact but a different token.');
  const result = await services().packet.read({ query: '"exact token"', includeSemantic: false, retrievalMode: 'evidence', maxChars: 12000 } as any);
  expect(result.sources.map((r: any) => r.path)).toEqual(['Root.md']);
});
test('evidence packet explicitly preserves the continuation for an omitted counterpoint', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\ncontradicts: [Counter.md]\n---\n# token\n' + 'token supporting condition. '.repeat(40));
  await seed('Counter.md', '---\nllm_wiki_type: knowledge\n---\n# Exception\n' + 'Do not apply without approval. '.repeat(40));
  const result = await services().packet.read({ query: 'token', includeSemantic: false, retrievalMode: 'evidence', maxChars: 2000 } as any);
  const serialized = JSON.stringify(result);
  expect(serialized.length).toBeLessThanOrEqual(2000);
  expect(result.sources.some((r: any) => r.role === 'counterpoint') || result.gaps.includes('counterpoint_omitted_read_before_deciding')).toBe(true);
  const complete = await services().packet.read({ query: 'token', includeSemantic: false, retrievalMode: 'evidence', maxChars: 12000 } as any);
  expect(complete.sources.find((r: any) => r.role === 'counterpoint').passages.some((p: any) => p.text.includes('Do not apply without approval'))).toBe(true);
});
test('evidence prerequisites survive prose pressure or retain an exact continuation', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\ndepends_on: [Required.md]\n---\n# token\n' + 'token general explanation. '.repeat(45));
  await seed('Required.md', '# Admission\n\nOnly proceed with written approval.');
  const r = await services().packet.read({ query: 'token', retrievalMode: 'evidence', includeSemantic: false, maxChars: 1800 } as any);
  const prerequisite = r.sources.find((s: any) => s.path === 'Required.md');
  if (prerequisite) expect(prerequisite.passages[0]?.text).toContain('written approval');
  else {
    expect(r.status).toBe('partial'); expect(r.gaps).toContain('prerequisite_omitted_read_before_deciding');
    expect(r.nextAction.arguments).toMatchObject({ path: 'Required.md', expectedRevision: (await fs.readNote('Required.md')).revision });
  }
});
test('safety body-window exhaustion supplies the next unreturned exact source', async () => {
  const paths = Array.from({ length: 9 }, (_, i) => `Counter${i}.md`);
  await seed('Root.md', `---\nllm_wiki_type: knowledge\ncontradicts: [${paths.join(', ')}]\n---\n# token\ntoken rule.`);
  for (const path of paths) await seed(path, '# Exception\n\nNever act without approval.');
  const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 } as any);
  expect(r.status).toBe('partial'); expect(r.gaps).toContain('counterpoint_omitted_read_before_deciding');
  const action = r.nextAction.arguments;
  expect(r.sources.map((s: any) => s.path)).not.toContain(action.path);
  expect(action.expectedRevision).toBe((await fs.readNote(action.path)).revision);
});
test('reverse contradiction revision is revalidated after graph discovery', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\n---\n# token\ntoken rule.');
  await seed('Counter.md', '---\nllm_wiki_type: knowledge\ncontradicts: [Root.md]\n---\n# Exception\nOLDCOUNTER');
  const original = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await original(...args);
    await seed('Counter.md', '# Changed\nUNRELATED_NEW_BODY'); return result;
  });
  const r = await services().packet.read({ query: 'token', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 } as any);
  expect(r.status).toBe('partial'); expect(r.sources).toEqual([]);
  expect(JSON.stringify(r)).not.toContain('UNRELATED_NEW_BODY');
});
test('strict query withholding a counterpoint has an explicit guarded warning', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\ncontradicts: [Counter.md]\n---\n# Rule\nexact token applies.');
  await seed('Counter.md', '# Exception\nImportant contraindication.');
  const r = await services().packet.read({ query: '"exact token"', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 } as any);
  expect(r.sources.map((s: any) => s.path)).toEqual(['Root.md']);
  expect(r.status).toBe('partial'); expect(r.gaps).toContain('related_context_suppressed_by_query_constraints');
  expect(r.nextAction.arguments.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
});
test('distinct exact locators within one original do not silently collapse', async () => {
  const raw = '# Source\n\nFirst independent passage.\n\n## Second\n\nSecond different passage.\n';
  await seed('Source.md', `---\nllm_wiki_type: source\nimmutable: true\n---\n${raw}`);
  await seed('Root.md', '---\nllm_wiki_type: knowledge\nevidence:\n  - path: Source.md\n    startLine: 3\n    endLine: 3\n  - path: Source.md\n    startLine: 7\n    endLine: 7\n---\n# token\ntoken rule.');
  const r = await services().packet.read({ query: 'token', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 } as any);
  const passages = JSON.stringify(r.sources.find((s: any) => s.path === 'Source.md').passages);
  expect(passages).toContain('First independent passage'); expect(passages).toContain('Second different passage');
});

test('source replacement preserves prerequisite identity', async () => {
  await seed('Root.md', '---\nllm_wiki_type: knowledge\ndepends_on: [Source.md]\nevidence:\n  - path: Source.md\n    startLine: 1\n    endLine: 2\n---\n# token\ntoken rule.');
  await seed('Source.md', '---\nllm_wiki_type: source\n---\n# Approval\nNever proceed without approval.');
  const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 });
  expect(r.sources.find((s: any) => s.path === 'Source.md').selectionReasons).toContain('explicit_prerequisite');
});

test('backlink overflow continuation reads the omitted incoming page', async () => {
  await seed('Root.md', '# token\ntoken rule.');
  for (let i = 0; i < 21; i++) await seed(`Reference${i}.md`, '[[Root.md]]');
  const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 });
  expect(r.status).toBe('partial');
  expect(r.nextAction).toMatchObject({ endpointId: 'mcp.get_backlinks', arguments: { path: 'Root.md', offset: 20 } });
  expect(r.nextAction.arguments.expectedSnapshot).toMatch(/^[a-f0-9]{64}$/);
});

test('evidence declaration caps disclose omission and read source properties', async () => {
  await seed('Root.md', `---\nllm_wiki_type: knowledge\nevidence_paths: [${Array(13).fill('Source.md').join(', ')}]\n---\n# token\ntoken rule.`);
  await seed('Source.md', '# Record\nA source.');
  const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 });
  expect(r.status).toBe('partial'); expect(r.gaps).toContain('evidence_declaration_window_exhausted');
  expect(r.nextAction.arguments).toMatchObject({ path: 'Root.md', expectedRevision: (await fs.readNote('Root.md')).revision });
});

test('budget-omitted safety source outranks an earlier generic continuation', async () => {
  const raw = '# token\n' + 'token detail. '.repeat(75);
  const hash = createHash('sha256').update(raw).digest('hex');
  await seed('Root.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash}\nsource_derivations:\n  - path: Missing.md\n    revision: ${'a'.repeat(64)}\n    relation: quotation\ncontradicts: [Counter.md]\n---\n${raw}`);
  await seed('Counter.md', '# Exception\n' + 'Never proceed without approval. '.repeat(60));
  const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars: 1800 });
  expect(r.gaps).toContain('counterpoint_omitted_read_before_deciding');
  expect(r.nextAction.arguments.path).toBe('Counter.md');
});

test.each([true, false])('counterpoint identity survives evidence merge (locator=%s)', async locator => {
  await seed('Root.md', `---\nllm_wiki_type: knowledge\ncontradicts: [Source.md]\n${locator ? 'evidence:\n  - path: Source.md\n    startLine: 1\n    endLine: 2' : 'evidence_paths: [Source.md]'}\n---\n# token\ntoken rule.`);
  await seed('Source.md', '---\nllm_wiki_type: source\n---\n# Exception\n' + 'Never proceed without approval. '.repeat(50));
  for (const maxChars of [1800, 12000]) {
    const r = await services().packet.read({ query: 'token', path: 'Root.md', retrievalMode: 'evidence', includeSemantic: false, maxChars });
    const source = r.sources.find((s: any) => s.path === 'Source.md');
    if (source) expect(source.counterpointKind).toBe('explicit_contradiction');
    else {
      expect(r.gaps).toContain('counterpoint_omitted_read_before_deciding');
      expect(r.nextAction.arguments.path).toBe('Source.md');
    }
  }
});
