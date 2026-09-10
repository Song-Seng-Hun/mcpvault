import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { normalizeKnowledgeSynthesis } from './knowledge-synthesis-model.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'knowledge-reuse-refinement-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
const write = (path: string, frontmatter: Record<string, any> = {}, content = 'Recorded context') =>
  fs.writeNoteWithReceipt({ path, frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', ...frontmatter }, content });

async function synthesis(state = 'current') {
  const inputs = [];
  for (const id of ['a', 'b']) {
    const path = `${id}.md`;
    const receipt = await write(path, state === 'historical' && id === 'a' ? { lifecycle: 'archived' } : {});
    inputs.push({ id, path, revision: receipt.revision });
  }
  const record = {
    question: 'Which condition applies?', inputs,
    explanations: inputs.map(({ id }) => ({ id, explanation: `Explanation ${id}`, appliesWhen: `Condition ${id}`, limitations: 'Only this condition', basis: [id] })),
    choices: [], counterexamples: [], unresolvedQuestions: ['Other conditions?'],
  };
  if (state === 'changed') await write('a.md', {}, 'Changed premise');
  if (state === 'hidden') await write('a.md', { moderation_status: 'hidden' });
  if (state === 'private') {
    record.inputs[0] = { id: 'secret-input-id', path: '_scopes/agents/secret/Private.md', revision: inputs[0]!.revision };
    record.explanations[0]!.basis = ['secret-input-id'];
  }
  await write('Root.md', { knowledge_synthesis: normalizeKnowledgeSynthesis(record) });
  return record;
}

test('R02 answer claims preserve structured identity, evidence and review without key points', async () => {
  const evidence = await write('Evidence.md');
  await write('Root.md', {
    claims: [{ id: 'c1', text: 'Only for idempotent reads', status: 'disputed', evidence_paths: ['Evidence.md'], evidence: [{ path: 'Evidence.md', revision: evidence.revision, blockId: 'result' }] }],
    claim_reviews: { c1: { status: 'review', reviewed_by: 'reviewer', review_note: 'Scope needs inspection' } },
  });
  const projection = await wiki.readProjection({ path: 'Root.md' });
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false);
  expect(packet.reasoningTrail.claims).toEqual(projection.claims);
  expect(packet.reasoningTrail.claims[0]).toMatchObject({ id: 'c1', status: 'disputed', evidence: [{ blockId: 'result', revision: evidence.revision }], review: { reviewedBy: 'reviewer' } });
  expect(packet.reasoningTrail.gaps).not.toContain('claim');
});

test('R02 summary bullets remain separate from authored claims', async () => {
  await write('Root.md', { key_points: ['Summary bullet only'] });
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false);
  expect(packet.source.keyPoints).toEqual(['Summary bullet only']);
  expect(packet.reasoningTrail.claims).toEqual([]);
  expect(packet.reasoningTrail.gaps).toContain('claim');
});

test.each([
  ['current', 'current_revisions'], ['changed', 'inputs_changed'], ['historical', 'review_required'],
  ['hidden', 'inputs_unavailable'], ['private', 'inputs_unavailable'],
])('R12 ordinary projection and packets report %s basis', async (fixtureState, state) => {
  await synthesis(fixtureState);
  const projection: any = await wiki.readProjection({ path: 'Root.md', view: 'progressive' });
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false);
  const context: any = await wiki.contextPack(undefined, 'Root.md', 16000, false);
  for (const basis of [projection.synthesisBasis, packet.source.synthesisBasis, context.freshness.synthesisBasis]) {
    expect(basis?.state).toBe(state);
    if (state === 'inputs_unavailable') expect(basis).toEqual({ state });
    else expect(basis.notice).toMatch(/do not verify.*interpretation/);
  }
  expect(JSON.stringify([projection, packet, context])).not.toMatch(/secret-input-id|Private\.md|_scopes\/agents\/secret/);
});

test('R12 neighboring synthesis carries premise freshness into supporting context', async () => {
  await synthesis('changed');
  await write('Entry.md', {}, '[[Root.md]]');
  const packet = await wiki.answerPacket(undefined, 'Entry.md', 16000, false);
  expect(packet.supporting).toContainEqual(expect.objectContaining({ path: 'Root.md', synthesisBasis: expect.objectContaining({ state: 'inputs_changed' }) }));
});

test('R12 an explicitly historical input stays historical even when its current metadata is active', async () => {
  const record = await synthesis();
  await write('Root.md', { knowledge_synthesis: { ...record, inputs: record.inputs.map(input => ({ ...input, role: input.id === 'a' ? 'historical_context' : 'premise' })) } });
  const projection: any = await wiki.readProjection({ path: 'Root.md' });
  expect(projection.synthesisBasis).toMatchObject({ state: 'review_required', historicalInputIds: ['a'] });
});

