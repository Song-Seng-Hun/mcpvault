import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { CompilationService } from './compilation-service.js';
import type { CompilationHost } from './compilation-host.js';
import type { CompilationConfig } from './compilation-policy.js';
import { DocumentPolicyStore } from './document-policy-store.js';
import { DocumentAuthority } from './document-authority.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, durable: any, host: CompilationHost, config: CompilationConfig;
const actor = { accountId: 'operator', modelId: 'test', role: 'agent' as const, agentId: 'worker', capabilities: ['write', 'publish'] as any };
let current: typeof actor | undefined;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
let locked: boolean, saves: number;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy(); durable = undefined; locked = false; saves = 0; current = actor;
  config = { version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', ruleVersion: '1',
    sources: ['Source.md', 'Concept.md'].map(path => ({ path, classification: 'resolved', mode: 'synthesis_allowed' })),
    outputPaths: ['Result.md'], runtimeIds: ['local'], operations: ['synthesize', 'index'] }] };
  host = { refresh: async () => structuredClone(config), readState: async () => structuredClone(durable),
    writeState: async value => { if (!locked) throw Error('lease missing'); durable = structuredClone(value); saves++; },
    acquire: async () => { if (locked) throw Error('lease busy'); locked = true;
      return { assertHeld: async () => { if (!locked || !config.enabled) throw Error('lease revoked'); }, close: async () => { locked = false; } }; } };
  await seed('Source.md', '---\nllm_wiki_type: source\n---\nOnly if enabled, use version 2.0.');
  await seed('Concept.md', '---\nllm_wiki_type: knowledge\n---\nShared concept.');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, body: string) { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), body); }
function service(extra: Record<string, unknown> = {}) {
  return new CompilationService({ fs, access, host, authorize: async () => current,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['synthesize', 'index'] }), ...extra } as any);
}
async function request() {
  return { op: 'prepare', requestId: 'job-one', projectId: 'p', operation: 'synthesize',
    inputs: [{ path: 'Source.md', expectedRevision: await fs.readNoteRevision('Source.md'), role: 'source' },
      { path: 'Concept.md', expectedRevision: await fs.readNoteRevision('Concept.md'), role: 'concept' }],
    outputPath: 'Result.md', expectedOutputRevision: 'missing' };
}
const readJob = (s: CompilationService, requestId = 'job-one', maxChars = 4000) => s.execute({ op: 'read', requestId, maxChars }, actor);

async function observation(kind: 'source_only' | 'already_covered' = 'source_only') {
  const source = await fs.readNote('Source.md');
  const locator = { revision: source.revision, startLine: 1, endLine: 1, quoteHash: digest(source.content) };
  const knowledge = await fs.readNote('Concept.md');
  return { kind, reason: 'Agent assessment of the pinned source; not a truth score.',
    coverage: [{ sourcePath: 'Source.md', locator }], ...(kind === 'already_covered' && {
      query: 'enabled', matches: [{ sourcePath: 'Source.md', sourceLocator: locator, knowledgePath: 'Concept.md',
        knowledgeLocator: { revision: knowledge.revision, startLine: 1, endLine: 1, quoteHash: digest(knowledge.content) },
        semanticJudgment: 'covered' }] }) };
}

test.each(['source_only', 'already_covered'] as const)('%s completion records verification without a draft, publication intent or output write', async kind => {
  const impl = { ...adapter(), checkObservation: async () => ({ status: 'passed', ruleVersion: 'observation-v1' }) };
  const apply = vi.spyOn(impl, 'apply'), s = service({ adapter: impl });
  const input = await request(); input.operation = kind === 'source_only' ? 'index' : 'synthesize';
  input.inputs[1]!.role = 'member';
  const ready = await s.execute(input, actor);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    observation: await observation(kind) } as any, actor);
  expect(submitted.status).toBe('generated'); expect(durable.jobs[0].draft).toBeUndefined();
  const done = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  expect(done).toMatchObject({ status: 'completed', outcome: kind, wroteOutput: false });
  expect(done.verification).toEqual({ mechanical: 'passed', semantic: kind === 'already_covered' ? 'agent_report' : 'not_assessed' });
  expect(done).not.toHaveProperty('outputRevision');
  expect(durable.jobs[0].noWriteReceipt.kind).toBe(kind);
  for (const key of ['draft', 'intent', 'applied', 'receipt']) expect(durable.jobs[0][key]).toBeUndefined();
  expect(await fs.noteExists('Result.md')).toBe(false); expect(apply).not.toHaveBeenCalled();
  const count = saves, restarted = service({ adapter: impl });
  expect(await readJob(restarted)).toEqual(done);
  expect(await restarted.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: done.jobRevision }, actor)).toEqual(done);
  expect(saves).toBe(count);
  await seed('Source.md', 'Changed source.');
  expect((await readJob(restarted)).status).toBe('review_required');
});

