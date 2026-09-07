import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { organizationNoteTemplate, organizationLintIssues, getOrganizationPropertyContract } from './organization.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'conditional-synthesis-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy(); wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function fixture(prefix = '') {
  const source = await wiki.ingestSource({ scopeRoot: '', sourceId: 'evidence', title: 'Observations', content: 'Different environments permit different results.', capturedBy: 'test' });
  const inputs = [];
  for (const id of ['a', 'b']) {
    const path = `${prefix}${id}.md`;
    const receipt = await fs.writeNoteWithReceipt({ path, content: `# ${id}\n\nOriginal explanation ${id}`, frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', domain: 'cache', evidence_paths: [source.path] } });
    inputs.push({ id, path, revision: receipt.revision });
  }
  const knowledgeSynthesis = {
    question: 'Which option fits each environment?', inputs,
    explanations: inputs.map(({ id }) => ({ id, explanation: `Explanation ${id}`, appliesWhen: `Environment ${id}`, limitations: 'No claim about other environments.', basis: [id] })),
    choices: inputs.map(({ id }) => ({ when: `Environment ${id}`, explanationId: id, basis: [id], reason: `Observation ${id}` })),
    counterexamples: [{ description: 'Opposite behavior in the second environment.', basis: ['b'] }], unresolvedQuestions: ['Other environments?'],
  };
  return { source, knowledgeSynthesis, publish: { path: 'Synthesis.md', content: '# Conditional interpretation\n\nPreserve both explanations.', evidencePaths: [source.path], author: 'test', expectedRevision: 'missing', knowledgeSynthesis } };
}
test('existing publication persists conditional synthesis and preserves every original', async () => {
  const f = await fixture();
  const result = await wiki.publishKnowledge(f.publish);
  const written = await fs.readNote(result.path);
  expect(written.frontmatter.knowledge_synthesis).toEqual(f.knowledgeSynthesis);
  expect(written.frontmatter.created_by).toBe('test');
  for (const input of f.knowledgeSynthesis.inputs) expect(await fs.readNoteRevision(input.path)).toBe(input.revision);
});
test('a stale input refuses publication instead of updating its recorded revision', async () => {
  const f = await fixture(); await fs.writeNote({ path: 'a.md', content: 'Changed premise' });
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/input.*unavailable|changed|revision/i);
  expect(await fs.noteExists('Synthesis.md')).toBe(false);
});
test('concurrent input edits fail the existing guarded publication transaction', async () => {
  const f = await fixture(); const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    await writeFile(join(root, 'b.md'), 'Changed outside MCP'); return write(...args);
  });
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/revision|conflict/i);
  expect(await fs.noteExists('Synthesis.md')).toBe(false);
});
test('rejects Community inputs in a Global interpretation but allows the same Community destination', async () => {
  const f = await fixture('Community/');
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/unavailable/i);
  const result = await wiki.publishKnowledge({ ...f.publish, path: 'Community/Synthesis.md' });
  expect((await fs.readNote('Community/Synthesis.md')).frontmatter.knowledge_synthesis.inputs).toHaveLength(2);
  expect(result.success).toBe(true);
});
test('refuses private links in explanatory prose and unknown support', async () => {
  const f = await fixture();
  f.knowledgeSynthesis.explanations[0]!.explanation = 'Copy [[_scopes/agent/secret/Private]]';
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/unavailable/i);
  f.knowledgeSynthesis.explanations[0]!.explanation = 'Normal';
  f.knowledgeSynthesis.choices[0]!.basis = ['unknown'];
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/basis/i);
});
test('Decision Record uses the same synthesis contract and input guards', async () => {
  const f = await fixture();
  const result = await wiki.publishDecisionRecord({ ...f.publish, title: 'Choose by environment', context: 'Both observations matter.', decision: 'Use A in condition A and B in condition B.' });
  expect((await fs.readNote('Synthesis.md')).frontmatter.knowledge_synthesis).toEqual(f.knowledgeSynthesis);
  expect(result.success).toBe(true);
});
test('omitting the record keeps old input pins but does not silently refresh a changed basis', async () => {
  const f = await fixture(); const first = await wiki.publishKnowledge(f.publish);
  await fs.writeNote({ path: 'a.md', content: 'New premise' });
  const { knowledgeSynthesis: _omitted, ...publish } = f.publish;
  const edited = await wiki.publishKnowledge({ ...publish, content: '# Revised wording only', expectedRevision: first.revision });
  expect((await fs.readNote(edited.path)).frontmatter.knowledge_synthesis).toEqual(f.knowledgeSynthesis);
});

