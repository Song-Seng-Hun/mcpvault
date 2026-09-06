import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-quality-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown> = {}, body = 'Current knowledge.') {
  const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', ...fields })}---\n${body}`;
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  return raw;
}

test('quality bounds the whole report and retains a same-target revision-bearing next step', async () => {
  const raw = await seed('Concept.md', { title: 'Long conceptual title '.repeat(1000), note_kind: 'atomic', knowledge_role: 'model' });
  for (const maxChars of [512, 600, 1000, 6000, 12000]) {
    const result: any = await service.qualityCheck(undefined, 'Concept.md', maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result).toMatchObject({ path: 'Concept.md', revision: hash(raw), advisory: true, assessment: 'authoring_structure', nextAction: {
      endpointId: 'notes.read', arguments: { path: 'Concept.md', expectedRevision: hash(raw), maxChars: 3000 },
    } });
    expect(result.checks.some((check: any) => !check.passed)).toBe(true);
  }
  expect(await readFile(join(vault, 'Concept.md'), 'utf8')).toBe(raw);
});

test.each(['hidden', 'removed', 'quarantined'])('quality rejects %s even in an authorized scope', async state => {
  await seed('_scopes/agents/worker/Secret.md', { moderation_status: state, title: 'Hidden detail' });
  await expect(service.qualityCheck(principal, '_scopes/agents/worker/Secret.md')).rejects.toThrow(/unavailable/i);
});

test('quality rejects a foreign scope before reading its note', async () => {
  await seed('_scopes/agents/other/Secret.md');
  const read = vi.spyOn(fs, 'readNote');
  await expect(service.qualityCheck(principal, '_scopes/agents/other/Secret.md')).rejects.toThrow(/denied/i);
  expect(read).not.toHaveBeenCalled();
});

test.each(['edited', 'hidden', 'deleted'])('quality rejects a source %s after its captured read', async change => {
  await seed('Concept.md');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const note = await read(...args);
    if (change === 'deleted') await rm(join(vault, 'Concept.md'));
    else await seed('Concept.md', change === 'hidden' ? { moderation_status: 'hidden' } : {}, 'Changed body');
    return note;
  });
  await expect(service.qualityCheck(undefined, 'Concept.md')).rejects.toThrow(/changed|unavailable/i);
});

test('quality preserves source IO errors rather than turning them into a low score', async () => {
  await seed('Concept.md');
  vi.spyOn((fs as any).vaultIo, 'readUtf8').mockRejectedValue(Object.assign(new Error('storage unavailable'), { code: 'EIO' }));
  await expect(service.qualityCheck(undefined, 'Concept.md')).rejects.toThrow('storage unavailable');
});

test.each([undefined, '0'.repeat(64)])('quality distinguishes unverified and stale projection fingerprints (%s)', async fingerprint => {
  await seed('Concept.md', { summary: 'Earlier summary', ...(fingerprint && { summary_of_content_sha256: fingerprint }) });
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'projection_freshness', passed: false, state: fingerprint ? 'stale' : 'unverified' }));
  expect(result.nextActions).toContain('projection_freshness');
  expect(JSON.stringify(result)).not.toContain('Earlier summary');
});

test.each(['summary', 'key_points'])('quality verifies a current %s projection without changing its fingerprint', async field => {
  const fields = field === 'summary' ? { summary: 'Current summary' } : { key_points: ['Current point'] };
  await seed('Concept.md', fields);
  const note = await fs.readNote('Concept.md');
  const raw = await seed('Concept.md', { ...fields, summary_of_content_sha256: hash(note.content) });
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'compact_projection', passed: true }));
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'projection_freshness', passed: true, state: 'current' }));
  expect(await readFile(join(vault, 'Concept.md'), 'utf8')).toBe(raw);
});

test.each([{ summary: 123 }, { summary: { bogus: 'object' } }, { key_points: [' ', null, {}] }])('quality does not count malformed projection Properties: %j', async fields => {
  await seed('Concept.md', fields);
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'compact_projection', passed: false }));
});