test('interrupted no-write completion requires durable verification on retry and cannot call publication', async () => {
  const impl = { ...adapter(), checkObservation: async () => ({ status: 'passed', ruleVersion: 'observation-v1' }) };
  const apply = vi.spyOn(impl, 'apply'), s = service({ adapter: impl });
  const ready = await s.execute({ ...await request(), operation: 'index' }, actor);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    observation: await observation() } as any, actor);
  const save = host.writeState; let interrupted = false;
  host.writeState = async value => {
    if (!interrupted && (value as any).jobs[0].status === 'completed') { interrupted = true; throw Error('Receipt storage interrupted'); }
    await save(value);
  };
  await expect(s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor)).rejects.toThrow();
  expect(durable.jobs[0].noWriteReceipt).toBeUndefined();
  const restarted = service({ adapter: impl }), checked = await readJob(restarted);
  expect(checked.status).toBe('checked');
  const done = await restarted.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: checked.jobRevision }, actor);
  expect(done.status).toBe('completed'); expect(apply).not.toHaveBeenCalled();
  current = undefined; await expect(readJob(restarted)).rejects.toThrow('Compilation unavailable');
});

test.each(['content', 'operation', 'unlisted', 'stale_locator', 'unknown_field'] as const)('no-write observation rejects %s without storing report bytes', async mode => {
  const s = service(), ready = await s.execute({ ...await request(), operation: 'index' }, actor);
  const report: any = await observation();
  if (mode === 'operation') report.kind = 'already_covered';
  if (mode === 'unlisted') report.coverage[0].sourcePath = 'Unlisted.md';
  if (mode === 'stale_locator') report.coverage[0].locator.revision = digest('old');
  if (mode === 'unknown_field') report.approved = true;
  const count = saves;
  await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    observation: report, ...(mode === 'content' && { content: 'Do not combine with synthesis.' }) }, actor)).rejects.toThrow();
  expect(saves).toBe(count); expect(durable.jobs[0].observation).toBeUndefined();
});

test.each(['absent_checker', 'partial_checker'] as const)('no-write %s never becomes completed or calls publication', async mode => {
  const impl = { ...adapter(), ...(mode === 'partial_checker' && { checkObservation: async () => ({ status: 'partial', ruleVersion: 'observation-v1' }) }) };
  const apply = vi.spyOn(impl, 'apply'), s = service({ adapter: impl });
  const prepared = await s.execute({ ...await request(), operation: 'index' }, actor);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: prepared.jobRevision,
    observation: await observation() }, actor);
  const result = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  expect(result.status).toBe('partial'); expect(durable.jobs[0].noWriteReceipt).toBeUndefined();
  expect(apply).not.toHaveBeenCalled(); const count = saves;
  await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor); expect(saves).toBe(count);
});

test('tampered no-write receipt or attribution fails closed and preserves durable history', async () => {
  const s = service({ adapter: { ...adapter(), checkObservation: async () => ({ status: 'passed', ruleVersion: 'observation-v1' }) } });
  const prepared = await s.execute({ ...await request(), operation: 'index' }, actor);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: prepared.jobRevision,
    observation: await observation() }, actor);
  await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  const valid = structuredClone(durable);
  for (const mode of ['receipt', 'attribution', 'publication']) {
    durable = structuredClone(valid);
    if (mode === 'receipt') durable.jobs[0].noWriteReceipt.basis = digest('tampered');
    if (mode === 'attribution') durable.jobs[0].observation.reason = 'Different assessment';
    if (mode === 'publication') durable.jobs[0].draft = { content: 'Smuggled draft', fingerprint: digest('Smuggled draft') };
    const count = saves; await expect(readJob(s)).rejects.toThrow(/history unavailable/);
    expect(saves).toBe(count);
  }
});

test('no host configuration means diagnosis only and no durable state or source writes', async () => {
  const s = service({ host: undefined });
  expect(await s.execute(await request(), actor)).toMatchObject({ status: 'diagnostic_only' });
  expect(durable).toBeUndefined(); expect(await fs.noteExists('Result.md')).toBe(false);
});

test('review projections expose attributed omissions and current revisions without draft bodies or writes', async () => {
  const s = service(), ready = await s.execute(await request(), actor), content = 'Private generated draft.';
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    content, evidence: await preservationEvidence(content) }, actor);
  const count = saves;
  const findings = await (s as any).review(actor, ['Source.md']);
  expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Source.md', code: 'compilation_evidence_missing',
    basis: submitted.jobRevision, attribution: 'agent_report', nextAction: expect.objectContaining({ endpointId: 'wiki.compilation' }) })]));
  expect(JSON.stringify(findings)).not.toContain(content); expect(saves).toBe(count);
  expect(findings[0].affectedEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Concept.md', revision: await fs.readNoteRevision('Concept.md') })]));
  expect(await (s as any).review(actor, ['Unrelated.md'])).toEqual([]);
  await seed('Result.md', 'Human edit.');
  expect(await (s as any).review(actor)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'compilation_manual_edit_conflict' })]));
});

