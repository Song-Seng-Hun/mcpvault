import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { SourceComparisonService } from './source-comparison.js';
import { SearchService } from './search.js';
import { CollaborationService } from './scopes.js';
import { PathFilter } from './pathfilter.js';
import { RetrievalService } from './retrieval-service.js';
import { CompilationPublicationAdapter } from './compilation-publication-adapter.js';
import type { CompilationJob } from './compilation-model.js';
import { CompilationService } from './compilation-service.js';
import type { CompilationHost } from './compilation-host.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const body = 'Only approved calls may retry 3 times.';
let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, adapter: CompilationPublicationAdapter, job: CompilationJob;
const actor = { accountId: 'operator', modelId: 'test', agentId: 'worker', role: 'agent' as const, capabilities: ['write', 'publish'] as any };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-adapter-')); fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  const search = new SearchService(vault, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => { throw Error('No provider allowed'); } }, access, fs);
  adapter = new CompilationPublicationAdapter({ fs, access, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)),
    comparison: new SourceComparisonService(fs, access, retrieval), authorize: async () => actor });
  await writeFile(join(vault, 'Source.md'), `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(body)}\n---\n${body}`);
  const revision = await fs.readNoteRevision('Source.md'), locator = { revision, startLine: 1, endLine: 1, quoteHash: hash(body) };
  job = { requestId: 'job', requestFingerprint: hash('request'), projectId: 'project', accountId: 'operator', operation: 'synthesize',
    inputs: [{ path: 'Source.md', revision, role: 'source' }], outputPath: 'Result.md', outputRevision: 'missing', ruleVersion: 'v1',
    graphContractVersion: 1, authorityFingerprint: hash('authority'), protection: 'ready', status: 'generated', attempts: 0,
    draft: { content: body, fingerprint: hash(body), generatedAt: '2026-09-13T00:00:00.000Z' },
    evidence: { query: 'retry', decision: 'new_knowledge', facts: [{ id: 'limit', kind: 'condition', sourcePath: 'Source.md', sourceLocator: locator,
      outputLocator: { ...locator, revision: hash(body) }, comparisonMode: 'exact', semanticJudgment: 'preserved' }], coverage: [{ sourcePath: 'Source.md', locator }] } };
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
const current = async () => {};

