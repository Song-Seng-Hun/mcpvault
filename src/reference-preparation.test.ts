import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { prepareKnowledgeSynthesis } from './knowledge-synthesis.js';
import { prepareKnowledgeInvestigation } from './knowledge-investigation.js';
import { KnowledgeApplicationService } from './knowledge-applications.js';
import { LlmWikiService } from './llm-wiki.js';
import type { ScopePrincipal } from './scope-auth.js';

const domains = ['synthesis', 'investigation', 'applications'] as const;
type Domain = typeof domains[number];
const actor: ScopePrincipal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' };
let root: string, fs: FileSystemService, access: ScopeAccessPolicy, refs: ReferenceService;
let a: { path: string; revision: string }, b: { path: string; revision: string };
async function note(path: string, extra: Record<string, any> = {}) {
  const result = await fs.writeNoteWithReceipt({ path, content: `# ${path}\n\n## Context\nObserved.`, frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', ...extra } });
  return { path, revision: result.revision };
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reference-preparation-')); fs = new FileSystemService(root); access = new ScopeAccessPolicy(); refs = new ReferenceService(fs, access);
  a = await note('Folder/Input.md', { aliases: ['input-alias'] }); b = await note('Folder/Other.md');
  await note('Shared.md');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

function synthesis(text = 'Question', second = 'Limitations') {
  return { question: text, inputs: [{ id: 'a', ...a }, { id: 'b', ...b }],
    explanations: ['a', 'b'].map(id => ({ id, explanation: `Explanation ${id}`, appliesWhen: 'Condition', limitations: second, basis: [id] })),
    choices: [], counterexamples: [], unresolvedQuestions: ['What remains unknown?'] };
}
function investigation(text = 'Question', second = 'Conditions') {
  return { question: text, targets: [{ ...a }], conditions: second, alternatives: ['A fits', 'B fits'],
    decisionRules: [{ observation: 'A failed', interpretation: 'challenges', consequence: 'Reassess the claim' }], executionBoundary: 'Disposable fixture only.' };
}
function applications(text = 'Environment', second = 'Conditions') {
  return [{ id: 'run', knowledge: { ...a }, environment: text, conditions: second, outcome: 'inconclusive', observed: 'Uncertain result.' }];
}
async function prepare(domain: Domain, text: string, second?: string, container = 'Folder/Record.md') {
  if (domain === 'synthesis') return prepareKnowledgeSynthesis(fs, access, synthesis(text, second), container, actor);
  if (domain === 'investigation') return prepareKnowledgeInvestigation(fs, access, investigation(text, second), container, undefined, actor);
  return new KnowledgeApplicationService(fs, access).prepare(applications(text, second), container, actor);
}

// Characterization first: these assertions run against all three original
// preparers before their duplicated implementation is extracted.
for (const domain of domains) {
  test.each([
    ['[[./Input.md]]', 'Folder/Input.md'],
    ['[[../Shared.md#Context|context]]', 'Shared.md'],
    ['[context](../Shared.md#Context)', 'Shared.md'],
    ['[[input-alias]]', 'Folder/Input.md'],
    ['[[Folder/Input.md\\|table label]]', 'Folder/Input.md'],
    ['[[Folder/Input.md#^block]]', 'Folder/Input.md'],
  ])(`${domain} preserves source-relative, alias and fragment resolution: %s`, async (text, expected) => {
    const prepared = await prepare(domain, text!);
    expect(prepared.guards).toContainEqual({ path: expected, expectedRevision: await fs.readNoteRevision(expected!) });
  });
  test.each(['[[./Missing.md]]', '[[Folder/Input%ZZ.md]]', '[[Folder%2FInput.md#^block]]', '[private](../_scopes/agents/other/Secret.md)', '[[scope://agent/other/Secret.md]]'])
  (`${domain} preserves unavailable or malformed prose denial: %s`, async text => {
    await note('Elsewhere/Missing.md');
    await expect(prepare(domain, text)).rejects.toThrow(/unavailable/i);
  });
  test(`${domain} ignores fenced examples but one field's unfinished fence cannot hide another field`, async () => {
    for (const fence of ['```', '~~~']) {
      await expect(prepare(domain, `${fence}md\n[[./Missing.md]]\n${fence}`)).resolves.toBeDefined();
      await expect(prepare(domain, `${fence}md\n[[./Missing.md]]`, '[[./Missing.md]]')).rejects.toThrow(/unavailable/i);
    }
  });
  test(`${domain} counts occurrences before deduplicating links`, async () => {
    const limit = domain === 'applications' ? 8 : 16;
    await expect(prepare(domain, '[[./Input]] '.repeat(limit))).resolves.toBeDefined();
    await expect(prepare(domain, '[[./Input]] '.repeat(limit + 1))).rejects.toThrow(/links|unavailable/i);
  });
  test(`${domain} denies hidden or ambiguous targets without adopting a hidden candidate`, async () => {
    await note('Hidden.md', { moderation_status: 'hidden' });
    await expect(prepare(domain, '[[Hidden.md]]')).rejects.toThrow(/unavailable/i);
    await note('A/Duplicate.md'); await note('B/Duplicate.md');
    await expect(prepare(domain, '[[Duplicate]]')).rejects.toThrow(/unavailable/i);
    await note('_scopes/agents/other/Private.md', { aliases: ['input-alias'] });
    expect((await prepare(domain, '[[input-alias]]')).guards.some(g => g.path.includes('Private'))).toBe(false);
  });
  test(`${domain} preserves authorized scope locators without allowing public-to-private provenance`, async () => {
    a = await note('_scopes/agents/worker/Input.md'); a.path = 'scope://agent/worker/Input.md';
    await expect(prepare(domain, 'Private context', undefined, '_scopes/agents/worker/Record.md')).resolves.toBeDefined();
    await expect(prepare(domain, 'Private context')).rejects.toThrow(/unavailable/i);
  });
}

test('shared observations retain different self-reference, historical-role and plan-result rules', async () => {
  await expect(prepareKnowledgeSynthesis(fs, access, synthesis(), a.path, actor)).rejects.toThrow(/unavailable/i);
  await expect(prepareKnowledgeInvestigation(fs, access, investigation(), a.path, undefined, actor)).rejects.toThrow(/unavailable/i);
  expect((await new KnowledgeApplicationService(fs, access).prepare(applications(), a.path, actor)).guards).toEqual([]);
  const historical = 'a'.repeat(64); const records = applications(); records[0]!.knowledge.revision = historical;
  expect((await new KnowledgeApplicationService(fs, access).prepare(records, 'Folder/Record.md', actor)).records[0]!.knowledge.revision).toBe(historical);
  a = await note(a.path, { lifecycle: 'superseded' });
  await expect(prepareKnowledgeSynthesis(fs, access, synthesis(), 'Folder/Record.md', actor)).rejects.toThrow(/historical/i);
  const old = synthesis(); (old.inputs[0] as any).role = 'historical_context';
  await expect(prepareKnowledgeSynthesis(fs, access, old, 'Folder/Record.md', actor)).resolves.toBeDefined();
  const unsaved = { ...investigation(), result: { planRevision: historical, observed: 'Failed', outcome: 'challenges', interpretation: 'Reassess', limitations: 'One run', evidence: [{ ...b }] } };
  await expect(prepareKnowledgeInvestigation(fs, access, unsaved, 'Folder/Record.md', undefined, actor)).rejects.toThrow(/plan first/i);
});

test('publication shares one metadata observation per exact related path across all three preparers', async () => {
  const wiki = new LlmWikiService(fs, access, refs);
  const source = await wiki.ingestSource({ scopeRoot: '', sourceId: 'fixture', title: 'Fixture', content: 'Source observations.', capturedBy: 'fixture' });
  const read = vi.spyOn(fs, 'readNoteMetadata');
  const prepared = await wiki.publishKnowledge({ path: 'Folder/Record.md', content: '# Interpretation', author: 'fixture', expectedRevision: 'missing',
    evidencePaths: [source.path], noteKind: 'experiment', epistemicStatus: 'planned', knowledgeApplications: applications('[[./Input]]', '[[./Input]]'),
    knowledgeSynthesis: synthesis('[[./Input]]', '[[./Input]]'), knowledgeInvestigation: investigation('[[./Input]]', '[[./Input]]'), principal: actor });
  expect(prepared.success).toBe(true);
  expect(read.mock.calls.flatMap(call => call[0]).filter(path => path === a.path)).toHaveLength(1);
  expect(read.mock.calls.flatMap(call => call[0]).filter(path => path === b.path)).toHaveLength(1);
  expect(read.mock.calls.every(call => call[2]?.fresh === true && call[2]?.strict === true && call[2]?.maxBytes === 8 * 1024 * 1024)).toBe(true);
});

test('shared metadata cache hits recheck caller ACL and never carry observations across requests', async () => {
  const read = (refs as any).createMetadataReader(actor);
  const metadata = vi.spyOn(fs, 'readNoteMetadata'); let allowed = true;
  expect(await read(a.path, () => allowed)).toMatchObject({ revision: a.revision });
  allowed = false; expect(await read(a.path, () => allowed)).toBeUndefined();
  expect(metadata).toHaveBeenCalledTimes(1);
  a = await note(a.path, { aliases: ['changed'] });
  expect(await (refs as any).createMetadataReader(actor)(a.path, () => true)).toMatchObject({ revision: a.revision });
  expect(metadata).toHaveBeenCalledTimes(2);
});

test('shared cache hits recheck scope authorization even when the caller predicate still allows the path', async () => {
  const read = refs.createMetadataReader(actor), metadata = vi.spyOn(fs, 'readNoteMetadata');
  expect(await read(a.path, () => true)).toMatchObject({ revision: a.revision });
  vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
  expect(await read(a.path, () => true)).toBeUndefined(); expect(metadata).toHaveBeenCalledTimes(1);
});

test('metadata reuse cannot bypass normalized duplicate-input decisions', async () => {
  const syn = synthesis(); syn.inputs[1] = { id: 'b', path: 'scope://global/Folder/Input.md', revision: a.revision };
  await expect(prepareKnowledgeSynthesis(fs, access, syn, 'Folder/Record.md', actor)).rejects.toThrow(/duplicate/i);
  const inv = investigation(); inv.targets.push({ path: 'scope://global/Folder/Input.md', revision: a.revision });
  await expect(prepareKnowledgeInvestigation(fs, access, inv, 'Folder/Record.md', undefined, actor)).rejects.toThrow(/unavailable/i);
});

test('shared publication observations never cache permission across the actual guarded dispatch', async () => {
  const wiki = new LlmWikiService(fs, access, refs);
  const source = await wiki.ingestSource({ scopeRoot: '', sourceId: 'fixture', title: 'Fixture', content: 'Source observations.', capturedBy: 'fixture' });
  const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs), canAccess = access.canAccessPhysicalPath.bind(access); let revoked = false;
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (args[0].path === 'Folder/Record.md' && !revoked) {
      revoked = true; vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => path !== a.path && canAccess(path, principal));
    }
    return write(...args);
  });
  await expect(wiki.publishKnowledge({ path: 'Folder/Record.md', content: '# Interpretation', author: 'fixture', expectedRevision: 'missing',
    evidencePaths: [source.path], knowledgeApplications: applications('[[./Input]]'), knowledgeSynthesis: synthesis('[[./Input]]'), principal: actor })).rejects.toThrow(/unavailable|denied/i);
  expect(revoked).toBe(true); expect(await fs.noteExists('Folder/Record.md')).toBe(false);
});

test('shared publication observations still fail the actual guarded write after dependency drift', async () => {
  const wiki = new LlmWikiService(fs, access, refs);
  const source = await wiki.ingestSource({ scopeRoot: '', sourceId: 'fixture', title: 'Fixture', content: 'Source observations.', capturedBy: 'fixture' });
  const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs); let injected = false;
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (args[0].path === 'Folder/Record.md' && !injected) { injected = true; await writeFile(join(root, a.path), 'Concurrent edit'); }
    return write(...args);
  });
  await expect(wiki.publishKnowledge({ path: 'Folder/Record.md', content: '# Interpretation', author: 'fixture', expectedRevision: 'missing',
    evidencePaths: [source.path], knowledgeApplications: applications('[[./Input]]'), knowledgeSynthesis: synthesis('[[./Input]]'), principal: actor })).rejects.toThrow(/revision|conflict|changed/i);
  expect(injected).toBe(true); expect(await fs.noteExists('Folder/Record.md')).toBe(false);
});