test('review never exposes counts, paths or titles of revoked, hidden or other-account jobs', async () => {
  const s = service(); await s.execute(await request(), actor); const count = saves;
  current = undefined; expect(await (s as any).review(actor)).toEqual([]); current = actor;
  await seed('Source.md', 'Changed source.'); await seed('Concept.md', '---\nmoderation_status: hidden\n---\nHidden later input.');
  expect(await (s as any).review(actor)).toEqual([]);
  expect(await (s as any).review({ ...actor, accountId: 'other' })).toEqual([]);
  expect(await (s as any).review(undefined)).toEqual([]); expect(saves).toBe(count);
});

test('plan pins input revisions, shared contract/rules, authority and output before any body; duplicate request is read-only', async () => {
  const s = service(), input = await request();
  const first = await s.execute(input, actor), count = saves;
  expect(first).toMatchObject({ status: 'prepared', requestId: 'job-one' });
  expect(first.jobRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(durable.jobs[0]).toMatchObject({ ruleVersion: '1', graphContractVersion: 1, outputRevision: 'missing' });
  expect(durable.jobs[0].authorityFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(durable)).not.toContain('Only if');
  expect(await s.execute(input, actor)).toEqual(first); expect(saves).toBe(count);
  await expect(s.execute({ ...input, outputPath: 'Other.md' }, actor)).rejects.toThrow();
});

test('stale caller revision, hidden/missing input and unmanaged existing output never become a managed job', async () => {
  const s = service(), input = await request();
  await expect(s.execute({ ...input, inputs: [{ ...input.inputs[0], expectedRevision: '0'.repeat(64) }] }, actor)).rejects.toThrow();
  await seed('Result.md', 'User-authored knowledge.');
  const result = await s.execute({ ...input, expectedOutputRevision: await fs.readNoteRevision('Result.md') }, actor);
  expect(result.status).toBe('review_required');
  expect(durable).toBeUndefined(); expect(await readFile(join(vault, 'Result.md'), 'utf8')).toBe('User-authored knowledge.');
});

test('submission is revision-checked, persisted privately and never called completion', async () => {
  const s = service(), ready = await s.execute(await request(), actor);
  const content = '# Result\nOnly if enabled, use version 2.0.';
  await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: '0'.repeat(64), content }, actor)).rejects.toThrow();
  const result = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content }, actor);
  expect(result.status).toBe('generated'); expect(durable.jobs[0].draft.content).toBe(content);
  expect(durable.jobs[0].draft.fingerprint).toBe(digest(content)); expect(await fs.noteExists('Result.md')).toBe(false);
  expect(JSON.stringify(result)).not.toContain('Only if');
});

async function preservationEvidence(content: string, judgment = 'missing') {
  const source = await fs.readNote('Source.md');
  return { query: 'Only if enabled', decision: 'new_knowledge', facts: [{ id: 'condition', kind: 'condition', sourcePath: 'Source.md',
    sourceLocator: { revision: source.revision, startLine: 1, endLine: 1, quoteHash: digest(source.content) },
    outputLocator: { revision: digest(content), startLine: 1, endLine: 1, quoteHash: digest(content) },
    comparisonMode: 'exact', semanticJudgment: judgment }],
    coverage: [{ sourcePath: 'Source.md', locator: { revision: source.revision, startLine: 1, endLine: 1, quoteHash: digest(source.content) } }] };
}
test('explicit inspection resumes pinned preservation obligations without returning the draft body', async () => {
  const s = service(), ready = await s.execute(await request(), actor), content = 'Private generated draft: use version 2.0.';
  await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    content, evidence: await preservationEvidence(content) }, actor);
  const count = saves;
  const result = await s.execute({ op: 'read', requestId: 'job-one', includeInspection: true, maxChars: 4000 } as any, actor);
  expect(result.inspection.attribution).toBe('agent_report');
  expect(result.inspection.records).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'fact', id: 'condition',
    sourcePath: 'Source.md', semanticJudgment: 'missing', sourceLocator: expect.objectContaining({ revision: await fs.readNoteRevision('Source.md') }) })]));
  expect(JSON.stringify(result)).not.toContain(content); expect(saves).toBe(count);
});
test('inspection pagination is bounded, revision-pinned and never silently loses checkpoints', async () => {
  const s = service(), ready = await s.execute(await request(), actor), content = 'Use version 2.0.';
  const evidence = await preservationEvidence(content);
  evidence.coverage = Array.from({ length: 40 }, () => structuredClone(evidence.coverage[0]!));
  await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content, evidence }, actor);
  let params: any = { op: 'read', requestId: 'job-one', includeInspection: true, maxChars: 2000 }, checkpoints = 0;
  const count = saves;
  for (let page = 0; page < 50; page++) {
    const result = await s.execute(params, actor); expect(JSON.stringify(result).length).toBeLessThanOrEqual(params.maxChars);
    expect(result.inspection).toBeDefined();
    checkpoints += result.inspection.records.filter((r: any) => r.type === 'checkpoint').length;
    if (!result.partial) break;
    expect(result.nextAction.arguments.expectedJobRevision).toBe(result.jobRevision);
    expect(result.nextAction.arguments.inspectionCursor).toBeGreaterThan(params.inspectionCursor ?? 0);
    params = { ...result.nextAction.arguments, maxChars: 2000 };
  }
  expect(checkpoints).toBe(40); expect(saves).toBe(count);
  await expect(s.execute({ ...params, expectedJobRevision: digest('stale inspection') }, actor)).rejects.toThrow();
});