test('candidate worksheets use current inputs, preserve scope boundaries and offer the existing writer', async () => {
  await fixture();
  for (const id of ['c', 'd']) await fs.writeNote({ path: `Community/${id}.md`, content: id, frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', domain: 'cache' } });
  const result = await wiki.synthesisCandidates(undefined, 10, 16000);
  expect(result.items).toHaveLength(2);
  const local: any = result.items.find((item: any) => item.suggestedPath.startsWith('Community/'));
  expect(local.readOrder.every((item: any) => item.path.startsWith('Community/'))).toBe(true);
  expect(local.worksheet).toMatchObject({ field: 'knowledgeSynthesis', required: expect.arrayContaining(['question', 'explanations', 'choices', 'counterexamples', 'unresolvedQuestions']) });
  expect(local.worksheet.inputs.every((input: any) => /^[a-f0-9]{64}$/.test(input.revision))).toBe(true);
  expect(local.worksheet.publishEndpoint).toBe('mcp.publish_knowledge');
});
test('an existing pinned synthesis is reused and input drift is reported without duplicate publication', async () => {
  const f = await fixture();
  await wiki.publishKnowledge({ ...f.publish, domain: 'cache' });
  await fs.writeNote({ path: 'a.md', content: 'The original condition changed.', frontmatter: (await fs.readNote('a.md')).frontmatter });
  const result = await wiki.synthesisCandidates(undefined, 10, 12000);
  const item: any = result.items[0];
  expect(item).toMatchObject({ mode: 'extend_existing_synthesis', suggestedPath: 'Synthesis.md', uncoveredInputTotal: 0, synthesisBasis: { state: 'inputs_changed' } });
  expect(item.synthesisBasis.changedInputIds).toContain('a');
  expect(item.worksheet.publishArguments).toMatchObject({ path: 'Synthesis.md', expectedRevision: await fs.readNoteRevision('Synthesis.md') });
  expect(await fs.readNoteRevision('b.md')).toBe(f.knowledgeSynthesis.inputs[1]!.revision);
});
test('a tiny candidate response fits its entire envelope and points to the omitted candidate', async () => {
  await fixture(); const result: any = await wiki.synthesisCandidates(undefined, 10, 768);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(768);
  expect(result.items).toEqual([]); expect(result.truncated).toBe(true);
  expect(result.nextAction).toMatchObject({ endpointId: 'wiki.synthesis_candidates', arguments: { focusPath: 'a.md', limit: 1, maxChars: 16000 } });
});
test('a last-read access revocation discards all candidate details', async () => {
  await fixture(); const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const revision = await read(...args); vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return revision;
  });
  await expect(wiki.synthesisCandidates(undefined, 10, 12000)).rejects.toThrow(/unavailable|changed/i);
});
test('permission revoked after preparation cannot pass the guarded write', async () => {
  const f = await fixture(); const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    const allowed = access.canAccessPhysicalPath.bind(access);
    vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => path !== 'a.md' && allowed(path, principal));
    return write(...args);
  });
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/unavailable|denied/i);
  expect(await fs.noteExists('Synthesis.md')).toBe(false);
});
test('template and Properties expose an interpretation contract without changing note kinds', () => {
  const template = organizationNoteTemplate('synthesis');
  expect(template.properties).toMatchObject({ note_kind: 'knowledge', knowledge_role: 'model' });
  expect(template.markdown).toContain('Competing explanations');
  expect(template.markdown).toContain('Counterexamples');
  expect(getOrganizationPropertyContract()).toContainEqual(expect.objectContaining({ name: 'knowledge_synthesis', type: 'object' }));
  expect(organizationLintIssues('Synthesis.md', { llm_wiki_type: 'knowledge', knowledge_synthesis: { verified: true } }).map(x => x.code)).toContain('invalid_knowledge_synthesis');
});
test('synthesis candidates preserve the authored grouping in publication arguments and formatted budgets', async () => {
  await fixture();
  const result: any = await wiki.synthesisCandidates(undefined, 10, 4000, { prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(4000);
  const larger: any = await wiki.synthesisCandidates(undefined, 10, 12000, { prettyPrint: true });
  expect(larger.items[0].worksheet.publishArguments).toMatchObject({ domain: 'cache' });
});
test('retired knowledge is usable only as explicitly marked historical context, not an active premise', async () => {
  const f = await fixture(); const prior = await fs.readNote('a.md');
  const retired = await fs.writeNoteWithReceipt({ path: 'a.md', content: prior.content, frontmatter: { ...prior.frontmatter, lifecycle: 'superseded' } });
  f.knowledgeSynthesis.inputs[0]!.revision = retired.revision;
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/historical|retired/i);
  (f.knowledgeSynthesis.inputs[0] as any).role = 'historical_context';
  const result = await wiki.publishKnowledge(f.publish);
  expect((await fs.readNote(result.path)).frontmatter.knowledge_synthesis.inputs[0].role).toBe('historical_context');
});
test('a counterpoint outside the first eight authored entries is freshly checked before exposure', async () => {
  await fixture();
  for (let i = 0; i < 9; i++) await fs.writeNote({ path: `extra-${i}.md`, content: `input${i}`, frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', domain: 'cache', nav_order: i, ...(i === 8 && { knowledge_polarity: 'negative' }) } });
  const read = fs.readNoteMetadata.bind(fs); let changed = false;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    if (args[2]?.fresh && !changed) {
      changed = true; const note = await fs.readNote('extra-8.md');
      await fs.writeNote({ path: 'extra-8.md', content: note.content, frontmatter: { ...note.frontmatter, moderation_status: 'hidden' } });
    }
    return read(...args);
  });
  await expect(wiki.synthesisCandidates(undefined, 1, 16000)).rejects.toThrow(/unavailable|changed/i);
});
test('the guarded writer rechecks permission again at actual write dispatch', async () => {
  const f = await fixture();
  const check = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw Error('Access denied at dispatch'); });
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'No.md', content: 'No', expectedRevision: 'missing' },
    f.knowledgeSynthesis.inputs.map(input => ({ path: input.path, expectedRevision: input.revision })), { assertAccess: check })).rejects.toThrow(/denied/);
  expect(check).toHaveBeenCalledTimes(2); expect(await fs.noteExists('No.md')).toBe(false);
});
test.each(['archive', 'delete', 'regroup'])('existing basis remains inspectable after input %s', async operation => {
  const f = await fixture(); await wiki.publishKnowledge({ ...f.publish, domain: 'cache' });
  const input = await fs.readNote('a.md');
  if (operation === 'delete') await rm(join(root, 'a.md'));
  else await fs.writeNote({ path: 'a.md', content: input.content, frontmatter: { ...input.frontmatter, ...(operation === 'archive' ? { lifecycle: 'archived' } : { domain: 'other' }) } });
  const result = await wiki.synthesisCandidates(undefined, 10, 12000, { focusPath: 'b.md' });
  const item: any = result.items[0];
  expect(item).toMatchObject({ mode: 'extend_existing_synthesis', existingSynthesis: { path: 'Synthesis.md' } });
  expect(item.synthesisBasis.state).toBe(operation === 'delete' ? 'inputs_unavailable' : 'inputs_changed');
});
test('a maximal long-path candidate still provides usable context instead of retrying the same empty page', async () => {
  const folder = Array.from({ length: 4 }, (_, i) => `${i}${'f'.repeat(89)}`).join('/');
  for (let i = 0; i < 8; i++) await fs.writeNote({ path: `${folder}/${i}${'n'.repeat(108)}.md`, content: 'Context', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', domain: 'long-path' } });
  const result: any = await wiki.synthesisCandidates(undefined, 1, 16000);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].readOrder.length).toBeGreaterThanOrEqual(2);
  expect(result.items[0].worksheet.inputs).toHaveLength(result.items[0].readOrder.length);
});
test.each(['lifecycle', 'knowledge_status', 'decision_status'])('normalizes whitespace in historical %s', async field => {
  const f = await fixture(); const before = await fs.readNote('a.md');
  const updated = await fs.writeNoteWithReceipt({ path: 'a.md', content: before.content, frontmatter: { ...before.frontmatter, [field]: ' SUPERSEDED ' } });
  f.knowledgeSynthesis.inputs[0]!.revision = updated.revision;
  await expect(wiki.publishKnowledge(f.publish)).rejects.toThrow(/historical/i);
});
test('an extreme formatted candidate advances to an exact original read rather than a same-budget retry loop', async () => {
  const folder = Array.from({ length: 4 }, (_, i) => `${i}${'f'.repeat(89)}`).join('/');
  const paths = Array.from({ length: 16 }, (_, i) => `${folder}/${i}${'n'.repeat(106)}.md`);
  for (let i = 0; i < paths.length; i++) await fs.writeNote({ path: paths[i]!, content: 'Context', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', domain: 'big', nav_order: i, ...(i >= 8 && { knowledge_polarity: 'negative', contradicts: paths.slice(0, 8) }) } });
  const result: any = await wiki.synthesisCandidates(undefined, 1, 16000, { prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(16000);
  if (!result.items.length) {
    expect(result.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: paths[0], expectedRevision: await fs.readNoteRevision(paths[0]!) } });
  } else expect(result.items[0].readOrder.length).toBeGreaterThan(0);
});
test('a legacy output cannot hide a structured synthesis, and explicit output focus wins', async () => {
  const f = await fixture(); await wiki.publishKnowledge({ ...f.publish, domain: 'cache' });
  await fs.writeNote({ path: 'A-decision.md', content: 'Legacy decision', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'decision', domain: 'cache', references: ['a.md', 'b.md'] } });
  const a = await fs.readNote('a.md');
  await fs.writeNote({ path: 'a.md', content: a.content, frontmatter: { ...a.frontmatter, lifecycle: 'archived' } });
  for (const focusPath of [undefined, 'Synthesis.md']) {
    const result: any = await wiki.synthesisCandidates(undefined, 10, 12000, { focusPath });
    expect(result.items[0]).toMatchObject({ existingSynthesis: { path: 'Synthesis.md' }, synthesisBasis: { state: 'inputs_changed' } });
  }
  const legacy: any = await wiki.synthesisCandidates(undefined, 10, 12000, { focusPath: 'A-decision.md' });
  expect(legacy.items[0].existingSynthesis.path).toBe('A-decision.md');
});
test('combined synthesis and experience share one related-note budget with an actionable pre-write error', async () => {
  const f = await fixture();
  const knowledgeApplications = [];
  for (let i = 0; i < 8; i++) {
    const path = `Run-${i}.md`, receipt = await fs.writeNoteWithReceipt({ path, content: 'Applied knowledge', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic' } });
    knowledgeApplications.push({ id: `use-${i}`, knowledge: { path, revision: receipt.revision }, environment: 'Fixture', conditions: 'One environment', observed: 'One observation', outcome: 'inconclusive' });
  }
  const write = vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt');
  await expect(wiki.publishKnowledge({ ...f.publish, knowledgeApplications })).rejects.toThrow(/combined.*eight/i);
  expect(write).not.toHaveBeenCalled(); expect(await fs.noteExists('Synthesis.md')).toBe(false);
  // The same explicit input can be applied and synthesized without consuming
  // two slots, and a valid bounded combination still uses one writer.
  knowledgeApplications.splice(6);
  for (const input of f.knowledgeSynthesis.inputs) knowledgeApplications.push({ ...knowledgeApplications[0]!, id: `shared-${input.id}`, knowledge: { path: input.path, revision: input.revision } });
  const result = await wiki.publishKnowledge({ ...f.publish, knowledgeApplications });
  const note = await fs.readNote(result.path);
  expect(note.frontmatter.knowledge_applications).toHaveLength(8);
  expect(note.frontmatter.knowledge_synthesis.inputs).toHaveLength(2);
});
