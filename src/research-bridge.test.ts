import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ResearchBridgeService } from './research-bridge.js';
import { researchWorkIds } from './research-bridge-work.js';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';
import { CollaborationService } from './scopes.js';
import { RetrievalService } from './retrieval-service.js';

let root: string, fs: FileSystemService, service: ResearchBridgeService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'research-bridge-')); fs = new FileSystemService(root);
  service = new ResearchBridgeService(fs, new ScopeAccessPolicy());
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, fm: Record<string, unknown> = {}, content = 'A real observation with conditions.') {
  return fs.writeNote({ path, content: `# Observation\n\n${content}\n`, frontmatter: { note_kind: 'atomic', domain: 'math', ...fm } });
}
async function sample() {
  await note('Focus.md', { methods: ['symmetry'], related: ['[[Linked.md]]'] });
  await note('Method.md', { domain: 'physics', methods: ['symmetry'] });
  await note('Linked.md', { domain: 'biology' });
  await note('Distant.md', { domain: 'music' });
}
test('returns two nearby leads and one explicitly unexplained distant lead with revision locators', async () => {
  await sample(); const before = await fs.readNoteRevision('Focus.md');
  const result = await service.candidates({ focusPath: 'Focus.md' });
  expect(result.candidates.map(c => c.lane)).toEqual(['near', 'near', 'distant']);
  expect(result.candidates.every(c => c.status === 'unverified_hypothesis')).toBe(true);
  expect(result.candidates[2]!.gaps).toContain('connection_not_explained');
  expect(result.sources.every(s => s.revision.length === 64 && s.nextAction.arguments.expectedRevision === s.revision)).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
  expect(await fs.readNoteRevision('Focus.md')).toBe(before);
});
test('two anchors require a mediator connected to both sides, without claiming transitive proof', async () => {
  await note('A.md', { methods: ['network'] }); await note('C.md', { domain: 'physics', methods: ['flow'] });
  await note('B.md', { domain: 'engineering', methods: ['network', 'flow'] });
  await note('OneSide.md', { methods: ['network'] });
  const r = await service.candidates({ focusPath: 'A.md', comparePath: 'C.md' });
  expect(r.candidates).toHaveLength(1); expect(r.candidates[0]!.target).toBe('B.md');
  expect(r.candidates[0]!.gaps).toContain('relations_do_not_prove_transitivity');
});
test('public focus excludes community, private and moderated candidates even with matching metadata', async () => {
  await note('Focus.md', { methods: ['secretmarker'] });
  await note('Community/PrivateLead.md', { methods: ['secretmarker'] });
  await note('_scopes/agents/secret/Hidden.md', { methods: ['secretmarker'] });
  await note('Quarantined.md', { methods: ['secretmarker'], moderation_status: 'quarantined' });
  const r = await service.candidates({ focusPath: 'Focus.md' });
  expect(r.candidates).toHaveLength(0);
  expect(JSON.stringify(r)).not.toMatch(/PrivateLead|Hidden|Quarantined/);
});
test.each(['../outside.md', 'C:/secret.md', 'Folder/../Focus.md', 'Focus.md.', 'scope://user/u/Secret.md'])(
  'rejects unsafe focus %s without exposing content', async focusPath => {
    await expect(service.candidates({ focusPath })).rejects.toThrow(/unavailable|path/i);
  });