test('R12 current evidence revisions cannot make a changed synthesis basis ready for review completion', async () => {
  const record = await synthesis('changed');
  const evidence = await wiki.ingestSource({ scopeRoot: '', sourceId: 'basis-source', title: 'Observation', content: 'Observed result', capturedBy: 'test' });
  await write('Counterpoint.md', { knowledge_polarity: 'negative' });
  const root = await write('Root.md', { knowledge_synthesis: record, evidence_paths: [evidence.path] }, '[[Counterpoint.md]]');
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false, 'review');
  expect(packet.synthesisPlan).toMatchObject({ status: 'needs_synthesis_basis_review', nextAction: { endpointId: 'notes.read', arguments: { path: 'Root.md', expectedRevision: root.revision } } });
  expect(packet.reasoningTrail.gaps).toContain('synthesis_basis_review');
});

test.each(['answer', 'context'])('R12 %s small-budget fallback retains conservative premise state', async mode => {
  await synthesis('changed');
  const result: any = mode === 'answer' ? await wiki.answerPacket(undefined, 'Root.md', 1024, false) : await wiki.contextPack(undefined, 'Root.md', 1024, false);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
  expect(mode === 'answer' ? result.source.synthesisBasis?.state : result.freshness?.synthesisBasis?.state).toBe('inputs_changed');
});

test.each(['revision', 'access'])('R12 answer rejects late premise %s drift', async kind => {
  await synthesis();
  const diversity = wiki.evidenceDiversity.bind(wiki);
  vi.spyOn(wiki, 'evidenceDiversity').mockImplementation(async (...args) => {
    const result = await diversity(...args);
    if (kind === 'revision') await write('a.md', {}, 'Racing premise');
    else {
      const allowed = access.canAccessPhysicalPath.bind(access);
      vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => path !== 'a.md' && allowed(path, principal));
    }
    return result;
  });
  await expect(wiki.answerPacket(undefined, 'Root.md', 16000, false)).rejects.toThrow(/changed|unavailable/);
});

test('R12 context rejects premise drift after the nested answer finished', async () => {
  await synthesis();
  const answer = wiki.answerPacket.bind(wiki);
  vi.spyOn(wiki, 'answerPacket').mockImplementation(async (...args) => {
    const packet = await answer(...args); await write('a.md', {}, 'Changed after answer'); return packet;
  });
  await expect(wiki.contextPack(undefined, 'Root.md', 16000, false)).rejects.toThrow(/changed|unavailable/);
});

async function experience(large = false) {
  const knowledge = await write('Root.md');
  const record = { id: 'run-1', knowledge: { path: 'Root.md', revision: knowledge.revision }, environment: 'Windows', conditions: 'Idempotent reads only', outcome: 'failed', observed: large ? 'Observation '.repeat(80) : 'Retry failed under load' };
  const observation = await write('Run.md', { knowledge_applications: [record] });
  return { record, observation };
}

test('R15 review handoff reuses observations and historical applied pins without deriving contradiction', async () => {
  const { record, observation } = await experience();
  await write('Root.md', {}, 'Updated conditions');
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false, 'review');
  expect(packet.applications?.items ?? []).toContainEqual(expect.objectContaining({ id: 'run-1', outcome: 'failed', knowledge: record.knowledge, knowledgeState: 'changed_since_application', observation: { path: 'Run.md', revision: observation.revision } }));
  expect(packet.applications.warning).toMatch(/self-reported/);
  expect(packet.counterpoints).toEqual([]);
  expect((await fs.readNote('Root.md')).frontmatter.contradicts).toBeUndefined();
});

test('R15 reuse handoff suppresses private observations and hidden verification text', async () => {
  const { record } = await experience();
  await write('Run.md', { moderation_status: 'hidden', knowledge_applications: [{ ...record, observed: 'HIDDEN EXPERIENCE' }] });
  await write('_scopes/agents/secret/Run.md', { knowledge_applications: [{ ...record, observed: 'PRIVATE EXPERIENCE' }] });
  const packet = await wiki.answerPacket(undefined, 'Root.md', 16000, false, 'execute');
  expect(packet.applications?.items).toEqual([]);
  expect(JSON.stringify(packet)).not.toMatch(/HIDDEN EXPERIENCE|PRIVATE EXPERIENCE|secret/);
});

test.each(['answer', 'context'])('R15 %s small-budget handoff keeps exact reverse-retrieval continuation', async mode => {
  await experience(true);
  const result: any = mode === 'answer' ? await wiki.answerPacket(undefined, 'Root.md', 1024, false, 'review') : await wiki.contextPack(undefined, 'Root.md', 1024, false, 'review');
  const handoff = result.applications ?? result.packet?.applications;
  expect(handoff?.nextAction).toMatchObject({ endpointId: 'wiki.applications', arguments: { path: 'Root.md', expectedRevision: await fs.readNoteRevision('Root.md') } });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
});