test.each([undefined, 'unprocessed', 'invented-status'])('literature is not interpreted merely by linking or omitting its status (%s)', async state => {
  await seed('Literature.md', { note_kind: 'literature', ...(state && { interpretation_status: state }) }, '[[Some source]]');
  const result: any = await service.qualityCheck(undefined, 'Literature.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'interpretation', passed: false }));
});

test.each(['interpreted', 'synthesized'])('quality accepts an explicit %s literature stage as an authoring declaration', async state => {
  await seed('Literature.md', { note_kind: 'literature', interpretation_status: state });
  const result: any = await service.qualityCheck(undefined, 'Literature.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'interpretation', passed: true }));
});

test('quality rejects malformed evidence declarations without claiming source verification', async () => {
  await seed('Concept.md', { evidence_paths: [null, '', ' ', 42, {}] });
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'evidence_or_explicit_uncertainty', passed: false }));
});

test('quality recognizes structured evidence declarations but does not read or certify the cited note', async () => {
  await seed('Concept.md', { evidence: [{ path: '_sources/NotInspected.md', revision: '0'.repeat(64) }] });
  const read = vi.spyOn(fs, 'readNote');
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.assessment).toBe('authoring_structure');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'evidence_or_explicit_uncertainty', passed: true }));
  expect(read.mock.calls.map(([path]) => path)).toEqual(['Concept.md']);
  expect(JSON.stringify(result)).not.toContain('NotInspected');
});

test('compact quality shows a late failed role check before successful generic checks', async () => {
  const body = '# Queue model\n\n[[Anchor]]\n\n## Scope\nBounded queues.\n\n## Components\nProducer and consumer.\n\n## Mechanism\nBackpressure.\n\n## Assumptions\nFinite producer rate.\n';
  const fields = { note_kind: 'atomic', knowledge_role: 'model', knowledge_status: 'draft', summary: 'Queue model.' };
  await seed('Queue.md', fields, body);
  const note = await fs.readNote('Queue.md');
  await seed('Queue.md', { ...fields, summary_of_content_sha256: hash(note.content) }, body);
  const full: any = await service.qualityCheck(undefined, 'Queue.md', 12000);
  expect(full.checks.filter((check: any) => !check.passed).map((check: any) => check.id)).toEqual(['model_limits']);
  const compact: any = await service.qualityCheck(undefined, 'Queue.md', 512);
  expect(JSON.stringify(compact).length).toBeLessThanOrEqual(512);
  expect(compact.score).toEqual(full.score);
  expect(compact.checks[0]).toMatchObject({ id: 'model_limits', passed: false });
  expect(compact.nextActions).toContain('model_limits');
});

test('quality uses exact private scope read actions and never leaks physical scope storage paths', async () => {
  await seed('_scopes/agents/worker/Concept.md');
  const result: any = await service.qualityCheck(principal, '_scopes/agents/worker/Concept.md', 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.nextAction.arguments.path).toBe('scope://agent/worker/Concept.md');
  expect(JSON.stringify(result)).not.toContain('_scopes');
});

test('quality long-path retry preserves the original target instead of shortening it', async () => {
  const path = Array.from({ length: 8 }, (_, i) => `${i}-${'segment'.repeat(7)}`).join('/') + '/Concept.md';
  await seed(path);
  const result: any = await service.qualityCheck(undefined, path, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.retry).toEqual({ endpointId: 'wiki.quality_check', reuseOriginalArguments: true, overrides: { maxChars: 12000 } });
  const expanded: any = await service.qualityCheck(undefined, path, result.retry.overrides.maxChars);
  expect(expanded.nextAction.arguments.path).toBe(path);
});

test('fully satisfied checks do not instruct an unnecessary next read', async () => {
  await seed('Specific subject.md', { llm_wiki_type: 'note' });
  const result: any = await service.qualityCheck(undefined, 'Specific subject.md', 512);
  expect(result.nextAction).toBeUndefined();
  expect(result.nextActions).toEqual([]);
  expect(result.score).toMatchObject({ passed: 1, total: 1 });
  expect(result.advisory).toBe(true);
});