test('bounded decision rationale remains an attributed agent report across inspection and restart', async () => {
  const s = service(), ready = await s.execute(await request(), actor), content = 'Use version 2.0.';
  const evidence = { ...await preservationEvidence(content), rationale: { constraints: ['No external provider.'],
    rejectedAlternatives: [{ option: 'Cloud fallback', reason: 'Source policy forbids it.' }], failureConditions: ['Runtime authorization revoked.'] } };
  await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content, evidence }, actor);
  const result = await service().execute({ op: 'read', requestId: 'job-one', includeInspection: true, maxChars: 12000 }, actor);
  expect(result.inspection.records).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'assessment',
    rationale: evidence.rationale, attribution: 'agent_report' })]));
});
test('persists required source facts privately and allows one checked-partial refinement with unchanged preservation obligations', async () => {
  const s = service({ adapter: { check: async () => ({ status: 'partial', ruleVersion: 'fidelity-v1' }) } });
  const ready = await s.execute(await request(), actor);
  const content = 'Use version 2.0.', evidence = await preservationEvidence(content);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content, evidence } as any, actor);
  expect(durable.jobs[0].evidence).toEqual(evidence); expect(durable.jobs[0].draft.generatedAt).toMatch(/^\d{4}-/);
  expect(JSON.stringify(submitted)).not.toContain('Only if enabled');
  const checked = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  const refined = 'Only if enabled, use version 2.0.';
  const second = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: checked.jobRevision,
    content: refined, evidence: await preservationEvidence(refined, 'preserved') } as any, actor);
  expect(second.status).toBe('generated'); expect(durable.jobs[0].refinements).toBe(1);
  expect(durable.jobs[0].validation).toBeUndefined();
  const checkedAgain = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: second.jobRevision }, actor);
  await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: checkedAgain.jobRevision,
    content: refined + ' Again.', evidence: await preservationEvidence(refined + ' Again.') } as any, actor)).rejects.toThrow();
});

test('tiny inspection retries the same checkpoint with a larger budget and no draft exposure', async () => {
  const s = service(), input = { ...await request(), requestId: 'j'.repeat(100) };
  const ready = await s.execute(input, actor), content = 'Private draft 🧪 한글.';
  await s.execute({ op: 'submit', requestId: input.requestId, expectedJobRevision: ready.jobRevision,
    content, evidence: await preservationEvidence(content) }, actor);
  const page = await s.execute({ op: 'read', requestId: input.requestId, includeInspection: true, maxChars: 512 }, actor);
  expect(JSON.stringify(page).length).toBeLessThanOrEqual(512); expect(page.partial).toBe(true);
  expect(page.nextAction.arguments.inspectionCursor).toBe(0);
  const resumed = await s.execute(page.nextAction.arguments, actor);
  expect(resumed.inspection.records.some((r: any) => r.type === 'fact')).toBe(true);
  expect(JSON.stringify(resumed)).not.toContain(content);
});

test('inspection rejects an unpinned or invalid cursor without journal writes', async () => {
  const s = service(), ready = await s.execute(await request(), actor), count = saves;
  for (const extra of [{ inspectionCursor: 1 }, { inspectionCursor: -1 }, { inspectionCursor: 1.5 },
    { inspectionCursor: 999, expectedJobRevision: ready.jobRevision }, { includeInspection: false, inspectionCursor: 0 }]) {
    await expect(s.execute({ op: 'read', requestId: 'job-one', includeInspection: true, ...extra }, actor)).rejects.toThrow();
  }
  expect(saves).toBe(count);
});