test('R15 context rejects observed experience drift after the nested answer finished', async () => {
  await experience();
  const answer = wiki.answerPacket.bind(wiki);
  vi.spyOn(wiki, 'answerPacket').mockImplementation(async (...args) => {
    const packet = await answer(...args); await write('Run.md', { moderation_status: 'hidden' }); return packet;
  });
  await expect(wiki.contextPack(undefined, 'Root.md', 16000, false, 'review')).rejects.toThrow(/changed|unavailable/);
});

test.each(['answer', 'context'].flatMap(mode => [180, 450, 510].map(length => ({ mode, length }))))('reuse preserves $mode root paths of $length characters within the budget', async ({ mode, length }) => {
  const path = `Notes/${'part/'.repeat(Math.floor((length - 15) / 5))}Root.md`;
  const receipt = await write(path);
  const budget = mode === 'context' && length > 180 ? 2048 : 1024;
  const result: any = mode === 'answer' ? await wiki.answerPacket(undefined, path, budget, false, 'review') : await wiki.contextPack(undefined, path, budget, false, 'review');
  expect(mode === 'answer' ? result.source : result.root).toMatchObject({ path, revision: receipt.revision });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
});

test.each(['answer', 'context'])('quality P1 %s rejects synthesis access revoked by a later application validator', async mode => {
  await synthesis();
  await write('Run.md', { knowledge_applications: [{ id: 'run-1', knowledge: { path: 'Root.md', revision: await fs.readNoteRevision('Root.md') }, environment: 'Windows', conditions: 'Observed conditions', outcome: 'inconclusive', observed: 'Needs inspection' }] });
  let armed = false, revoked = false, premiseChecked = false;
  const allowed = access.canAccessPhysicalPath.bind(access), revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => !(revoked && path === 'a.md') && allowed(path, principal));
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const result = await revision(...args);
    if (armed && args[0] === 'a.md') premiseChecked = true;
    if (armed && args[0] === 'Run.md') { expect(premiseChecked).toBe(true); revoked = true; }
    return result;
  });
  if (mode === 'answer') {
    const diversity = wiki.evidenceDiversity.bind(wiki);
    vi.spyOn(wiki, 'evidenceDiversity').mockImplementation(async (...args) => { const result = await diversity(...args); armed = true; return result; });
  } else {
    const answer = wiki.answerPacket.bind(wiki);
    vi.spyOn(wiki, 'answerPacket').mockImplementation(async (...args) => { const result = await answer(...args); armed = true; return result; });
  }
  const result = mode === 'answer' ? wiki.answerPacket(undefined, 'Root.md', 16000, false, 'review') : wiki.contextPack(undefined, 'Root.md', 16000, false, 'review');
  await expect(result).rejects.toThrow(/changed|unavailable/);
  expect(revoked).toBe(true);
});

test.each(['answer', 'context'])('quality P2 %s budgets whole claims while preserving a counterpoint and exact recovery', async mode => {
  const claims = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, text: `${i}${'c'.repeat(699)}`, status: 'unverified' }));
  await write('Counterpoint.md', { knowledge_polarity: 'negative' }, 'Only valid in the recorded environment.');
  const root = await write('Root.md', { claims }, '[[Counterpoint.md]]');
  const projection = await wiki.readProjection({ path: 'Root.md' });
  const result: any = mode === 'answer' ? await wiki.answerPacket(undefined, 'Root.md', 7000, false, 'review') : await wiki.contextPack(undefined, 'Root.md', 7000, false, 'review');
  const packet = mode === 'answer' ? result : result.packet;
  expect(packet.reasoningTrail.claims?.length ?? 0).toBeGreaterThan(0);
  expect(packet.reasoningTrail.claims.length).toBeLessThan(8);
  for (const claim of packet.reasoningTrail.claims) expect(projection.claims).toContainEqual(claim);
  expect(packet.counterpoints).toContainEqual(expect.objectContaining({ path: 'Counterpoint.md', content: 'Only valid in the recorded environment.' }));
  expect(packet.reasoningTrail.gaps).not.toContain('claim');
  expect(packet.reasoningTrail.omittedClaims).toMatchObject({ count: 8 - packet.reasoningTrail.claims.length, nextAction: { endpointId: 'notes.read', arguments: { path: 'Root.md', expectedRevision: root.revision } } });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(7000);
  expect(result.truncated).toBe(true);
});