test('fenced prose never appears as a passage or an observed relationship', async () => {
  await note('Focus.md', { methods: ['symmetry'] });
  await note('Other.md', { domain: 'physics', methods: ['symmetry'] }, '~~~md\nFORGED_EVIDENCE [[Secret.md]]\n~~~\n\nActual limited observation.');
  const r = await service.candidates({ focusPath: 'Focus.md', query: 'FORGED_EVIDENCE' });
  expect(JSON.stringify(r)).not.toContain('FORGED_EVIDENCE [[');
  expect(JSON.stringify(r.sources)).not.toContain('Secret.md');
});
test('rejects source revision changes between candidate selection and body hydration', async () => {
  await sample(); const original = fs.readNote.bind(fs); let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (path, bytes) => {
    if (path === 'Method.md' && !changed) { changed = true; await note(path, { domain: 'physics', methods: ['different'] }); }
    return original(path, bytes);
  });
  await expect(service.candidates({ focusPath: 'Focus.md' })).rejects.toThrow(/changed|unavailable/i);
});
test('bounds retained candidate metadata and does not pretend a window is exhaustive', async () => {
  await note('Focus.md', { methods: ['symmetry'] });
  for (let i = 0; i < 70; i++) await note(`N${i}.md`, { domain: 'physics', methods: ['symmetry'] });
  const spy = vi.spyOn(fs, 'readNote');
  const r = await service.candidates({ focusPath: 'Focus.md', maxChars: 1600 });
  expect(r.coverage.partial).toBe(true); expect(r.coverage.metadataRetained).toBeLessThanOrEqual(64);
  expect(spy.mock.calls.length).toBeLessThanOrEqual(8); expect(JSON.stringify(r).length).toBeLessThanOrEqual(1600);
});
test('optional retrieval failure preserves metadata leads and reports its unavailability', async () => {
  await sample(); const retrieval = { retrieve: async () => { throw Error('PRIVATE_BACKEND_ERROR'); }, physical: (hit: any) => hit.p };
  const r = await new ResearchBridgeService(fs, new ScopeAccessPolicy(), retrieval as any).candidates({ focusPath: 'Focus.md', query: 'symmetry' });
  expect(r.candidates.length).toBeGreaterThan(0); expect(r.semantic.state).toBe('unavailable');
  expect(JSON.stringify(r)).not.toContain('PRIVATE_BACKEND_ERROR');
});
test('one anchor alone returns insufficient material without inventing a field or candidate', async () => {
  await note('Focus.md'); const r = await service.candidates({ focusPath: 'Focus.md' });
  expect(r.candidates).toEqual([]); expect(r.status).toBe('insufficient_material');
});

test('common retrieval selects beyond the old path sample before metadata hydration', async () => {
  await note('Focus.md', { methods: ['symmetry'] });
  for (let i = 0; i < 70; i++) await note(`A${i}.md`);
  await note('ZRelevant.md', { methods: ['symmetry'] });
  await note('Community/Hidden.md', { methods: ['symmetry'] });
  const retrieve = vi.fn(async (params: any) => {
    expect(params.canAccessPath('ZRelevant.md')).toBe(true);
    expect(params.canAccessPath('Community/Hidden.md')).toBe(false);
    return { results: [{ p: 'ZRelevant.md' }, { p: 'Community/Hidden.md' }], semantic: { state: 'disabled' } };
  });
  const r = await new ResearchBridgeService(fs, new ScopeAccessPolicy(), { retrieve, physical: (hit: any) => hit.p } as any)
    .candidates({ focusPath: 'Focus.md', query: 'symmetry', semantic: false });
  expect(retrieve).toHaveBeenCalledTimes(2);
  expect(retrieve.mock.calls[1]![0].query).toBe('[domain] -math');
  expect(r.candidates.map(c => c.target)).toContain('ZRelevant.md');
  expect(JSON.stringify(r)).not.toContain('Hidden.md');
  expect(r.coverage.partial).toBe(true);
  expect(r.nextAction?.endpointId).toBe('wiki.search');
  expect(r.coverage.metadataRetained).toBeLessThanOrEqual(64);
});

test('limited fallback continues to ordinary search, not the same research sample', async () => {
  await sample();
  const r = await service.candidates({ focusPath: 'Focus.md' });
  expect(r.coverage.partial).toBe(true);
  expect(r.nextAction?.endpointId).toBe('wiki.search');
  expect(r.nextAction?.arguments).toMatchObject({ query: expect.stringContaining('symmetry') });
});
test('real shared retrieval finds metadata matches beyond the old alphabetical window', async () => {
  await note('Focus.md', { methods: ['symmetry'] });
  for (let index = 0; index < 70; index++) await note(`A-${index}.md`, { methods: ['unrelated'] });
  await note('ZRelevant.md', { methods: ['symmetry'] });
  await note('Community/Hidden.md', { methods: ['symmetry'] });
  const access = new ScopeAccessPolicy(), search = new SearchService(root, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => ({ available: false, results: [] }) }, access, fs);
  for (const query of [undefined, 'symmetry']) {
    const result = await new ResearchBridgeService(fs, access, retrieval).candidates({ focusPath: 'Focus.md', ...(query && { query }), semantic: false });
    expect(result.candidates.map(candidate => candidate.target)).toContain('ZRelevant.md');
    expect(JSON.stringify(result)).not.toContain('Hidden.md');
    expect(result.coverage.partial).toBe(true);
    expect(result.nextAction?.arguments.searchFrontmatter).toBe(true);
  }
});
test('configured real retrieval preserves two near leads and one unexplained distant-domain lead', async () => {
  await sample();
  for (let index = 0; index < 70; index++) await note(`A-${index}.md`, { domain: 'math' });
  await note('Community/Hidden.md', { domain: 'music' });
  const access = new ScopeAccessPolicy(), search = new SearchService(root, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => ({ available: false, results: [] }) }, access, fs);
  const reads = vi.spyOn(fs, 'readNote');
  const result = await new ResearchBridgeService(fs, access, retrieval).candidates({ focusPath: 'Focus.md', semantic: false });
  expect(result.candidates.map(candidate => candidate.lane)).toEqual(['near', 'near', 'distant']);
  expect(result.candidates.at(-1)).toMatchObject({ target: 'Distant.md', status: 'unverified_hypothesis', gaps: expect.arrayContaining(['connection_not_explained']) });
  expect(result.sources.every(source => source.revision.length === 64)).toBe(true);
  expect(result.coverage.metadataRetained).toBeLessThanOrEqual(64);
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(result)).not.toContain('Hidden.md');
});
test('research identity is stable for the same question and revisions and changes with new observations', async () => {
  await sample(); const first = await service.candidates({ focusPath: 'Focus.md', query: 'Symmetry?' });
  const repeat = await service.candidates({ focusPath: 'Focus.md', query: 'Symmetry?' });
  expect(first.candidates[0]!.researchKey).toBe(repeat.candidates[0]!.researchKey);
  await note('Focus.md', { methods: ['symmetry'], related: ['[[Linked.md]]'] }, 'New observation.');
  const next = await service.candidates({ focusPath: 'Focus.md', query: 'Symmetry?' });
  expect(first.candidates[0]!.researchKey).not.toBe(next.candidates[0]!.researchKey);
});