test('inspection hides all reports when a later input becomes unavailable after earlier input drift', async () => {
  const s = service(); await s.execute(await request(), actor);
  await seed('Source.md', 'Changed first input.');
  await seed('Concept.md', '---\nmoderation_status: hidden\n---\nPrivate concept.');
  const count = saves;
  await expect(s.execute({ op: 'read', requestId: 'job-one', includeInspection: true }, actor)).rejects.toThrow(/Compilation unavailable/);
  expect(saves).toBe(count);
});
test('refinement cannot silently drop or re-anchor a mandatory source fact', async () => {
  const s = service({ adapter: { check: async () => ({ status: 'partial', ruleVersion: 'fidelity-v1' }) } });
  const ready = await s.execute(await request(), actor), content = 'Use version 2.0.';
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision,
    content, evidence: await preservationEvidence(content) } as any, actor);
  const checked = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  for (const change of ['drop', 'anchor']) {
    const evidence = await preservationEvidence('Only if enabled, use version 2.0.');
    if (change === 'drop') evidence.facts = [];
    else evidence.facts[0]!.sourceLocator.quoteHash = digest('different fact');
    await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: checked.jobRevision,
      content: 'Only if enabled, use version 2.0.', evidence } as any, actor)).rejects.toThrow();
  }
});
test('unlisted source paths and stale draft locators cannot be submitted as preservation evidence', async () => {
  const s = service(), ready = await s.execute(await request(), actor), content = 'Use version 2.0.';
  for (const change of ['source', 'draft']) {
    const evidence = await preservationEvidence(content);
    if (change === 'source') evidence.facts[0]!.sourcePath = 'Unlisted.md';
    else evidence.facts[0]!.outputLocator.revision = digest('old draft');
    await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content, evidence } as any, actor)).rejects.toThrow();
  }
});

test.each(['source', 'concept', 'rule', 'runtime'])('%s drift invalidates prior plan without applying its draft', async changed => {
  let runtimeRevision = 'one'; const s = service({ runtime: async () => ({ id: 'local', revision: runtimeRevision, local: true, operations: ['synthesize', 'index'] }) });
  const ready = await s.execute(await request(), actor);
  if (changed === 'source') await seed('Source.md', 'Source changed.');
  if (changed === 'concept') await seed('Concept.md', 'Concept changed.');
  if (changed === 'rule') config.projects[0]!.ruleVersion = '2';
  if (changed === 'runtime') runtimeRevision = 'two';
  const result = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: ready.jobRevision }, actor);
  expect(result.status).toBe('review_required'); expect(await fs.noteExists('Result.md')).toBe(false);
});

test('permission revocation and host approval withdrawal prevent reading even saved checkpoint bodies or existence', async () => {
  const s = service(); await s.execute(await request(), actor); current = undefined;
  await expect(readJob(s)).rejects.toThrow('Compilation unavailable');
  current = actor; config.enabled = false;
  expect(await readJob(s)).toMatchObject({ status: 'diagnostic_only' });
});

test('without an actual checker and writer adapter, checking stays partial and retry never writes output', async () => {
  const s = service(); const ready = await s.execute(await request(), actor);
  const submitted = await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content: '# Draft' }, actor);
  const checked = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: submitted.jobRevision }, actor);
  expect(checked.status).toBe('partial'); expect(checked.reason).toBe('validation_unavailable');
  const retry = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: checked.jobRevision }, actor);
  expect(retry.status).not.toBe('completed'); expect(await fs.noteExists('Result.md')).toBe(false);
});

test.each([{ version: 9, jobs: [] }, { version: 1, jobs: [{}] }, 'broken'])('damaged history stays unchanged and cannot be reinitialized', async broken => {
  durable = broken; const s = service();
  await expect(s.execute(await request(), actor)).rejects.toThrow(/history/i);
  expect(durable).toEqual(broken); expect(saves).toBe(0);
});

test('small responses contain no body and unchanged checks/notifications do not rewrite receipts', async () => {
  const s = service(); await s.execute(await request(), actor);
  const before = saves;
  for (let i = 0; i < 3; i++) { await s.notify(['Unrelated.md']); await readJob(s, 'job-one', 512); }
  expect(saves).toBe(before);
  const result = await readJob(s, 'job-one', 512); expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});

test('single service serializes duplicate requests; shutdown refuses new work', async () => {
  const s = service(), input = await request();
  const [a, b] = await Promise.all([s.execute(input, actor), s.execute(input, actor)]);
  expect(a).toEqual(b); expect(durable.jobs).toHaveLength(1);
  await s.close(); await expect(s.execute(input, actor)).rejects.toThrow(/closed/i);
});

