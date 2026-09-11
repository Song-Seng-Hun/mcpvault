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

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, packet: QuestionPacketService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'situational-context-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  const search = new SearchService(root, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => { throw new Error('semantic unavailable'); } }, access, fs);
  packet = new QuestionPacketService(fs, access, retrieval);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, body: string) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
const paths = (result: any) => result.sources.map((s: any) => s.path);

test('same question selects applicable environment and intent without changing ordinary questions', async () => {
  await note('Knowledge/Nas.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS]\n  intents: [execute]\n---\nwatcher requires reconciliation on this NAS.');
  await note('Knowledge/Local.md', '---\nnote_kind: atomic\ncontext_rules:\n  exclude: [NAS]\n---\nwatcher uses local events.');
  const nas = await packet.readSituation({ query: 'watcher', context: 'NAS에서 작업', intent: 'execute', includeSemantic: false, maxChars: 12000 });
  expect(paths(nas)).toContain('Knowledge/Nas.md'); expect(paths(nas)).not.toContain('Knowledge/Local.md');
  expect(nas.sources[0].selectionReasons).toContain('context_rules_match');
  const local = await packet.readSituation({ query: 'watcher', context: 'local disk', intent: 'review', includeSemantic: false });
  expect(paths(local)).toEqual(['Knowledge/Local.md']);
  const legacy = await packet.read({ query: 'watcher', includeSemantic: false, maxChars: 12000 });
  expect(paths(legacy)).toEqual(expect.arrayContaining(['Knowledge/Nas.md', 'Knowledge/Local.md']));
});

test('rule eligibility precedes candidate cap and hidden diagnostics are absent', async () => {
  for (let i = 0; i < 22; i++) await note(`Knowledge/A${i}.md`, '---\nnote_kind: atomic\ncontext_rules:\n  all: [OTHER]\n---\nwatcher irrelevant.');
  await note('Knowledge/Z.md', '---\nnote_kind: atomic\n---\nwatcher relevant current condition.');
  await note('_scopes/agents/other/Secret.md', '---\ncontext_rules:\n  script: HIDDEN_CANARY\n---\nwatcher hidden.');
  const r = await packet.readSituation({ query: 'watcher', context: 'NAS', explain: true, includeSemantic: false, maxChars: 12000 });
  expect(paths(r)).toContain('Knowledge/Z.md');
  expect(JSON.stringify(r)).not.toMatch(/Secret|HIDDEN_CANARY|other/);
  expect(r.diagnostics.length).toBeLessThanOrEqual(8);
});

test('plain condition activations survive saturated knowledge ranking and bounded hydration', async () => {
  for (let i = 0; i < 12; i++) await note(`Knowledge/A${i}.md`, '---\nnote_kind: atomic\n---\nwatcher regular knowledge');
  for (let i = 0; i < 3; i++) await note(`Knowledge/Z${i}.md`, '---\ncontext_rules:\n  all: [NAS]\n---\nSpecific reconnect prerequisite.');
  const reads = vi.spyOn(fs, 'readNote');
  const result = await packet.readSituation({ query: 'watcher', context: 'NAS', intent: 'execute', includeSemantic: false, maxChars: 12000 });
  expect(paths(result)).toEqual(expect.arrayContaining(['Knowledge/Z0.md', 'Knowledge/Z1.md']));
  expect(paths(result)).not.toContain('Knowledge/Z2.md');
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
});

test('explicit counterpoint survives its mismatched rule, with no keyword cascade or second hop', async () => {
  await note('Knowledge/Root.md', '---\nnote_kind: atomic\ncontradicts: ["[[Caution]]"]\ndepends_on: ["[[Prerequisite]]"]\nrelated: ["[[Noise]]"]\n---\nwatcher handles updates. SECRET_TRIGGER');
  await note('Knowledge/Caution.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [OTHER]\ndepends_on: ["[[SecondHop]]"]\n---\nDo not rely on events when reconnect recovery is untested.');
  await note('Knowledge/Prerequisite.md', '---\nnote_kind: atomic\n---\nOnly use this after reconciliation validation.');
  await note('Knowledge/Noise.md', 'Unrelated navigation.');
  await note('Knowledge/SecondHop.md', 'Should not be read.');
  await note('Knowledge/Cascade.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [SECRET_TRIGGER]\n---\nwatcher cascade.');
  const r = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', context: 'NAS', includeSemantic: false, maxChars: 12000 });
  expect(paths(r)).toEqual(expect.arrayContaining(['Knowledge/Root.md', 'Knowledge/Caution.md', 'Knowledge/Prerequisite.md']));
  expect(paths(r)).not.toEqual(expect.arrayContaining(['Knowledge/SecondHop.md']));
  expect(paths(r)).not.toContain('Knowledge/Cascade.md'); expect(paths(r)).not.toContain('Knowledge/Noise.md');
  const caution = r.sources.find((s: any) => s.path === 'Knowledge/Caution.md');
  expect(caution.selectionReasons).toContain('explicit_counterpoint');
  expect(caution.applicability).toBe('conditions_unmatched');
  expect(JSON.stringify(caution)).toContain('reconnect recovery is untested');
});