test('quality rejects absolute and traversal aliases instead of emitting a wrong continuation path', async () => {
  await seed('Concept.md');
  for (const path of [join(vault, 'Concept.md'), '/Concept.md', '\\Concept.md', 'nested/../Concept.md']) {
    await expect(service.qualityCheck(undefined, path)).rejects.toThrow(/relative|traversal/i);
  }
});

test('quality resolves an authorized scope URI before producing its same-target action', async () => {
  await seed('_scopes/agents/worker/Concept.md');
  const result: any = await service.qualityCheck(principal, 'scope://agent/worker/Concept.md', 512);
  expect(result.path).toBe('scope://agent/worker/Concept.md');
  expect(result.nextAction.arguments.path).toBe(result.path);
});

test('quality normalizes authored kind and uncertainty whitespace consistently', async () => {
  await seed('Concept.md', { note_kind: ' Atomic ', knowledge_status: ' Draft ' });
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.noteKind).toBe('atomic');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'compact_projection', passed: false }));
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'evidence_or_explicit_uncertainty', passed: true }));
});

test.each([{ related: ['[[Anchor]]'] }, { primary_moc: '[[Map]]' }, { depends_on: ['Anchor.md'] }])('quality navigation recognizes Obsidian Properties: %j', async fields => {
  await seed('Concept.md', fields);
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'navigation', passed: true }));
});

test('quality ignores empty reference placeholders and fenced example links', async () => {
  await seed('Concept.md', { references: [null, '', ' ', {}, 42] }, '```md\n[[Example]]\n```\n\n~~~md\n[[Other example]]\n~~~');
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'navigation', passed: false }));
});

test.each(['```md\n# Protocol\nExample steps\n```', '~~~~md\n# Protocol\nExample\n~~~\nStill example\n~~~~', '<!--\n# Protocol\nExample steps\n-->'])('quality does not count an example protocol: %s', async body => {
  await seed('Experiment.md', { note_kind: 'experiment' }, body);
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'reproducible_protocol', passed: false }));
});

test.each(['## Protocol\n```bash\nnpm test\n```', '## Protocol\n<!--\nTODO: fill in steps\n-->', '## Protocol\n- [[]]\n\n## Other\nUnrelated text.'])('quality requires explanatory content outside placeholders and fenced examples: %s', async body => {
  await seed('Experiment.md', { note_kind: 'experiment' }, body);
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'reproducible_protocol', passed: false }));
});

test('quality recognizes Setext experiment sections and does not confuse their boundaries', async () => {
  await seed('Experiment.md', { note_kind: 'experiment', epistemic_status: 'failed' }, 'Protocol\n===\nMeasure two runs.\n\nResults\n===\nBoth failed.\n\nReproduction\n===\nRun the same input twice.');
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  for (const id of ['reproducible_protocol', 'observations_or_result', 'reproduction']) {
    expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
  }
});

test('quality does not borrow a sibling Setext section body for an empty protocol', async () => {
  await seed('Experiment.md', { note_kind: 'experiment' }, '## Protocol\n\nOther\n------\nUnrelated content.');
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'reproducible_protocol', passed: false }));
});

test.each([
  ['concept', 'Definition', 'concept_definition'],
  ['argument', 'Warrant', 'argument_warrant'],
  ['model', 'Mechanism', 'model_mechanism'],
  ['observation', 'Measurement', 'observation_method'],
  ['counterargument', 'Falsifier', 'counterargument_falsifier'],
])('quality recognizes %s role content under Setext headings', async (role, heading, id) => {
  await seed('Concept.md', { note_kind: 'atomic', knowledge_role: role }, `${heading}\n===\nCurrent explanation.`);
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
});

test('quality recognizes a requested ancestor containing a descriptive subsection', async () => {
  await seed('Experiment.md', { note_kind: 'experiment' }, '# Protocol\n## Setup\nMeasure two independent runs.');
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'reproducible_protocol', passed: true }));
});

