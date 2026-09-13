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
import { CompilationService } from './compilation-service.js';
import type { CompilationHost } from './compilation-host.js';
import { compilationJobRevision } from './compilation-model.js';
import { connectCodexHooks } from './codex-hook-connection.js';
import { ContinuityService } from './continuity.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const body = '승인된 요청만 실행한다. 외부 전송은 금지한다. 🙂';
const actor = { accountId: 'operator', modelId: 'test', agentId: 'worker', role: 'agent' as const, capabilities: ['write', 'publish'] as any };
let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, durable: any, host: CompilationHost, service: CompilationService;
let calls: number, allowed: boolean, locked: boolean, ready: any;
const services: CompilationService[] = [];
function make() {
  const search = new SearchService(vault, new PathFilter());
  const retrieval = new RetrievalService(search, new CollaborationService(fs, search), { search: async () => { throw Error('No provider'); } }, access, fs);
  const adapter = new CompilationPublicationAdapter({ fs, access, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)),
    comparison: new SourceComparisonService(fs, access, retrieval), authorize: async () => allowed ? actor : undefined });
  const s = new CompilationService({ fs, access, host, adapter, authorize: async () => allowed ? actor : undefined,
    runtime: async () => ({ id: 'local', revision: 'verified-v1', local: true, operations: ['synthesize'] }) });
  services.push(s); return s;
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-session-')); fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  durable = undefined; calls = 0; allowed = true; locked = false;
  host = { refresh: async () => ({ version: 1, enabled: true, accountId: actor.accountId, projects: [{ id: 'project', ruleVersion: 'v1',
    sources: [{ path: 'Source.md', classification: 'resolved', mode: 'synthesis_allowed' }], outputPaths: ['Result.md'], runtimeIds: ['local'], operations: ['synthesize'] }] }),
    readState: async () => structuredClone(durable), writeState: async s => { if (!locked) throw Error('No lease'); durable = structuredClone(s); },
    acquire: async () => { if (locked) throw Error('Busy'); locked = true; return { assertHeld: async () => { if (!locked) throw Error('Lost lease'); }, close: async () => { locked = false; } }; } };
  await writeFile(join(vault, 'Source.md'), `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(body)}\n---\n${body}`);
  service = make();
  ready = await service.execute({ op: 'prepare', requestId: 'job', projectId: 'project', operation: 'synthesize',
    inputs: [{ path: 'Source.md', expectedRevision: await fs.readNoteRevision('Source.md'), role: 'source' }], outputPath: 'Result.md', expectedOutputRevision: 'missing' }, actor);
});
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(services.splice(0).map(s => s.close())); await rm(vault, { recursive: true, force: true }); });
const request = () => ({ requestId: 'job', expectedJobRevision: ready.jobRevision });
function session(extra: Record<string, unknown> = {}) {
  return { signal: new AbortController().signal, deadline: Date.now() + 30000, application: 'check_only' as const,
    assertCurrent: async () => { if (!allowed) throw Error('Host revoked'); },
    generate: async (job: any) => {
      calls++; expect(durable.jobs[0].generation).toBeDefined();
      const source = await fs.readNote('Source.md');
      const locator = { revision: source.revision, startLine: 1, endLine: 1, quoteHash: hash(body) };
      return { content: body, evidence: { query: '승인', decision: 'new_knowledge', coverage: [{ sourcePath: 'Source.md', locator }],
        facts: [{ id: 'condition', kind: 'condition', sourcePath: 'Source.md', sourceLocator: locator,
          outputLocator: { ...locator, revision: hash(body) }, comparisonMode: 'exact', semanticJudgment: 'preserved' }] } };
    }, ...extra } as any;
}
test('current-session pipeline defaults to checked draft, not publication or a new model', async () => {
  const result = await service.runSession(request(), actor, session());
  expect(result.status).toBe('checked'); expect(calls).toBe(1); expect(await fs.noteExists('Result.md')).toBe(false);
  expect(durable.jobs[0].draft.content).toBe(body);
});
test('explicit verified host application uses actual publication and reread, then quiet resume', async () => {
  const result = await service.runSession(request(), actor, session({ application: 'apply_verified' }));
  expect(result.status).toBe('completed'); expect(await fs.readNoteRevision('Result.md')).toBe(result.outputRevision);
  const before = JSON.stringify(durable);
  const resumed = await make().runSession({ requestId: 'job', expectedJobRevision: result.jobRevision }, actor, session({ application: 'apply_verified' }));
  expect(resumed.status).toBe('completed'); expect(calls).toBe(1); expect(JSON.stringify(durable)).toBe(before);
});
test.each(['throw', 'cancel', 'revoke', 'edit'] as const)('generation interrupted by %s cannot submit, publish or regenerate on restart', async cause => {
  const controller = new AbortController(), context = session({ signal: controller.signal });
  const generate = context.generate;
  context.generate = async (job: any, check: any) => { const value = await generate(job, check);
    if (cause === 'throw') throw Error('SECRET provider detail');
    if (cause === 'cancel') controller.abort();
    if (cause === 'revoke') allowed = false;
    if (cause === 'edit') await writeFile(join(vault, 'Source.md'), 'Changed by user.');
    return value; };
  const result = await service.runSession(request(), actor, context);
  expect(result.status).toBe('review_required'); expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(await fs.noteExists('Result.md')).toBe(false); expect(durable.jobs[0].draft).toBeUndefined();
  allowed = true;
  await make().runSession({ requestId: 'job', expectedJobRevision: compilationJobRevision(durable.jobs[0]) }, actor, session());
  expect(calls).toBe(1);
});
test.each(['expired', 'stale', 'too_long'] as const)('invalid session %s cannot start generation', async reason => {
  const req = request(), context = session();
  if (reason === 'expired') context.deadline = Date.now() - 1;
  if (reason === 'too_long') context.deadline = Date.now() + 600000;
  if (reason === 'stale') req.expectedJobRevision = hash('old');
  const result = await service.runSession(req, actor, context);
  expect(result.status).toBe('review_required'); expect(calls).toBe(0);
});
test('busy generation keeps ownership until settled and rejects a concurrent worker', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }); const wait = new Promise<void>(r => { release = r; });
  const context = session(), generate = context.generate;
  context.generate = async (job: any, check: any) => { entered(); await wait; return generate(job, check); };
  const first = service.runSession(request(), actor, context); await started;
  expect((await service.runSession(request(), actor, session())).status).toBe('deferred');
  release(); expect((await first).status).toBe('checked'); expect(calls).toBe(1);
});
test('generation cannot write directly even to the approved output', async () => {
  const context = session(), generate = context.generate;
  context.generate = async (job: any, check: any) => {
    await expect(fs.writeNote({ path: 'Result.md', content: 'Bypass publication' })).rejects.toThrow();
    return generate(job, check);
  };
  expect((await service.runSession(request(), actor, context)).status).toBe('checked');
  expect(await fs.noteExists('Result.md')).toBe(false);
});
test('cancellation returns promptly but cannot release a still-running generation worker', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }); const wait = new Promise<void>(r => { release = r; });
  const controller = new AbortController(), context = session({ signal: controller.signal }), generate = context.generate;
  context.generate = async (job: any, check: any) => { entered(); await wait; return generate(job, check); };
  const first = service.runSession(request(), actor, context); await started; controller.abort();
  try {
    const result = await Promise.race([first, new Promise(resolve => setTimeout(() => resolve({ status: 'timeout' }), 100))]);
    expect(result.status).toBe('review_required');
    expect((await service.runSession(request(), actor, session())).status).toBe('deferred');
  } finally { release(); }
});
test('verified host hook connects actual generation and checks once; duplicates only reconcile', async () => {
  let deliver!: (payload: string) => Promise<any>, history: unknown;
  const context = session(), fingerprint = hash('definition');
  const close = connectCodexHooks({
    host: { refresh: async () => ({ version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'project', workspace: 'E:/dev/wiki',
      definitionHash: fingerprint, events: ['Stop'], actions: ['compilation'], paths: ['Source.md', 'Result.md'] }] }),
      readState: async () => structuredClone(history), writeState: async state => { history = structuredClone(state); },
      acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }) },
    attest: async () => ({ projectId: 'project', accountId: 'operator', workspace: 'E:/dev/wiki', definitionHash: fingerprint,
      sessionId: 's', event: 'Stop', causeId: 'cause', authorityRevision: hash('authority'), inputRevision: hash('input'), mode: 'default', verified: true,
      expiresAt: context.deadline, hostBusy: false, quotaAvailable: true, runtimeLocal: true, paths: ['Source.md', 'Result.md'],
      work: { action: 'compilation', requestId: 'job', expectedJobRevision: ready.jobRevision } }),
    bind: handler => { deliver = handler; return () => {}; },
    session: { generate: context.generate, application: 'check_only' },
  }, { fs, access, compilation: service, continuity: new ContinuityService(fs, { access }), authorize: async () => actor }, false);
  try {
    const payload = JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: 'NEVER_READ' });
    expect((await deliver(payload)).status).toBe('processed'); expect(durable.jobs[0].status).toBe('checked');
    expect(await fs.noteExists('Result.md')).toBe(false); expect(calls).toBe(1);
    await deliver(payload); expect(calls).toBe(1);
  } finally { close(); }
});
test('one refinement preserves obligations and cannot launch a third generation', async () => {
  const context = session(), generate = context.generate;
  context.generate = async (job: any, check: any) => {
    const value = await generate(job, check);
    if (calls === 1) { value.content = '조건 누락'; value.evidence.facts[0].semanticJudgment = 'missing'; delete value.evidence.facts[0].outputLocator; }
    return value;
  };
  const first = await service.runSession(request(), actor, context); expect(first.status).toBe('partial');
  const second = await service.runSession({ requestId: 'job', expectedJobRevision: first.jobRevision }, actor, context);
  expect(second.status).toBe('checked'); expect(calls).toBe(2); expect(durable.jobs[0].refinements).toBe(1);
  await make().runSession({ requestId: 'job', expectedJobRevision: second.jobRevision }, actor, context);
  expect(calls).toBe(2); expect(await fs.noteExists('Result.md')).toBe(false);
});
test('generation reservation storage failure prevents generation and preserves existing state', async () => {
  const before = JSON.stringify(durable);
  vi.spyOn(host, 'writeState').mockRejectedValue(Error('PRIVATE storage path'));
  const result = await service.runSession(request(), actor, session());
  expect(result.status).toBe('review_required'); expect(calls).toBe(0); expect(JSON.stringify(durable)).toBe(before);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
test('manual output creation after check is not overwritten by a later session', async () => {
  const checked = await service.runSession(request(), actor, session());
  await writeFile(join(vault, 'Result.md'), 'User-owned result.');
  const result = await service.runSession({ requestId: 'job', expectedJobRevision: checked.jobRevision }, actor, session({ application: 'apply_verified' }));
  expect(result.status).toBe('review_required'); expect(calls).toBe(1);
  expect((await fs.readNote('Result.md')).content).toBe('User-owned result.');
});
test('read-only service rejects host generation without any reservation write', async () => {
  const readonly = new CompilationService({ fs, access, host, readOnly: true, authorize: async () => actor }); services.push(readonly);
  const before = JSON.stringify(durable);
  expect((await readonly.runSession(request(), actor, session())).status).toBe('review_required');
  expect(calls).toBe(0); expect(JSON.stringify(durable)).toBe(before);
});
test('late generation continuations stay read-only while publication is allowed', async () => {
  let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  let late!: Promise<boolean>;
  const context = session({ application: 'apply_verified' }), generate = context.generate;
  context.generate = async (job: any, check: any) => {
    late = (async () => { await wait; try { await fs.writeNote({ path: 'Result.md', content: 'Late bypass' }); return false; } catch { return true; } })();
    return generate(job, check);
  };
  const save = host.writeState.bind(host);
  vi.spyOn(host, 'writeState').mockImplementation(async state => {
    if ((state as any).jobs[0].status === 'applying') { release(); expect(await late).toBe(true); }
    await save(state);
  });
  try { expect((await service.runSession(request(), actor, context)).status).toBe('completed'); }
  finally { release(); if (late) await late; }
  expect((await fs.readNote('Result.md')).content).toContain(body);
});
test.each([false, null, { basis: 'invalid', priorDraftRevision: 'missing' }])('damaged generation marker is preserved and never reset: %j', async marker => {
  durable.jobs[0].generation = marker; const before = JSON.stringify(durable);
  const result = await service.runSession({ requestId: 'job', expectedJobRevision: compilationJobRevision(durable.jobs[0]) }, actor, session());
  expect(result.status).toBe('review_required'); expect(calls).toBe(0); expect(JSON.stringify(durable)).toBe(before);
});