function adapter(events: string[] = []) {
  return {
    check: async () => ({ status: 'passed' as const, ruleVersion: 'checker-1' }),
    protect: async (_job: unknown, assertCurrent: () => Promise<void>) => { await assertCurrent(); events.push('policy'); },
    preview: async (job: any) => ({ fingerprint: digest(job.draft.content), revision: digest(job.draft.content) }),
    apply: async (job: any, _intent: unknown, assertCurrent: () => Promise<void>) => {
      await assertCurrent(); events.push('body');
      return fs.writeNoteWithRevisionGuardsAndReceipt({ path: job.outputPath, content: job.draft.content, expectedRevision: job.outputRevision },
        job.inputs.map((input: any) => ({ path: input.path, expectedRevision: input.revision })), { assertAccess: assertCurrent });
    },
  };
}
test.each(['passed', 'partial'] as const)('unchanged %s checks revalidate but do not rewrite durable history across restart', async status => {
  const impl = adapter(); impl.check = vi.fn(async () => ({ status, ruleVersion: 'checker-1' })) as typeof impl.check;
  const s = service({ adapter: impl }), draft = await generated(s);
  const first = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  const count = saves;
  const restarted = service({ adapter: impl });
  for (let i = 0; i < 3; i++) {
    expect(await restarted.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: first.jobRevision }, actor)).toEqual(first);
  }
  expect(impl.check).toHaveBeenCalledTimes(4);
  expect(saves).toBe(count);
  current = undefined;
  await expect(restarted.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: first.jobRevision }, actor)).rejects.toThrow('Compilation unavailable');
  expect(saves).toBe(count);
});

async function generated(s: CompilationService) {
  const ready = await s.execute(await request(), actor);
  return s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content: '# Result\nPreserved condition.' }, actor);
}

test('host adapter applies after protection and complete means output reread plus durable receipt', async () => {
  const events: string[] = [], s = service({ adapter: adapter(events) }), draft = await generated(s);
  const checked = await s.execute({ op: 'check', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  expect(checked.status).toBe('checked');
  const done = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: checked.jobRevision }, actor);
  expect(done.status).toBe('completed'); expect(events).toEqual(['policy', 'body']);
  expect(durable.jobs[0].receipt.outputRevision).toBe(await fs.readNoteRevision('Result.md'));
  const count = saves; expect((await readJob(service({ adapter: adapter(events) }))).status).toBe('completed'); expect(saves).toBe(count);
});

test('write succeeded but application acknowledgement lost: restart verifies intent, never applies twice', async () => {
  const impl = adapter(), apply = impl.apply; let applications = 0;
  impl.apply = async (...args) => { applications++; await apply(...args); throw Error('interrupted after commit'); };
  const s = service({ adapter: impl }), draft = await generated(s);
  const result = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  expect(result.status).not.toBe('completed');
  const restarted = service({ adapter: impl });
  const done = await restarted.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor);
  expect(done.status).toBe('completed'); expect(applications).toBe(1);
});

test('completion receipt failure is not completion; retry rereads but never overwrites', async () => {
  const baseSave = host.writeState; let fail = true;
  host.writeState = async value => { if (fail && (value as any).jobs[0]?.status === 'completed') { fail = false; throw Error('receipt disk failure'); } await baseSave(value); };
  const impl = adapter(), s = service({ adapter: impl }), draft = await generated(s);
  await expect(s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor)).rejects.toThrow();
  expect(durable.jobs[0].status).not.toBe('completed');
  const applySpy = vi.spyOn(impl, 'apply'), restarted = service({ adapter: impl }), saved = await readJob(restarted);
  expect((await restarted.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: saved.jobRevision }, actor)).status).toBe('completed');
  expect(applySpy).not.toHaveBeenCalled();
});

test.each(['delete', 'rollback'].flatMap(change => [false, true].flatMap(notify => ['none', 'check', 'retry'].map(unavailable => ({ change, notify, unavailable })))))(
  'durable application followed by $change requires review (notify=$notify, unavailable=$unavailable)', async ({ change, notify, unavailable }) => {
    const impl = adapter(), s = service({ adapter: impl });
    let requestId = 'job-one', previousBody: string | undefined;
    if (change === 'rollback') {
      const first = await generated(s);
      await s.execute({ op: 'retry', requestId, expectedJobRevision: first.jobRevision }, actor);
      previousBody = await readFile(join(vault, 'Result.md'), 'utf8');
      requestId = 'job-two';
    }
    const ready = change === 'delete' ? await s.execute(await request(), actor)
      : await s.execute({ ...await request(), requestId, expectedOutputRevision: await fs.readNoteRevision('Result.md') }, actor);
    const draft = await s.execute({ op: 'submit', requestId, expectedJobRevision: ready.jobRevision, content: '# Updated output' }, actor);
    const baseSave = host.writeState;
    host.writeState = async value => {
      if ((value as any).jobs.find((job: any) => job.requestId === requestId)?.status === 'completed') throw Error('receipt disk failure');
      await baseSave(value);
    };
    await expect(s.execute({ op: 'retry', requestId, expectedJobRevision: draft.jobRevision }, actor)).rejects.toThrow();
    expect(durable.jobs.find((job: any) => job.requestId === requestId).status).toBe('applied');
    host.writeState = baseSave;
    if (unavailable !== 'none') {
      const noAdapter = service(), saved = await readJob(noAdapter, requestId);
      expect((await noAdapter.execute({ op: unavailable, requestId, expectedJobRevision: saved.jobRevision }, actor)).status).toBe('partial');
    }
    if (previousBody !== undefined) await seed('Result.md', previousBody);
    else await rm(join(vault, 'Result.md'));
    const applySpy = vi.spyOn(impl, 'apply'), restarted = service({ adapter: impl });
    if (notify) {
      await restarted.notify(['Result.md']);
      expect(durable.jobs.find((job: any) => job.requestId === requestId)).toMatchObject({ status: 'review_required', reason: 'manual_edit_conflict' });
    }
    const saved = await readJob(restarted, requestId);
    expect((await restarted.execute({ op: 'retry', requestId, expectedJobRevision: saved.jobRevision }, actor)).status).toBe('review_required');
    expect(applySpy).not.toHaveBeenCalled();
    expect(await restarted.execute({ ...await request(), requestId: 'fresh-request', expectedOutputRevision:
      previousBody !== undefined ? await fs.readNoteRevision('Result.md') : 'missing' }, actor)).toMatchObject({ status: 'review_required' });
    if (previousBody !== undefined) expect(await readFile(join(vault, 'Result.md'), 'utf8')).toBe(previousBody);
    else expect(await fs.noteExists('Result.md')).toBe(false);
  },
);

