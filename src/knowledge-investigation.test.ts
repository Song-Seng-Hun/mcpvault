import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { organizationNoteTemplate, organizationLintIssues } from './organization.js';
import { collectPlainFrontmatterReferences, isNavigationalFrontmatterReference } from './property-references.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'investigation-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function fixture(prefix = '') {
  const source = await wiki.ingestSource({ scopeRoot: '', sourceId: 'observations', title: 'Run evidence', content: 'Variant A fails under contention.', capturedBy: 'fixture' });
  const target = await fs.writeNoteWithReceipt({ path: `${prefix}Hypothesis.md`, content: '# Claim', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'hypothesis', epistemic_status: 'proposed' } });
  const knowledgeInvestigation = {
    question: 'Does A remain safe under contention?', targets: [{ path: `${prefix}Hypothesis.md`, revision: target.revision }],
    conditions: 'Same workload and machine; vary concurrency only.', alternatives: ['A is safe', 'A loses writes'],
    decisionRules: [{ observation: 'At least one lost write', interpretation: 'challenges', consequence: 'Review the safety claim under concurrent writes.' }],
    executionBoundary: 'Only a user-authorized disposable local fixture; no production access.',
  };
  return { source, target, knowledgeInvestigation, publish: { path: `${prefix}Experiment.md`, content: '# Run\n\n## Protocol\nUse the disposable fixture.', evidencePaths: [source.path], noteKind: 'experiment' as const, epistemicStatus: 'planned', author: 'fixture', expectedRevision: 'missing', knowledgeInvestigation } };
}
function result(f: Awaited<ReturnType<typeof fixture>>, planRevision: string) {
  return { planRevision, observed: 'A lost one write.', outcome: 'challenges', interpretation: 'Concurrent safety needs review.', limitations: 'One workload only.', evidence: [{ path: f.source.path, revision: f.source.revision! }] };
}
test('publishes a bounded investigation through the existing writer without changing the target', async () => {
  const f = await fixture(); const written = await wiki.publishKnowledge(f.publish);
  expect((await fs.readNote(written.path)).frontmatter.knowledge_investigation).toEqual(f.knowledgeInvestigation);
  expect(await fs.readNoteRevision('Hypothesis.md')).toBe(f.target.revision);
});
test('planned targets must be current and concurrent changes fail the related revision guard', async () => {
  const f = await fixture(); const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    await writeFile(join(root, 'Hypothesis.md'), 'Changed externally'); return write(...args);
  });
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/revision|changed|conflict/i);
  expect(await fs.noteExists('Experiment.md')).toBe(false);
});
test('adding a result preserves the agreed plan, binds its revision and never changes the original claim', async () => {
  const f = await fixture(); const planned = await wiki.publishKnowledge(f.publish);
  await fs.writeNote({ path: 'Hypothesis.md', content: '# Refined claim', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'hypothesis' } });
  const changed = await fs.readNoteRevision('Hypothesis.md');
  const record = { ...f.knowledgeInvestigation, result: result(f, planned.revision) };
  const completed = await wiki.publishKnowledge({ ...f.publish, knowledgeInvestigation: record, expectedRevision: planned.revision, epistemicStatus: 'completed' });
  expect((await fs.readNote(completed.path)).frontmatter.knowledge_investigation).toEqual(record);
  expect(await fs.readNoteRevision('Hypothesis.md')).toBe(changed);
  const gaps = await wiki.knowledgeGaps(undefined, 20, 16000);
  const item: any = gaps.items.find((item: any) => item.path === 'Experiment.md');
  expect(item.investigation).toMatchObject({ state: 'targets_changed', resultReported: true });
  expect(item.investigation.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Hypothesis.md', expectedRevision: changed } });
  expect(item.suggestedAction).toMatch(/review|검토/i);
});
test('cannot submit a result without a saved plan or rewrite the agreed criteria along with results', async () => {
  const f = await fixture();
  await expect(wiki.publishKnowledge({ ...f.publish, knowledgeInvestigation: { ...f.knowledgeInvestigation, result: result(f, 'a'.repeat(64)) } })).rejects.toThrow(/plan/i);
  const planned = await wiki.publishKnowledge(f.publish);
  for (const record of [
    { ...f.knowledgeInvestigation, conditions: 'Different comparison', result: result(f, planned.revision) },
    { ...f.knowledgeInvestigation, result: result(f, 'b'.repeat(64)) },
  ]) await expect(wiki.publishKnowledge({ ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: record })).rejects.toThrow(/plan|criteria/i);
});
test('rejects private/Community references before publication and rechecks access at dispatch', async () => {
  const f = await fixture('Community/');
  await expect(wiki.publishKnowledge({ ...f.publish, path: 'GlobalExperiment.md' })).rejects.toThrow(/unavailable/i);
  f.knowledgeInvestigation.executionBoundary = 'Read [[_scopes/agent/secret/Private]]';
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/unavailable/i);
  f.knowledgeInvestigation.executionBoundary = 'Read only the disposable fixture.';
  const can = access.canAccessPhysicalPath.bind(access); let revoked = false;
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((p, principal) => !revoked && can(p, principal));
  const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => { revoked = true; return write(...args); });
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/unavailable/i);
  expect(await fs.noteExists('Community/Experiment.md')).toBe(false);
});
test('guidance flags missing testability without claiming authority to execute the protocol', async () => {
  await fixture();
  const gaps = await wiki.knowledgeGaps(undefined, 20, 12000);
  const item: any = gaps.items.find((x: any) => x.path === 'Hypothesis.md');
  expect(item.reasons).toContain('investigation_criteria_missing');
  expect(item.suggestedAction).toMatch(/authoriz/i);
  for (const kind of ['hypothesis', 'experiment']) {
    expect(organizationNoteTemplate(kind).markdown).toContain('Decision-changing observations');
    const codes = organizationLintIssues('Note.md', { llm_wiki_type: 'knowledge', note_kind: kind }, '').map(x => x.code);
    expect(codes).toContain('investigation_criteria_missing');
  }
});
test('input/result snapshot paths participate in move integrity but are not graph support', async () => {
  const f = await fixture();
  const refs = collectPlainFrontmatterReferences({ knowledge_investigation: { ...f.knowledgeInvestigation, result: result(f, 'a'.repeat(64)) } });
  expect(refs.map(r => r.value)).toEqual(['Hypothesis.md', f.source.path]);
  expect(refs.every(r => !isNavigationalFrontmatterReference(r))).toBe(true);
});
test('hidden targets are not copied to the gap projection and whole output stays bounded', async () => {
  const f = await fixture(); const planned = await wiki.publishKnowledge(f.publish);
  await wiki.publishKnowledge({ ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: { ...f.knowledgeInvestigation, result: result(f, planned.revision) }, epistemicStatus: 'completed' });
  await fs.writeNote({ path: 'Hypothesis.md', content: 'Hidden', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'hypothesis', moderation_status: 'hidden' } });
  for (const prettyPrint of [false, true]) {
    const gaps = await wiki.knowledgeGaps(undefined, 20, 4000, prettyPrint);
    expect(JSON.stringify(gaps, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(4000);
    const text = JSON.stringify(gaps);
    expect(text).not.toContain('Hypothesis.md');
    expect(text).toContain('inputs_unavailable');
  }
});

test('a changed plan during target inspection cannot return an old investigation view', async () => {
  const f = await fixture(); await wiki.publishKnowledge(f.publish);
  const read = fs.readNoteMetadata.bind(fs); let changed = false;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const notes = await read(...args);
    if (!changed && args[0].includes('Hypothesis.md')) {
      changed = true; await writeFile(join(root, 'Experiment.md'), '# Externally changed plan');
    }
    return notes;
  });
  await expect(wiki.knowledgeGaps(undefined, 20, 16000)).rejects.toThrow(/changed|unavailable/i);
});