test.each(['edit', 'delete', 'hide', 'revoke'] as const)('returns no prior passages or diagnostics after %s', async mode => {
  await note('Knowledge/A.md', '---\nnote_kind: atomic\n---\nwatcher OLD_CANARY');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (mode === 'edit') await note('Knowledge/A.md', 'CHANGED_CANARY');
    if (mode === 'delete') await rm(join(root, 'Knowledge/A.md'));
    if (mode === 'hide') await note('Knowledge/A.md', '---\nmoderation_status: hidden\n---\nHIDDEN_CANARY');
    if (mode === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
    return result;
  });
  const r = await packet.readSituation({ query: 'watcher', explain: true, includeSemantic: false });
  expect(r.sources).toEqual([]); expect(r.status).toBe('partial');
  expect(r.nextAction.endpointId).toBe('wiki.context_pack');
  expect(JSON.stringify(r)).not.toMatch(/OLD_CANARY|CHANGED_CANARY|HIDDEN_CANARY/);
});

test('whole serialized budget and eight-body ceiling include linked sources', async () => {
  await note('Knowledge/Root.md', `---\nnote_kind: atomic\ndepends_on: [${Array.from({ length: 20 }, (_, i) => `"[[K${i}]]"`).join(',')}]\n---\nwatcher ${'condition '.repeat(500)}`);
  for (let i = 0; i < 20; i++) await note(`Knowledge/K${i}.md`, `Required condition ${i}.`);
  const reads = vi.spyOn(fs, 'readNote');
  const r = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', includeSemantic: false, explain: true, maxChars: 2000, prettyPrint: true });
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
  expect(new Set(reads.mock.calls.map(c => c[0])).size).toBe(reads.mock.calls.length);
  expect(JSON.stringify(r, null, 2).length).toBeLessThanOrEqual(2000);
  expect(r.status).toBe('partial'); expect(r.truncated).toBe(true);
});

test('malformed direct edits are diagnosed, while executable-looking cues are literal', async () => {
  await note('Knowledge/Bad.md', '---\nnote_kind: atomic\ncontext_rules:\n  script: MALICIOUS_INSTRUCTION\n---\nwatcher unsafe rules.');
  await note('Knowledge/Regex.md', '---\nnote_kind: atomic\ncontext_rules:\n  any: ["/NAS.*/"]\n---\nwatcher regex-looking literal.');
  await note('Knowledge/Unicode.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: ["ＮＡＳ", "한글"]\n---\nwatcher unicode.');
  const r = await packet.readSituation({ query: 'watcher', context: 'nas 한글에서', explain: true, includeSemantic: false, maxChars: 12000 });
  expect(paths(r)).toEqual(['Knowledge/Unicode.md']);
  expect(r.diagnostics.some((d: any) => d.reason === 'invalid_context_rules')).toBe(true);
  expect(JSON.stringify(r)).not.toContain('MALICIOUS_INSTRUCTION');
});

test('context bounds are validated and semantic outage preserves lexical results', async () => {
  await expect(packet.readSituation({ query: 'watcher', context: 'a'.repeat(2001) })).rejects.toThrow(/context/i);
  await note('Knowledge/A.md', 'watcher works only under this condition.');
  const r = await packet.readSituation({ query: 'watcher', includeSemantic: true });
  expect(paths(r)).toContain('Knowledge/A.md'); expect(r.retrieval.semantic.state).toBe('unavailable');
});

test('explicit background keys can activate useful context without a matching body word', async () => {
  await note('Knowledge/Condition.md', '---\nnote_kind: atomic\ncontext_rules:\n  all: [NAS, watcher]\n---\nReconnect recovery has not been validated. Do not assume reliability.');
  const r = await packet.readSituation({ query: 'What should I verify?', context: 'NAS watcher change', includeSemantic: false });
  expect(paths(r)).toContain('Knowledge/Condition.md');
  expect(JSON.stringify(r.sources)).toContain('Do not assume reliability');
});

test('project anchor stays explicit and does not disclose private neighboring memory', async () => {
  await note('Knowledge/Project.md', '---\nnote_kind: project\ndepends_on: ["scope://agent/other/Secret.md"]\n---\nwatcher project constraints.');
  await note('_scopes/agents/other/Secret.md', '---\nmemory_role: core\n---\nwatcher PRIVATE_MEMORY');
  const r = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Project.md', explain: true, includeSemantic: false });
  expect(paths(r)).toContain('Knowledge/Project.md');
  expect(JSON.stringify(r)).not.toMatch(/PRIVATE_MEMORY|Secret/);
});

test('negation and conditions stay literal, and short queries ask for selection', async () => {
  await note('Knowledge/Korean.md', '---\nnote_kind: atomic\n---\n가: 자동 복구가 아니다. NAS에서는 검증한 뒤에만 사용한다.');
  const r = await packet.readSituation({ query: '가', includeSemantic: false });
  expect(r.status).toBe('needs_selection');
  const chosen = await packet.readSituation({ query: '가', path: 'Knowledge/Korean.md', includeSemantic: false });
  expect(JSON.stringify(chosen.sources)).toContain('자동 복구가 아니다');
});