test('policy stored then body failure preserves restrictions and a manual edit blocks retry', async () => {
  const events: string[] = [], impl = adapter(events);
  impl.apply = async () => { throw Error('body storage failure'); };
  const s = service({ adapter: impl }), draft = await generated(s);
  const failed = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  expect(events).toEqual(['policy']); expect(await fs.noteExists('Result.md')).toBe(false);
  await seed('Result.md', 'Human took over.');
  const result = await service({ adapter: adapter(events) }).execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: failed.jobRevision }, actor);
  expect(result.status).toBe('review_required'); expect(await readFile(join(vault, 'Result.md'), 'utf8')).toBe('Human took over.');
});

test('three application failures stop retries without resetting history', async () => {
  const impl = adapter(); let calls = 0;
  impl.apply = async () => { calls++; throw Error('failure'); };
  const s = service({ adapter: impl }); let result = await generated(s);
  for (let i = 0; i < 4; i++) result = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor);
  expect(result.status).toBe('stopped'); expect(calls).toBe(3); expect(durable.jobs[0].attempts).toBe(3);
});

test('revoke during protection prevents body dispatch even with administrator-like capabilities', async () => {
  const events: string[] = [], impl = adapter(events), protect = impl.protect;
  impl.protect = async (...args) => { await protect(...args); current = undefined; };
  const s = service({ adapter: impl }), draft = await generated(s);
  await expect(s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor)).rejects.toThrow();
  expect(events).toEqual(['policy']); expect(await fs.noteExists('Result.md')).toBe(false);
});

test('read rechecks authority after asynchronous dependency reads before returning job existence', async () => {
  const s = service(); await s.execute(await request(), actor);
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => { const result = await read(...args); current = undefined; return result; });
  await expect(readJob(s)).rejects.toThrow('Compilation unavailable');
});

test('an old checked receipt cannot approve a different draft after host history corruption', async () => {
  const s = service({ adapter: adapter() }), draft = await generated(s);
  await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  durable.jobs[0].draft.content = 'Tampered'; durable.jobs[0].draft.fingerprint = digest('Tampered');
  await expect(readJob(service())).rejects.toThrow(/history/i);
});

test('published output deleted outside the service is never recreated by enrolling a new request', async () => {
  const s = service({ adapter: adapter() }), draft = await generated(s);
  await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  await rm(join(vault, 'Result.md'));
  await s.notify(['Result.md']);
  expect((await s.execute({ ...await request(), requestId: 'job-two' }, actor)).status).toBe('review_required');
});

test('changing only requestId does not reset the three-failure stop for the same plan', async () => {
  const impl = adapter(); impl.apply = async () => { throw Error('fail'); };
  const s = service({ adapter: impl }); let result = await generated(s);
  for (let i = 0; i < 3; i++) result = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor);
  expect(result.status).toBe('stopped');
  expect((await s.execute({ ...await request(), requestId: 'fresh-id' }, actor)).status).toBe('review_required');
});