async function observe(kind: 'source_only' | 'already_covered') {
  const coverage = job.evidence!.coverage;
  delete job.draft; delete job.evidence;
  job.operation = kind === 'source_only' ? 'index' : 'synthesize';
  job.observation = { kind, reason: 'Agent inspected exact revision and applicable conditions.', coverage };
  if (kind === 'already_covered') {
    await writeFile(join(vault, 'Existing.md'), `---\nllm_wiki_type: knowledge\nknowledge_status: draft\n---\n${body}`);
    const revision = await fs.readNoteRevision('Existing.md');
    job.inputs.push({ path: 'Existing.md', revision, role: 'member' });
    job.observation.query = 'retry';
    job.observation.matches = [{ sourcePath: 'Source.md', sourceLocator: coverage[0]!.locator, knowledgePath: 'Existing.md',
      knowledgeLocator: { revision, startLine: 1, endLine: 1, quoteHash: hash(body) }, semanticJudgment: 'covered' }];
  }
}
test.each(['source_only', 'already_covered'] as const)('verifies actual %s observations without generating or publishing a draft', async kind => {
  await observe(kind);
  expect(adapter.checkObservation).toBeTypeOf('function');
  const result = await adapter.checkObservation(job, current);
  expect(result.status).toBe('passed');
  expect(await fs.noteExists('Result.md')).toBe(false); expect(job.draft).toBeUndefined();
});
test.each(['unverified', 'missing_chunk', 'stale_target', 'uncertain', 'revoke'] as const)('no-write verification cannot complete for %s', async change => {
  await observe('already_covered');
  if (change === 'unverified') await writeFile(join(vault, 'Source.md'), body);
  if (change === 'missing_chunk') job.observation!.coverage = [];
  if (change === 'stale_target') await writeFile(join(vault, 'Existing.md'), 'A human edit after the observation.');
  if (change === 'uncertain') job.observation!.matches![0]!.semanticJudgment = 'uncertain';
  if (change === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
  expect(adapter.checkObservation).toBeTypeOf('function');
  expect((await adapter.checkObservation(job, current)).status).toBe('partial');
  expect(await fs.noteExists('Result.md')).toBe(false);
});
test('checks intact acquired source, previews publication and applies exactly the guarded revision', async () => {
  expect((await adapter.check(job, current)).status).toBe('passed');
  const intent = await adapter.preview(job, current); expect(await fs.noteExists('Result.md')).toBe(false);
  await adapter.apply(job, intent, current);
  expect(await fs.readNoteRevision('Result.md')).toBe(intent.revision);
  expect((await fs.readNote('Result.md')).frontmatter.knowledge_status).toBe('draft');
});
test.each(['omission', 'divergence', 'missing_chunk', 'conflict', 'unverified', 'source_only'] as const)('does not authorize publication for %s', async mode => {
  if (mode === 'omission') job.evidence!.facts[0]!.semanticJudgment = 'missing';
  if (mode === 'divergence') {
    job.draft!.content = body.replace('3', '9'); job.draft!.fingerprint = hash(job.draft!.content);
    job.evidence!.facts[0]!.outputLocator = { revision: job.draft!.fingerprint, startLine: 1, endLine: 1, quoteHash: job.draft!.fingerprint };
  }
  if (mode === 'missing_chunk') job.evidence!.coverage = [];
  if (mode === 'conflict') job.evidence!.decision = 'conflicting';
  if (mode === 'unverified') await writeFile(join(vault, 'Source.md'), `---\nllm_wiki_type: source\nimmutable: true\n---\n${body}`);
  if (mode === 'source_only') job.operation = 'index';
  expect((await adapter.check(job, current)).status).toBe('partial');
  await expect(adapter.preview(job, current)).rejects.toThrow();
  expect(await fs.noteExists('Result.md')).toBe(false);
});
test('apply rechecks authority and fingerprint after preview', async () => {
  const intent = await adapter.preview(job, current);
  await expect(adapter.apply(job, { ...intent, fingerprint: hash('wrong') }, current)).rejects.toThrow();
  vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
  await expect(adapter.apply(job, intent, current)).rejects.toThrow(); expect(await fs.noteExists('Result.md')).toBe(false);
});

test.each(['normal', 'lost_ack', 'manual_edit'] as const)('real publication and durable compilation recovery: %s', async interruption => {
  let durable: unknown, writes = 0;
  const host: CompilationHost = {
    refresh: async () => ({ version: 1, enabled: true, accountId: actor.accountId, projects: [{ id: 'project', ruleVersion: 'v1',
      sources: [{ path: 'Source.md', classification: 'resolved', mode: 'synthesis_allowed' }],
      outputPaths: ['Result.md'], runtimeIds: ['local'], operations: ['synthesize'] }] }),
    readState: async () => structuredClone(durable), writeState: async state => { durable = structuredClone(state); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }),
  };
  const makeService = () => new CompilationService({ fs, access, host, adapter, authorize: async () => actor,
    runtime: async () => ({ id: 'local', revision: 'verified-v1', local: true, operations: ['synthesize'] }) });
  const apply = adapter.apply.bind(adapter);
  vi.spyOn(adapter, 'apply').mockImplementation(async (...args) => {
    writes++; const result = await apply(...args);
    if (interruption !== 'normal') throw Error('Lost acknowledgement');
    return result;
  });
  const service = makeService();
  let result = await service.execute({ op: 'prepare', requestId: 'job', projectId: 'project', operation: 'synthesize',
    inputs: job.inputs.map(i => ({ path: i.path, expectedRevision: i.revision, role: i.role })),
    outputPath: 'Result.md', expectedOutputRevision: 'missing' }, actor);
  result = await service.execute({ op: 'submit', requestId: 'job', expectedJobRevision: result.jobRevision,
    content: body, evidence: job.evidence }, actor);
  result = await service.execute({ op: 'retry', requestId: 'job', expectedJobRevision: result.jobRevision }, actor);
  expect(result.status).toBe(interruption === 'normal' ? 'completed' : 'failed');
  await service.close();
  if (interruption === 'manual_edit') await writeFile(join(vault, 'Result.md'), 'Human correction must survive.');
  const restarted = makeService();
  const resumed = await restarted.execute({ op: 'retry', requestId: 'job', expectedJobRevision: result.jobRevision }, actor);
  expect(writes).toBe(1);
  expect(resumed.status).toBe(interruption === 'manual_edit' ? 'review_required' : 'completed');
  if (interruption === 'manual_edit') expect((await fs.readNote('Result.md')).content).toBe('Human correction must survive.');
  else expect(resumed.outputRevision).toBe(await fs.readNoteRevision('Result.md'));
  await restarted.close();
});