test.each(['answer', 'context'].flatMap(mode => ['evidence', 'ancestor'].map(target => ({ mode, target }))))('quality P1 $mode rejects $target access revoked after provenance validation', async ({ mode, target }) => {
  const original = await wiki.ingestSource({ scopeRoot: '', sourceId: 'original', title: 'Original', content: 'Original evidence', capturedBy: 'test', sourceWorkId: 'REVOKED-WORK' });
  const evidence = target === 'evidence' ? [original] : await Promise.all(['a', 'b'].map(sourceId => wiki.ingestSource({ scopeRoot: '', sourceId, title: sourceId, content: `Quote ${sourceId}`, capturedBy: 'test', sourceWorkId: sourceId, sourceDerivations: [{ path: original.path, revision: original.revision, relation: 'quotation' }] })));
  await write('Root.md', { evidence_paths: evidence.map(source => source.path) });
  await write('Run.md', { knowledge_applications: [] });
  // Evidence and ancestry need guards even when neither is selected as a neighbor.
  vi.spyOn(wiki, 'neighborhood').mockResolvedValue({ neighbors: [], totalCandidates: 0, truncated: false } as any);
  const before = await wiki.answerPacket(undefined, 'Root.md', 16000, false, 'review');
  expect(JSON.stringify(before)).toContain('REVOKED-WORK');
  let runs = 0, revoked = false;
  const allowed = access.canAccessPhysicalPath.bind(access), revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => !(revoked && path === original.path) && allowed(path, principal));
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const result = await revision(...args);
    if (args[0] === 'Run.md' && ++runs === (mode === 'answer' ? 2 : 3)) revoked = true;
    return result;
  });
  const result = mode === 'answer' ? wiki.answerPacket(undefined, 'Root.md', 16000, false, 'review') : wiki.contextPack(undefined, 'Root.md', 16000, false, 'review');
  await expect(result).rejects.toThrow(/changed|unavailable/);
  expect(revoked).toBe(true);
});

test.each(['answer', 'context'])('quality P2 %s long-path claim recovery reuses the retained root locator', async mode => {
  const path = `Notes/${'part/'.repeat(87)}Root.md`;
  expect(path.length).toBe(448);
  const root = await write(path, { claims: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, text: 'C'.repeat(700), status: 'unverified' })) });
  const budget = mode === 'answer' ? 1024 : 2048;
  const result: any = mode === 'answer' ? await wiki.answerPacket(undefined, path, budget, false, 'review') : await wiki.contextPack(undefined, path, budget, false, 'review');
  expect(mode === 'answer' ? result.source : result.root).toMatchObject({ path, revision: root.revision });
  const omitted = result.reasoningTrail?.omittedClaims ?? result.packet?.reasoningTrail?.omittedClaims ?? result.omittedClaims;
  expect(omitted).toMatchObject({ count: 8, readBinding: { endpointId: 'notes.read' } });
  expect(omitted.nextAction).toBeUndefined();
  const resolve = (reference: string) => reference.split('.').reduce((value, key) => value[key], result);
  expect(resolve(omitted.readBinding.pathFrom)).toBe(path);
  expect(resolve(omitted.readBinding.expectedRevisionFrom)).toBe(root.revision);
  expect(JSON.stringify(omitted)).not.toContain(path);
  expect(JSON.stringify(omitted)).not.toContain(root.revision);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
});

test('quality P2 Context rebases compact Answer recovery references into its returned envelope', async () => {
  const root = await write('Root.md', {
    claims: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, text: 'C'.repeat(700), status: 'unverified' })),
    key_points: Array.from({ length: 8 }, () => 'Large authored summary '.repeat(500)),
    title: 'Large title '.repeat(400),
  });
  const result: any = await wiki.contextPack(undefined, 'Root.md', 4000, false, 'review');
  const omitted = result.packet.reasoningTrail.omittedClaims;
  expect(omitted.count).toBe(8);
  const resolve = (reference: string) => reference.split('.').reduce((value, key) => value?.[key], result);
  expect(omitted.nextAction).toBeUndefined();
  expect(resolve(omitted.readBinding.pathFrom)).toBe('Root.md');
  expect(resolve(omitted.readBinding.expectedRevisionFrom)).toBe(root.revision);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
});

test('counterpoint budget trims optional source prose even when there are no structured claims', async () => {
  await write('Counterpoint.md', { knowledge_polarity: 'negative' }, 'Counterevidence '.repeat(35));
  await write('Root.md', { summary: 'S'.repeat(2000) }, '[[Counterpoint.md]]');
  const packet = await wiki.answerPacket(undefined, 'Root.md', 5000, false, 'review');
  expect(packet.counterpoints).toContainEqual(expect.objectContaining({ path: 'Counterpoint.md' }));
  expect(packet.reasoningTrail.counterexamples).toContainEqual(expect.objectContaining({ path: 'Counterpoint.md' }));
  expect(packet.reasoningTrail.gaps).toContain('claim');
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(5000);
});