test('real inherited source restrictions are durable before accepting a derived draft', async () => {
  await seed('_wiki/_policies/documents.md', '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Source.md\n    accountIds: [operator]\n---\n');
  const policy = new DocumentPolicyStore(vault); await policy.refresh();
  access = new ScopeAccessPolicy({ documentRules: () => policy.rules() });
  const s = service({ protectSources: async (job: any, assertCurrent: () => Promise<void>) => {
    await assertCurrent(); await policy.inherit(job.outputPath, job.inputs.map((i: any) => i.path), policy.revision());
  } });
  const ready = await s.execute(await request(), actor);
  expect(new DocumentAuthority(policy.rules()).canFlow('Result.md', 'Source.md')).toBe(true);
  expect(await fs.noteExists('Result.md')).toBe(false);
  expect((await s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content: 'Restricted draft.' }, actor)).status).toBe('generated');
  expect(durable.jobs[0].draft.content).toBe('Restricted draft.');
});

test('host parser and runtime errors do not disclose private bytes to endpoint errors or logs', async () => {
  const secret = 'Unrelated hidden title and protected source quote';
  host.refresh = async () => { throw Error(`Malformed private JSON: ${secret}`); };
  await expect(service().execute({ op: 'diagnose' }, actor)).rejects.toThrow('Compilation unavailable');
  try { await service().execute({ op: 'diagnose' }, actor); } catch (error) { expect(String(error)).not.toContain(secret); }
});

test('revocation during private receipt save cannot return successful job metadata', async () => {
  const write = host.writeState;
  host.writeState = async value => { await write(value); current = undefined; };
  await expect(service().execute(await request(), actor)).rejects.toThrow('Compilation unavailable');
});

test('interrupted preparation cannot bypass source protection by submitting after restart', async () => {
  const s = service({ protectSources: async () => { throw Error('interrupted before protection'); } });
  await expect(s.execute(await request(), actor)).rejects.toThrow();
  const restarted = service(), saved = await readJob(restarted);
  const result = await restarted.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: saved.jobRevision, content: 'Premature draft' }, actor);
  expect(result.status).toBe('review_required'); expect(durable.jobs[0].draft).toBeUndefined();
});

test('acknowledgement lost on third application still permits restart verification without a fourth write', async () => {
  const impl = adapter(), apply = impl.apply; let calls = 0;
  impl.apply = async (...args) => { calls++; if (calls === 3) await apply(...args); throw Error('lost acknowledgement'); };
  const s = service({ adapter: impl }); let result = await generated(s);
  for (let i = 0; i < 3; i++) result = await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor);
  const restarted = service({ adapter: impl });
  const done = await restarted.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: result.jobRevision }, actor);
  expect(done.status).toBe('completed'); expect(calls).toBe(3);
});

test('duplicate prepare verifies current output instead of returning stale completion', async () => {
  const s = service({ adapter: adapter() }), original = await request(), draft = await generated(s);
  await s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor);
  await seed('Result.md', 'Manual edit');
  expect((await s.execute(original, actor)).status).toBe('review_required');
});

test('submit also fences permission revocation during its final save', async () => {
  const s = service(), ready = await s.execute(await request(), actor), write = host.writeState;
  host.writeState = async value => { await write(value); current = undefined; };
  await expect(s.execute({ op: 'submit', requestId: 'job-one', expectedJobRevision: ready.jobRevision, content: 'Draft.' }, actor)).rejects.toThrow('Compilation unavailable');
});

test('a burst of unchanged events uses one bounded reconciliation rather than one queued scan per event', async () => {
  const s = service(); await s.execute(await request(), actor);
  const read = vi.spyOn(host, 'readState'), before = saves;
  await Promise.all(Array.from({ length: 40 }, () => s.notify(['Source.md'])));
  expect(read).toHaveBeenCalledTimes(1); expect(saves).toBe(before);
});

test('a change arriving while the worker is finishing is checked before its notification promise completes', async () => {
  const s = service(); await s.execute(await request(), actor);
  const refresh = host.refresh; let second: Promise<void> | undefined, changed = false;
  host.refresh = async () => {
    if (!changed) { changed = true; await seed('Source.md', 'Late edit'); second = s.notify(['Source.md']); }
    return refresh();
  };
  await s.notify(['Unrelated.md']); await second;
  expect(durable.jobs[0].status).toBe('review_required');
});

test.each(['output', 'runtime', 'rule'])('completion fences %s drift during its final durable save', async kind => {
  let runtimeRevision = '1';
  const s = service({ adapter: adapter(), runtime: async () => ({ id: 'local', revision: runtimeRevision, local: true, operations: ['synthesize', 'index'] }) });
  const draft = await generated(s), write = host.writeState;
  host.writeState = async value => {
    await write(value);
    if ((value as any).jobs[0].status === 'completed') {
      if (kind === 'output') await seed('Result.md', 'Late user edit');
      if (kind === 'runtime') runtimeRevision = '2';
      if (kind === 'rule') config.projects[0]!.ruleVersion = '2';
    }
  };
  await expect(s.execute({ op: 'retry', requestId: 'job-one', expectedJobRevision: draft.jobRevision }, actor)).rejects.toThrow('Compilation unavailable');
});