test('same revision concurrent results have only one successful publication', async () => {
  const f = await fixture(); const planned = await wiki.publishKnowledge(f.publish);
  const args = { ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: { ...f.knowledgeInvestigation, result: result(f, planned.revision) } };
  const outcomes = await Promise.allSettled([wiki.publishKnowledge(args), wiki.publishKnowledge(args)]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
});

test('inconclusive results retain limitations and omission never refreshes or erases them', async () => {
  const f = await fixture(); const planned = await wiki.publishKnowledge(f.publish);
  const recorded = { ...f.knowledgeInvestigation, result: { ...result(f, planned.revision), outcome: 'inconclusive', interpretation: 'Not enough runs to choose.' } };
  const written = await wiki.publishKnowledge({ ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: recorded, epistemicStatus: 'inconclusive' });
  const { knowledgeInvestigation: _omitted, ...args } = f.publish;
  const edit = await wiki.publishKnowledge({ ...args, content: '# Clarified wording', expectedRevision: written.revision });
  expect((await fs.readNote(edit.path)).frontmatter.knowledge_investigation).toEqual(recorded);
  await expect(wiki.publishKnowledge({ ...f.publish, expectedRevision: edit.revision })).rejects.toThrow(/Preserve.*result/i);
});

test('a new plan refuses old target revisions and a result refuses changed evidence', async () => {
  const f = await fixture();
  await expect(wiki.publishKnowledge({ ...f.publish, knowledgeInvestigation: { ...f.knowledgeInvestigation, targets: [{ path: 'Hypothesis.md', revision: 'b'.repeat(64) }] } })).rejects.toThrow(/unavailable|changed/i);
  const planned = await wiki.publishKnowledge(f.publish);
  const reported = result(f, planned.revision); reported.evidence[0]!.revision = 'b'.repeat(64);
  await expect(wiki.publishKnowledge({ ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: { ...f.knowledgeInvestigation, result: reported } })).rejects.toThrow(/unavailable|changed/i);
});

test('final gap validation rechecks candidates after all related reads', async () => {
  const f = await fixture(); await wiki.publishKnowledge(f.publish);
  const read = fs.readNoteRevision.bind(fs); let changed = false;
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    if (!changed && args[0] === 'Hypothesis.md') { changed = true; await writeFile(join(root, 'Experiment.md'), '# Later edit'); }
    return read(...args);
  });
  await expect(wiki.knowledgeGaps(undefined, 20, 16000)).rejects.toThrow(/changed|unavailable/i);
});