test('unchanged parked research stays parked until explicit reconsideration or a changed question', async () => {
  await sample(); const first = await service.candidates({ focusPath: 'Focus.md', query: 'Why symmetry?' });
  const ids = researchWorkIds(first.candidates[0]!.researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'Mapping failed; waiting for new evidence.', frontmatter: { mcpvault_type: 'agent_task', task_id: ids.taskId, status: 'cancelled' } });
  const same = await service.candidates({ focusPath: 'Focus.md', query: 'Why symmetry?' });
  expect(same.candidates.some(c => c.researchKey === first.candidates[0]!.researchKey)).toBe(false);
  const explicit = await service.candidates({ focusPath: 'Focus.md', query: 'Why symmetry?', revisit: true });
  expect(explicit.candidates[0]!.work?.state).toBe('parked');
  expect(explicit.candidates[0]!.work?.createAction).toBeUndefined();
  const changed = await service.candidates({ focusPath: 'Focus.md', query: 'What breaks the symmetry?' });
  expect(changed.candidates[0]!.researchKey).not.toBe(first.candidates[0]!.researchKey);
});

test('hidden or colliding work cannot remove an otherwise valid discovery lead', async () => {
  await sample(); const first = await service.candidates({ focusPath: 'Focus.md' });
  const ids = researchWorkIds(first.candidates[0]!.researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'HIDDEN_WORK_BODY', frontmatter: { moderation_status: 'hidden', mcpvault_type: 'agent_task' } });
  const after = await service.candidates({ focusPath: 'Focus.md' });
  expect(after.candidates.map(c => c.target)).toEqual(first.candidates.map(c => c.target));
  expect(after.candidates[0]!.work).toEqual({ state: 'unavailable' });
  expect(JSON.stringify(after)).not.toContain('HIDDEN_WORK_BODY');
});

test('storage errors never expose host paths or backend details', async () => {
  await sample();
  vi.spyOn(fs, 'readNoteMetadata').mockRejectedValue(Object.assign(Error('EIO C:/private/SECRET_HOST_PATH'), { code: 'EIO' }));
  await expect(service.candidates({ focusPath: 'Focus.md' })).rejects.toThrow('Research input unavailable');
  await expect(service.candidates({ focusPath: 'Focus.md' })).rejects.not.toThrow('SECRET_HOST_PATH');
});

test('ordinary authored notes and legacy knowledge participate without requiring a template', async () => {
  await fs.writeNote({ path: 'Focus.md', content: 'A question recorded as plain Markdown.', frontmatter: { domain: 'math', methods: ['symmetry'] } });
  await fs.writeNote({ path: 'Legacy.md', content: 'An older interpretation.', frontmatter: { llm_wiki_type: 'knowledge', domain: 'physics', methods: ['symmetry'] } });
  const result = await service.candidates({ focusPath: 'Focus.md' });
  expect(result.candidates[0]!.target).toBe('Legacy.md');
});