test.each([{}, [], 42, true, '   '].map(value => [value]))('quality does not coerce malformed work Properties into useful content: %j', async value => {
  await seed('Task.md', { note_kind: 'task', desired_outcome: value, next_action: value, waiting_for: value, next_actions: [value] });
  const result: any = await service.qualityCheck(undefined, 'Task.md');
  for (const id of ['desired_outcome', 'next_action_or_waiting']) expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: false }));
});

test.each([{}, ['open'], 'invented', '  '].map(value => [value]))('quality requires a declared valid execution state: %j', async task_status => {
  await seed('Task.md', { note_kind: 'task', task_status });
  const result: any = await service.qualityCheck(undefined, 'Task.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'execution_state', passed: false }));
});

test.each([{}, [], 42, true, '   '].map(value => [value]))('quality does not mistake malformed MOC purpose/questions for authored navigation: %j', async value => {
  await seed('Map.md', { note_kind: 'moc', moc_purpose: value, moc_questions: [value] });
  const result: any = await service.qualityCheck(undefined, 'Map.md');
  for (const id of ['moc_purpose', 'moc_questions_or_links']) expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: false }));
});

test.each(['question', 'hypothesis', 'experiment', 'assumption'])('quality rejects an invented %s epistemic state', async note_kind => {
  await seed('Knowledge.md', { note_kind, epistemic_status: 'not-a-state' });
  const result: any = await service.qualityCheck(undefined, 'Knowledge.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'epistemic_status', passed: false }));
});

test('quality retains real work declarations among malformed or empty list entries', async () => {
  await seed('Task.md', { note_kind: 'task', task_status: ' Next_Action ', desired_outcome: '  Verified outcome  ', next_actions: [null, '', {}, '  Execute the experiment  '] });
  const result: any = await service.qualityCheck(undefined, 'Task.md');
  for (const id of ['desired_outcome', 'next_action_or_waiting', 'execution_state']) expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
});

test.each([['question', ' Answered '], ['hypothesis', ' Supported '], ['experiment', ' Completed '], ['assumption', ' Verified ']])('quality accepts a normalized valid %s epistemic state', async (note_kind, epistemic_status) => {
  await seed('Knowledge.md', { note_kind, epistemic_status });
  const result: any = await service.qualityCheck(undefined, 'Knowledge.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'epistemic_status', passed: true }));
});

test('quality retains meaningful MOC questions among malformed entries', async () => {
  await seed('Map.md', { note_kind: 'moc', moc_purpose: '  Guide readers  ', moc_questions: [null, {}, '', '  Where does this model fail?  '] });
  const result: any = await service.qualityCheck(undefined, 'Map.md');
  for (const id of ['moc_purpose', 'moc_questions_or_links']) expect(result.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
});

test.each(['completed', 'failed', 'reproduced'])('an array containing %s is not a valid terminal experiment state', async state => {
  await seed('Experiment.md', { note_kind: 'experiment', epistemic_status: [state] });
  const result: any = await service.qualityCheck(undefined, 'Experiment.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'epistemic_status', passed: false }));
  expect(result.checks.map((check: any) => check.id)).not.toContain('observations_or_result');
  expect(result.checks.map((check: any) => check.id)).not.toContain('reproduction');
});

test('array-wrapped uncertainty is not an explicit scalar uncertainty declaration', async () => {
  await seed('Concept.md', { note_kind: 'atomic', knowledge_status: ['draft'] });
  const result: any = await service.qualityCheck(undefined, 'Concept.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'evidence_or_explicit_uncertainty', passed: false }));
});

test('array-wrapped interpretation is not a declared literature interpretation state', async () => {
  await seed('Literature.md', { note_kind: 'literature', interpretation_status: ['interpreted'] });
  const result: any = await service.qualityCheck(undefined, 'Literature.md');
  expect(result.checks).toContainEqual(expect.objectContaining({ id: 'interpretation', passed: false }));
});