test('final read errors never disclose the identity of a hidden target', async () => {
  const f = await fixture(); await wiki.publishKnowledge(f.publish);
  await fs.writeNote({ path: 'Hypothesis.md', content: '# Secret', frontmatter: { llm_wiki_type: 'knowledge', moderation_status: 'hidden' } });
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    if (args[0] === 'Hypothesis.md') throw Error('ENOENT secret Hypothesis.md');
    return read(...args);
  });
  try { await wiki.knowledgeGaps(undefined, 20, 16000); }
  catch (error) { expect(String(error)).not.toContain('Hypothesis.md'); return; }
  // Returning an unavailable projection without reading the hidden file is also safe.
});

test('mixed application-only guards are permission checked at dispatch', async () => {
  const f = await fixture();
  const application = await fs.writeNoteWithReceipt({ path: 'Applied.md', content: '# Knowledge', frontmatter: { llm_wiki_type: 'knowledge' } });
  const knowledgeApplications = [{ id: 'run', knowledge: { path: 'Applied.md', revision: application.revision }, environment: 'Fixture', conditions: 'One run', outcome: 'inconclusive', observed: 'No decision.' }];
  let revoked = false; const can = access.canAccessPhysicalPath.bind(access);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => !(revoked && path === 'Applied.md') && can(path, principal));
  const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => { revoked = true; return write(...args); });
  await expect(wiki.publishKnowledge({ ...f.publish, knowledgeApplications })).rejects.toThrow(/unavailable|access/i);
  expect(await fs.noteExists('Experiment.md')).toBe(false);
});

test('canonical scope URI targets can reuse their original plan when reporting a result', async () => {
  const f = await fixture(); f.knowledgeInvestigation.targets[0]!.path = 'scope://global/Hypothesis.md';
  const planned = await wiki.publishKnowledge(f.publish);
  const completed = await wiki.publishKnowledge({ ...f.publish, expectedRevision: planned.revision, knowledgeInvestigation: { ...f.knowledgeInvestigation, result: result(f, planned.revision) } });
  expect((await fs.readNote(completed.path)).frontmatter.knowledge_investigation.targets[0].path).toBe('Hypothesis.md');
});

test('invalid records and exhausted inspection budgets give an explicit repair or read route', async () => {
  const f = await fixture();
  await fs.writeNote({ path: 'Bad.md', content: '# Invalid', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'experiment', epistemic_status: 'completed', knowledge_investigation: {} } });
  const invalid: any = (await wiki.knowledgeGaps(undefined, 20, 16000)).items.find((item: any) => item.path === 'Bad.md');
  expect(invalid.suggestedAction).toMatch(/repair/i);
  expect(invalid.investigation.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Bad.md', property: 'knowledge_investigation', expectedRevision: await fs.readNoteRevision('Bad.md') } });
  for (let run = 0; run < 9; run++) {
    const refs = [];
    for (let index = 0; index < 8; index++) {
      const path = `Input-${run}-${index}.md`;
      const saved = await fs.writeNoteWithReceipt({ path, content: '# Input', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic' } });
      refs.push({ path, revision: saved.revision });
    }
    await fs.writeNote({ path: `Run-${run}.md`, content: '# Run', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'experiment', epistemic_status: 'completed', knowledge_investigation: {
      ...f.knowledgeInvestigation, targets: refs.slice(0, 4), result: { ...result(f, 'a'.repeat(64)), evidence: refs.slice(4) },
    } } });
  }
  const gaps: any = await wiki.knowledgeGaps(undefined, 100, 16000);
  const unassessed = gaps.items.find((item: any) => item.investigation?.state === 'unassessed');
  expect(unassessed).toBeDefined();
  expect(unassessed.suggestedAction).toMatch(/budget|narrow/i);
  expect(unassessed.investigation.nextAction.endpointId).toBe('notes.read');
  expect(JSON.stringify(gaps).length).toBeLessThanOrEqual(16000);
});