test('incoming typed contradiction is evidence of a counterpoint, not ordinary backlink authority', async () => {
  await note('Knowledge/Root.md', '---\nnote_kind: atomic\n---\nwatcher is reliable.');
  await note('Knowledge/Objection.md', '---\nnote_kind: atomic\ncontradicts: ["[[Root]]"]\ncontext_rules:\n  all: [OTHER]\n---\nReliability failed during reconnect.');
  await note('Knowledge/Ordinary.md', 'An ordinary navigation link to [[Root]].');
  const r = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', includeSemantic: false, maxChars: 12000 });
  expect(paths(r)).toContain('Knowledge/Objection.md');
  expect(paths(r)).not.toContain('Knowledge/Ordinary.md');
  expect(r.sources.find((s: any) => s.path === 'Knowledge/Objection.md').role).toBe('counterpoint');
});

test('revision-guarded backlink metadata reuses a previously read body, rejecting stale guards', async () => {
  await note('Knowledge/Root.md', 'Root');
  await note('Knowledge/Link.md', '---\ncontradicts: ["[[Root]]"]\n---\nObjection');
  const current = await fs.readNote('Knowledge/Root.md');
  const reads = vi.spyOn(fs, 'readNote');
  const result = await fs.getBacklinks('Knowledge/Root.md', 20, () => true, 0, { includeSourceRevision: true, expectedRevision: current.revision });
  expect(result.backlinks.some(b => b.relation === 'contradicts')).toBe(true);
  expect(reads.mock.calls).toHaveLength(0);
  await expect(fs.getBacklinks('Knowledge/Root.md', 20, () => true, 0, { expectedRevision: '0'.repeat(64) })).rejects.toThrow(/changed|revision/i);
});

test('a nearby warning heading without the query word is retained as context', async () => {
  await note('Knowledge/A.md', '---\nnote_kind: atomic\n---\n# Usage\n\nwatcher observes writes.\n\n## 주의사항\n\n재연결 이후에는 검증 전까지 자동 복구를 신뢰하지 않는다.');
  const r = await packet.readSituation({ query: 'watcher', includeSemantic: false, maxChars: 12000 });
  expect(JSON.stringify(r.sources)).toContain('검증 전까지 자동 복구를 신뢰하지 않는다');
});

test('oversized source units are incomplete locators, not misleading sentence fragments', async () => {
  await note('Knowledge/A.md', `---\nnote_kind: atomic\n---\nwatcher ${'detail '.repeat(1000)}EXCEPT_UNVALIDATED_RECOVERY`);
  const r = await packet.readSituation({ query: 'watcher', includeSemantic: false, maxChars: 4000 });
  expect(r.status).toBe('partial');
  for (const source of r.sources) for (const p of source.passages) expect(p.truncated).toBe(false);
  expect(r.nextAction.arguments.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
});

test('diary-kind notes cannot enter a wiki packet through an anchor or declared relation', async () => {
  await note('Knowledge/Diary.md', '---\nnote_kind: diary\n---\nwatcher PERSONAL_EPISODE');
  await note('Knowledge/Root.md', '---\nnote_kind: atomic\ndepends_on: ["[[Knowledge/Diary]]"]\n---\nwatcher root');
  const direct = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Diary.md' });
  const linked = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md' });
  expect(JSON.stringify([direct, linked])).not.toContain('PERSONAL_EPISODE');
});

test('explicit counterpoints are reserved ahead of a saturated evidence list', async () => {
  const refs = Array.from({ length: 12 }, (_, i) => `"[[Knowledge/E${i}]]"`).join(',');
  await note('Knowledge/Root.md', `---\nnote_kind: atomic\nevidence_paths: [${refs}]\ncontradicts: ["[[Knowledge/Caution]]"]\n---\nwatcher root`);
  for (let i = 0; i < 12; i++) await note(`Knowledge/E${i}.md`, 'watcher evidence');
  await note('Knowledge/Caution.md', 'watcher NOT_SAFE_UNLESS_TESTED');
  const full = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', maxChars: 12000 });
  expect(paths(full)).toContain('Knowledge/Caution.md');
  const small = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', maxChars: 1800 });
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(1800);
  expect(paths(small).includes('Knowledge/Caution.md') || small.gaps.some((g: string) => g.includes('counterpoint_omitted'))).toBe(true);
});

test('explain identifies duplicate references without exposing rule text or hidden paths', async () => {
  await note('Knowledge/Root.md', '---\nnote_kind: atomic\ndepends_on: ["[[Knowledge/A]]", "[[Knowledge/A]]"]\n---\nwatcher root');
  await note('Knowledge/A.md', 'watcher condition');
  const r = await packet.readSituation({ query: 'watcher', path: 'Knowledge/Root.md', explain: true, maxChars: 12000 });
  expect(r.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Knowledge/A.md', reason: 'duplicate_reference' })]));
});
