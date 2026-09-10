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
import { QuestionPacketService } from './question-packet.js';

let vault: string, fs: FileSystemService, search: SearchService, access: ScopeAccessPolicy, retrieval: RetrievalService, packet: QuestionPacketService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'question-service-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  search = new SearchService(vault, new PathFilter());
  retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => { throw new Error('backend unavailable'); } }, access, fs);
  packet = new QuestionPacketService(fs, access, retrieval);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function note(path: string, body: string) { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), body); }

test('semantic failure preserves lexical matches and explicitly reports unavailability', async () => {
  await note('Knowledge/A.md', '# Condition\n\nretry only when safe.');
  const r = await packet.read({ query: 'retry' });
  expect(r.retrieval.semantic.state).toBe('unavailable');
  expect(r.sources[0].passages[0].text).toContain('only when safe');
});

test('ordinary question packets exclude fiction before the retrieval limit while keeping legacy notes', async () => {
  for (let i = 0; i < 22; i++) await note(`Fiction/${String(i).padStart(2, '0')}.md`, `---\nfiction_domain: roleplay\n---\nworldneedle fictional experience ${i}`);
  await note('Knowledge/Real.md', 'worldneedle verified operating condition.');
  await note('Knowledge/Legacy.md', 'legacymarker remains available without fiction metadata.');
  const inventory = vi.spyOn(fs, 'queryNotes');
  const real = await packet.read({ query: 'worldneedle', includeSemantic: false, maxChars: 12000 });
  const legacy = await packet.read({ query: 'legacymarker', includeSemantic: false });
  expect(real.sources.map((source: any) => source.path)).toContain('Knowledge/Real.md');
  expect(JSON.stringify(real)).not.toContain('Fiction/');
  expect(legacy.sources.map((source: any) => source.path)).toContain('Knowledge/Legacy.md');
  expect(inventory).not.toHaveBeenCalled();
});

test('an explicit fiction path remains readable but its linked fiction evidence is not admitted', async () => {
  await note('Knowledge/Root.md', '---\nevidence_paths: ["[[Fiction/Evidence]]"]\n---\nrootneedle real claim.');
  await note('Fiction/Evidence.md', '---\nfiction_domain: roleplay\n---\nFICTION_LINK_CANARY rootneedle invented evidence.');
  const direct = await packet.read({ query: 'rootneedle', path: 'Fiction/Evidence.md', includeSemantic: false, maxChars: 12000 });
  const linked = await packet.read({ query: 'rootneedle', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 12000 });
  expect(direct.sources.map((source: any) => source.path)).toContain('Fiction/Evidence.md');
  expect(linked.sources.map((source: any) => source.path)).toContain('Knowledge/Root.md');
  expect(JSON.stringify(linked)).not.toContain('FICTION_LINK_CANARY');
});

test('raw story manuscript output is excluded from real-world retrieval and linked evidence', async () => {
  const output = 'Community/Stories/book/Exports/manuscript.output.md';
  await note(output, 'storyexportneedle FICTION_EXPORT_CANARY an invented library rule.');
  await note('Knowledge/Real.md', `---\nevidence_paths: ["${output}"]\n---\nstoryexportneedle verified operating rule.`);
  const discovered = await packet.read({ query: 'storyexportneedle', includeSemantic: false, maxChars: 12000 });
  const linked = await packet.read({ query: 'storyexportneedle', path: 'Knowledge/Real.md', includeSemantic: false, maxChars: 12000 });
  expect(JSON.stringify(discovered)).not.toContain('FICTION_EXPORT_CANARY');
  expect(JSON.stringify(linked)).not.toContain('FICTION_EXPORT_CANARY');
  expect(discovered.sources.map((s: any) => s.path)).toContain('Knowledge/Real.md');
  const explicit = await packet.read({ query: 'storyexportneedle', path: output, includeSemantic: false, maxChars: 12000 });
  expect(JSON.stringify(explicit)).toContain('FICTION_EXPORT_CANARY');
});

test.each(['edit', 'delete', 'hide', 'revoke'] as const)('drops all collected text on intervening %s', async mode => {
  await note('Knowledge/A.md', '# Retry\n\nretry ORIGINALSECRET.');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (mode === 'edit') await note('Knowledge/A.md', '# Changed\nDIFFERENT');
    if (mode === 'delete') await rm(join(vault, 'Knowledge/A.md'));
    if (mode === 'hide') await note('Knowledge/A.md', '---\nmoderation_status: hidden\n---\nPRIVATE');
    if (mode === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
    return result;
  });
  const r = await packet.read({ query: 'retry', includeSemantic: false });
  expect(r.status).toBe('partial'); expect(r.sources).toEqual([]);
  expect(JSON.stringify(r)).not.toMatch(/ORIGINALSECRET|DIFFERENT|PRIVATE/);
  expect(r.nextAction.endpointId).toBe('wiki.answer_packet');
});

test('deduplicates linked bodies, never reads over eight, and caps the whole pretty response', async () => {
  const links = Array.from({ length: 15 }, (_, i) => `  - Knowledge/Linked${i}.md`).join('\n');
  await note('Knowledge/Root.md', `---\nllm_wiki_type: knowledge\nevidence_paths:\n${links}\n---\n# capneedle\n\ncapneedle root condition.`);
  for (let i = 0; i < 15; i++) await note(`Knowledge/Linked${i}.md`, '# Linked\n\ncapneedle supporting context.');
  const reads = vi.spyOn(fs, 'readNote');
  const r = await packet.read({ query: 'capneedle', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 4000, prettyPrint: true });
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
  expect(new Set(reads.mock.calls.map(c => c[0])).size).toBe(reads.mock.calls.length);
  expect(JSON.stringify(r, null, 2).length).toBeLessThanOrEqual(4000);
  expect(r.truncated).toBe(true);
});

test('expectedRevision guards anchored questions; stale reads return no old passages', async () => {
  await note('Knowledge/A.md', '# Retry\n\nretry only safe.');
  const r = await packet.read({ query: 'retry', path: 'Knowledge/A.md', expectedRevision: '0'.repeat(64), includeSemantic: false });
  expect(r.sources).toEqual([]); expect(r.status).toBe('partial');
});

test('dot-segment private paths and hidden root-prefix hits cannot influence the public result', async () => {
  await note('_scopes/agents/other/Secret.md', '# secretneedle\nsecretneedle private.');
  await note('Knowledge/Public.md', '# Public\nsecretneedle public.');
  const r = await packet.read({ query: 'secretneedle', path: 'Knowledge/../_scopes/agents/other/Secret.md', includeSemantic: false });
  expect(r.sources).toEqual([]);
  const hits = await retrieval.searchNotes({ query: 'secretneedle', pathPrefix: '.', limit: 1 });
  expect(hits[0]?.p).toBe('Knowledge/Public.md');
});

test('context search rejects metadata/body drift without optional search revisions', async () => {
  await note('Knowledge/A.md', '# originalmatch\noriginalmatch old.');
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const metadata = await read(...args);
    await note('Knowledge/A.md', '# Different\nnew unmatched body.');
    return metadata;
  });
  await expect(retrieval.searchNotes({ query: 'originalmatch', excerptMode: 'context' })).rejects.toThrow(/context changed/);
});
