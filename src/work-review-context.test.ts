import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';

const vaults: string[] = [];
afterEach(async () => { for (const path of vaults.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(policy: any = { version: 2 }, options: any = {}) {
  const vault = await mkdtemp(join(tmpdir(), 'work-context-')); vaults.push(vault);
  const fs = new FileSystemService(vault), auth = new ScopeAuthService(vault, { moderatorAccounts: ['moderator'] });
  const refs = new ReferenceService(fs, new ScopeAccessPolicy()), tasks = new AgentTaskService(fs, refs, auth);
  const people = await Promise.all(['owner', 'peer', 'moderator'].map(async accountId =>
    (await auth.register({ accountId, modelId: accountId, password: 'fixture-password-only' })).principal));
  const [owner, peer, moderator] = people;
  const work = new WorkService(fs, refs, auth, tasks, options);
  await work.project({ op: 'create', principal: owner, projectId: 'alpha', title: 'Alpha', goal: 'Verify actual changes',
    allowedWork: ['general', 'security'], completionCriteria: ['Behavior correct'], participants: ['peer'], requestId: 'project', ...(policy && { reviewPolicy: policy }) } as any);
  const locators: any[] = [];
  for (const role of ['before', 'after', 'test', 'upstream']) {
    const path = `Knowledge/${role}.md`; await fs.writeNote({ path, content: `${role} exact evidence\nsecond line\n`,
      ...(['before', 'after'].includes(role) && { frontmatter: { source_work_id: 'fixture-parser' } }) });
    const snapshot = await fs.readNote(path);
    locators.push({ id: role, role, path, revision: snapshot.revision, startLine: 1, endLine: snapshot.originalContent.split(/\r?\n/).length, required: true });
  }
  const changeContext = { reason: 'Fix wrong behavior', scope: 'Parser change', constraints: ['Keep scopes'], decisions: [], risks: [], dissent: [], unverified: [], locators };
  const create = (extra: any = {}) => tasks.create({ principal: owner, taskId: 'task', projectId: 'alpha', title: 'Task', description: 'Change parser',
    requestId: 'create', completionCriteria: ['Behavior correct'], verification: 'Focused parser test', changeContext, ...extra } as any);
  const read = () => fs.readNote('Community/Tasks/task.md');
  const update = async (extra: any = {}) => { const n = await read(); return tasks.update({ principal: owner, taskId: 'task', expectedRevision: n.revision,
    expectedGeneration: n.frontmatter.claim_generation, requestId: `update-${n.revision}`, ...extra }); };
  const claim = async () => { const n = await read(); return work.claim({ principal: owner, taskId: 'task', op: 'start', expectedRevision: n.revision,
    expectedGeneration: n.frontmatter.claim_generation, requestId: 'claim', reason: 'Begin bounded work' }); };
  const review = async (op: any, extra: any = {}) => { const n = await read(); const packet = await work.packet({ taskId: 'task' });
    return work.review({ principal: op === 'request' || op === 'self_verify' ? owner : peer, taskId: 'task', op, expectedRevision: n.revision,
      expectedGeneration: n.frontmatter.claim_generation, artifactFingerprint: packet.artifactFingerprint, requestId: `${op}-${n.revision}`, reason: 'Checked actual context', ...extra }); };
  return { vault, fs, auth, tasks, work, owner: owner!, peer: peer!, moderator: moderator!, create, read, update, claim, review, changeContext };
}

test('required host execution cannot be skipped when every criterion is optional', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true, optionalCriteria: ['Behavior correct'] });
  await f.create(); await f.claim(); await f.review('request');
  const proof = await evidence(f);
  await expect(f.review('approve', { ...proof, checks: [{ ...proof.checks[0], verdict: 'not_applicable', evidenceIds: [], tests: [] }] }))
    .rejects.toThrow(/host.observed|execution/i);
});

test('review admission refuses oversized original files even for a one-line selected range', async () => {
  const f = await fixture();
  const content = 'short first line\n' + 'x'.repeat(MAX_NOTE_CONTENT_BYTES);
  await writeFile(join(f.vault, 'Knowledge/upstream.md'), content);
  Object.assign(f.changeContext.locators[3], { revision: createHash('sha256').update(content).digest('hex'), endLine: 1 });
  await expect(f.create()).rejects.toThrow(/unavailable|budget|large|bytes/i);
});

test('preliminary artifact and dependency reads and final guards all have the original byte bound', async () => {
  const f = await fixture();
  await f.tasks.create({ principal: f.owner, projectId: 'alpha', taskId: 'parent', title: 'Parent', description: 'Constraint', requestId: 'parent' });
  const reads = vi.spyOn(f.fs, 'readNote'), writes = vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt');
  await f.create({ parentTaskId: 'parent', artifacts: [{ path: 'Knowledge/after.md', revision: f.changeContext.locators[1].revision }] });
  for (const path of ['Knowledge/after.md', 'Community/Tasks/parent.md']) {
    const calls = reads.mock.calls.filter(([target]) => target === path);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, maxBytes]) => maxBytes === MAX_NOTE_CONTENT_BYTES)).toBe(true);
  }
  expect(writes.mock.calls.at(-1)?.[2]?.maxBytes).toBe(MAX_NOTE_CONTENT_BYTES);
});

test('upstream budget drift marks one task unverified without breaking whole-project views', async () => {
  const f = await fixture();
  const parent = await f.tasks.create({ principal: f.owner, projectId: 'alpha', taskId: 'parent', title: 'Parent', description: 'Constraint', requestId: 'parent' });
  await f.create({ parentTaskId: 'parent' }); await f.claim(); await f.review('request'); await f.review('approve', await evidence(f));
  await f.tasks.update({ principal: f.owner, taskId: 'parent', description: 'x\n'.repeat(1001), expectedRevision: parent.revision, expectedGeneration: 0, requestId: 'parent-large' });
  const board = await f.work.board({ projectId: 'alpha', maxChars: 12000 });
  expect(board.items.find((item: any) => item.taskId === 'task')?.review.current).toBe(false);
  expect(JSON.stringify(board)).toContain('context_budget_exceeded');
  const coverage = await f.work.coverage({ projectId: 'alpha', maxChars: 12000 });
  expect(coverage.items.some((item: any) => item.kind === 'review_pending_or_stale')).toBe(true);
  await expect(f.work.staffing({ principal: f.owner, projectId: 'alpha' })).resolves.toBeDefined();
  await expect(f.work.reviewContext({ principal: f.peer, taskId: 'task' })).rejects.toThrow(/budget|split/i);
});

test('project opt-in snapshots v2 onto only new work', async () => {
  const f = await fixture(); await f.create();
  expect((await f.read()).frontmatter.work_review_contract).toBe(2);
  expect((await f.read()).frontmatter.change_context).toEqual(f.changeContext);
});

test('ordinary raw task completion cannot bypass explicit v2 verification', async () => {
  const f = await fixture(); await f.create(); await f.claim();
  await expect(f.update({ status: 'completed', reason: 'Done', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' })).rejects.toThrow(/review|verif/i);
});

test('summary-only independent approval rejects absent exact context and structured checks', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request');
  await expect(f.review('approve')).rejects.toThrow(/context|receipt|checks|evidence/i);
});

async function evidence(f: Awaited<ReturnType<typeof fixture>>, principal = f.peer) {
  expect((f.work as any).reviewContext, 'bounded review context reader exists').toBeTypeOf('function');
  const manifest = await (f.work as any).reviewContext({ taskId: 'task', principal, maxChars: 12000 });
  const manifestItems = [...manifest.items]; let cursor = manifest.cursor;
  while (cursor) { const next = await f.work.reviewContext({ taskId: 'task', principal, maxChars: 12000, cursor }); manifestItems.push(...next.items); cursor = next.cursor; }
  const receipts: string[] = [];
  for (const locator of manifestItems.filter((i: any) => i.kind === 'locator')) {
    const page = await (f.work as any).reviewContext({ taskId: 'task', principal, locatorId: locator.id, maxChars: 12000 });
    const original = (await f.fs.readNote(locator.path)).originalContent.split(/\r?\n/);
    expect(page.items[0].text).toBe(original.slice(page.items[0].startLine - 1, page.items[0].endLine).join('\n'));
    receipts.push(...page.items.map((i: any) => i.receipt));
  }
  return { contextReceipts: receipts, checks: [{ criterion: 'Behavior correct', verdict: 'pass', rationale: 'Before and after plus the focused test cover the parser behavior',
    evidenceIds: ['before', 'after', 'test'], missingChecks: [], tests: [{ locatorId: 'test', snapshot: f.changeContext.locators[1].revision,
      environment: 'isolated fixture', result: 'pass', missingChecks: [] }] }], artifactFingerprint: manifest.artifactFingerprint };
}

test('delivered exact evidence and checks approve independently and complete through the shared gate', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request');
  const proof = await evidence(f); await f.review('approve', proof);
  expect((await f.read()).frontmatter.work_review.verification_level).toBe('independently_reviewed');
  await f.update({ status: 'completed', reason: 'Verified', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' });
});

test('ordinary explicit self verification is labeled and cannot authorize high-risk work', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request');
  await f.review('self_verify', await evidence(f, f.owner));
  expect((await f.read()).frontmatter.work_review.verification_level).toBe('self_verified');
  await f.update({ workKind: 'security' }); await f.review('request');
  await expect(f.review('self_verify', await evidence(f, f.owner))).rejects.toThrow(/independent|high.risk/i);
});

test('tokens bind account and current upstream context and mandatory checks cannot be N/A', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request');
  const stolen = await evidence(f, f.owner);
  await expect(f.review('approve', stolen)).rejects.toThrow(/receipt|delivered|account/i);
  const proof = await evidence(f);
  await expect(f.review('approve', { ...proof, checks: [] })).rejects.toThrow(/criteria|checks/i);
  await expect(f.review('approve', { ...proof, checks: [{ ...proof.checks[0], verdict: 'not_applicable' }] })).rejects.toThrow(/required|mandatory|pass/i);
  await expect(f.review('approve', { ...proof, checks: [{ ...proof.checks[0], tests: [{ ...proof.checks[0].tests[0], snapshot: 'wrong-snapshot' }] }] })).rejects.toThrow(/snapshot/i);
  await f.review('approve', proof);
  const n = await f.fs.readNote('Knowledge/upstream.md');
  await f.fs.writeNote({ path: 'Knowledge/upstream.md', expectedRevision: n.revision, content: 'Changed upstream constraints' });
  await expect(f.update({ status: 'completed', reason: 'Done', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' })).rejects.toThrow(/stale|revision|context|approval/i);
  expect((await f.read()).frontmatter.work_reviews.some((r: any) => r.decision === 'approve')).toBe(true);
});

test('caller-reported tests cannot satisfy host-required execution policy', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true }); await f.create(); await f.claim(); await f.review('request');
  const proof = await evidence(f);
  await expect(f.review('approve', { ...proof, hostVerified: true })).rejects.toThrow(/host|execution|pending/i);
});

test('staffing defaults to unknown identity and cannot accept caller-injected host profiles', async () => {
  const f = await fixture(); await f.create();
  expect((f.work as any).staffing).toBeTypeOf('function');
  const result = await (f.work as any).staffing({ principal: f.owner, projectId: 'alpha', taskId: 'task', candidates: [{ accountId: 'peer', hostVerified: true, family: 'gpt' }], maxChars: 4000 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
  expect(result.items.some((i: any) => i.kind === 'unfilled')).toBe(true);
  expect(result.items.some((i: any) => i.source === 'recommendation')).toBe(false);
});

test('staffing uses only eligible host profiles and preserves visible active ownership', async () => {
  const profiles = ['owner', 'peer', 'moderator', 'inaccessible'].map((accountId, i) => ({ accountId, hostVerified: true, family: i ? 'claude' : 'gpt', version: 'host-observed-v1',
    tier: 'standard', capabilities: ['test'], tools: [], cost: 1 }));
  const f = await fixture(undefined, { executionProfiles: async () => profiles }); await f.create({ responsibility: { perspective: 'implementation' } }); await f.claim();
  expect((f.work as any).staffing).toBeTypeOf('function');
  const result = await (f.work as any).staffing({ principal: f.owner, projectId: 'alpha', taskId: 'task', maxChars: 12000 });
  expect(result.items.some((i: any) => i.source === 'existing' && i.accountId === 'owner')).toBe(true);
  expect(result.items.some((i: any) => i.perspective === 'independent_review' && i.accountId === 'peer')).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/moderator|inaccessible/);
});

test('upstream drift is visible as stale in coverage and board without a mutation', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request'); await f.review('approve', await evidence(f));
  const p = await f.fs.readNote('Community/Projects/alpha.md');
  await f.work.project({ principal: f.owner, op: 'update', projectId: 'alpha', goal: 'Changed goal', expectedRevision: p.revision, requestId: 'changed-goal' });
  const board = await f.work.board({ projectId: 'alpha', maxChars: 12000 });
  expect(board.items[0].review.current).toBe(false);
  const coverage = await f.work.coverage({ projectId: 'alpha', maxChars: 12000 });
  expect(coverage.items.some((i: any) => i.kind === 'review_pending_or_stale')).toBe(true);
});

test('v2 packet sends reviewers to original context and never suggests unverified general completion', async () => {
  const f = await fixture(); await f.create(); await f.claim();
  const own = await f.work.packet({ taskId: 'task', principal: f.owner, maxChars: 12000 });
  expect(own.items.some((i: any) => i.arguments?.status === 'completed')).toBe(false);
  await f.review('request');
  const peer = await f.work.packet({ taskId: 'task', principal: f.peer, maxChars: 12000 });
  expect(peer.items.find((i: any) => i.kind === 'nextAction')?.tool).toBe('work.review_context');
});

test('missing context can be questioned without issuing an approval', async () => {
  const f = await fixture(); await f.create(); await f.claim(); await f.review('request');
  await f.review('question', { contextReceipts: [], checks: [{ criterion: 'Behavior correct', verdict: 'unknown', rationale: 'Need access to upstream evidence',
    evidenceIds: [], tests: [], missingChecks: ['Upstream context not yet delivered'] }] });
  expect((await f.read()).frontmatter.work_review.verification_level).toBe('pending');
});

test('project strengthening cannot be bypassed using an older task execution policy', async () => {
  const f = await fixture(); await f.create(); await f.claim();
  const p = await f.fs.readNote('Community/Projects/alpha.md');
  await f.work.project({ principal: f.owner, op: 'update', projectId: 'alpha', reviewPolicy: { version: 2, requireHostExecution: true }, expectedRevision: p.revision, requestId: 'strengthen' });
  await f.review('request');
  await expect(f.review('approve', await evidence(f))).rejects.toThrow(/host|execution/i);
});

test('hidden context locators do not leak through ordinary task read projections', async () => {
  const f = await fixture(); await f.create();
  const n = await f.fs.readNote('Knowledge/upstream.md');
  await f.fs.writeNote({ path: 'Knowledge/upstream.md', content: n.content, frontmatter: { ...n.frontmatter, moderation_status: 'hidden' }, expectedRevision: n.revision });
  const read = await f.tasks.read({ taskId: 'task', includeContent: false });
  expect(JSON.stringify(read)).not.toContain('Knowledge/upstream.md');
});

test('implicit parent context revisions invalidate child approval', async () => {
  const f = await fixture();
  const parent = await f.tasks.create({ principal: f.owner, projectId: 'alpha', taskId: 'parent', title: 'Parent', description: 'Parent constraint', requestId: 'parent' });
  await f.create({ parentTaskId: 'parent' }); await f.claim(); await f.review('request'); await f.review('approve', await evidence(f));
  await f.tasks.update({ principal: f.owner, taskId: 'parent', description: 'Changed parent constraint', expectedRevision: parent.revision, expectedGeneration: 0, requestId: 'parent-change' });
  expect((await f.work.board({ projectId: 'alpha', maxChars: 12000 })).items.find((i: any) => i.taskId === 'task').review.current).toBe(false);
  await expect(f.update({ status: 'completed', reason: 'Done', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' })).rejects.toThrow(/current|review|approval/i);
});

test('implicit upstream original ranges must be delivered, not merely fingerprinted', async () => {
  const f = await fixture();
  await f.tasks.create({ principal: f.owner, projectId: 'alpha', taskId: 'parent', title: 'Parent', description: 'Parent constraint', requestId: 'parent' });
  await f.create({ parentTaskId: 'parent' }); await f.claim(); await f.review('request');
  const manifest = await f.work.reviewContext({ principal: f.peer, taskId: 'task', maxChars: 12000 });
  expect(manifest.items.some((i: any) => i.kind === 'locator' && i.path === 'Community/Tasks/parent.md' && i.required)).toBe(true);
});

test('unrelated after/test evidence cannot approve a different declared artifact', async () => {
  const f = await fixture(); await f.fs.writeNote({ path: 'Knowledge/actual-artifact.md', content: 'Actual changed artifact' });
  const a = await f.fs.readNote('Knowledge/actual-artifact.md');
  await f.create({ artifacts: [{ path: 'Knowledge/actual-artifact.md', revision: a.revision }] }); await f.claim(); await f.review('request');
  await expect(f.review('approve', await evidence(f))).rejects.toThrow(/artifact|actual|after/i);
});

test('unrelated before provenance cannot stand in for the actual artifact prior version', async () => {
  const f = await fixture(), before = f.changeContext.locators[0];
  const source = await f.fs.readNote(before.path);
  await f.fs.writeNote({ path: before.path, content: source.content, frontmatter: { source_work_id: 'unrelated-work' }, expectedRevision: source.revision });
  before.revision = (await f.fs.readNote(before.path)).revision;
  await f.create(); await f.claim(); await f.review('request');
  await expect(f.review('approve', await evidence(f))).rejects.toThrow(/before|identity|prior|same/i);
});

test('reading only unchanged Properties cannot substitute for delivered changed lines', async () => {
  const f = await fixture(); f.changeContext.locators[0].endLine = 2; f.changeContext.locators[1].endLine = 2;
  await f.create(); await f.claim(); await f.review('request');
  await expect(f.review('approve', await evidence(f))).rejects.toThrow(/changed|range|diff/i);
});

test('context admission rejects a cumulative range budget that cannot fit receipt submission', async () => {
  const f = await fixture(), locator = f.changeContext.locators[0], source = await f.fs.readNote(locator.path);
  await f.fs.writeNote({ path: locator.path, content: Array.from({ length: 1001 }, () => 'x').join('\n'), frontmatter: source.frontmatter, expectedRevision: source.revision });
  locator.revision = (await f.fs.readNote(locator.path)).revision; locator.endLine = 1000;
  await expect(f.create()).rejects.toThrow(/cumulative|budget|split/i);
  expect(await f.fs.noteExists('Community/Tasks/task.md')).toBe(false);
});

test('before and after originals are mandatory even if author marks their reads optional', async () => {
  const f = await fixture(); f.changeContext.locators[0].required = false; f.changeContext.locators[1].required = false;
  await f.create(); await f.claim(); await f.review('request'); const proof = await evidence(f);
  proof.contextReceipts = [];
  for (const locatorId of ['test', 'upstream']) proof.contextReceipts.push(...(await f.work.reviewContext({ principal: f.peer, taskId: 'task', locatorId })).items.map((i: any) => i.receipt));
  proof.checks[0]!.evidenceIds = ['test'];
  await expect(f.review('approve', proof)).rejects.toThrow(/before|after|original|context|range/i);
});

test('already-v2 tasks cannot remigrate to erase stricter execution requirements', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true }); await f.create();
  const p = await f.fs.readNote('Community/Projects/alpha.md');
  await f.work.project({ principal: f.owner, op: 'update', projectId: 'alpha', reviewPolicy: { version: 2 }, expectedRevision: p.revision, requestId: 'weaken' });
  await expect(f.update({ migrateReviewContract: true })).rejects.toThrow(/already|migration|contract/i);
});

test('pending missing execution is never reported as host-observed', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true }); await f.create(); await f.claim(); await f.review('request');
  await f.review('question', { contextReceipts: [], checks: [{ criterion: 'Behavior correct', verdict: 'unknown', rationale: 'Host result unavailable',
    evidenceIds: [], tests: [], missingChecks: ['Host execution'] }] });
  expect((await f.read()).frontmatter.work_review.execution_evidence).toBe('unavailable');
});

test('existing work remains legacy until its owner explicitly migrates after project opt-in', async () => {
  const f = await fixture(false); await f.create({ changeContext: undefined });
  const p = await f.fs.readNote('Community/Projects/alpha.md');
  await f.work.project({ principal: f.owner, op: 'update', projectId: 'alpha', reviewPolicy: { version: 2 }, expectedRevision: p.revision, requestId: 'opt-in' });
  expect((await f.read()).frontmatter.work_review_contract).toBeUndefined();
  await f.update({ migrateReviewContract: true, changeContext: f.changeContext });
  expect((await f.read()).frontmatter.work_review_contract).toBe(2);
});

test('host-authorized override is a labeled exception, not fabricated independent evidence', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true }); await f.create({ workKind: 'security' }); await f.claim(); await f.review('request');
  await expect(f.review('override', { principal: f.peer })).rejects.toThrow(/host|moderator/i);
  await f.review('override', { principal: f.moderator });
  expect((await f.read()).frontmatter.work_review).toMatchObject({ verification_level: 'host_override', account_id: 'moderator' });
  const coverage = await f.work.coverage({ projectId: 'alpha', maxChars: 12000 });
  expect(coverage.items.find((i: any) => i.kind === 'verification_coverage')).toMatchObject({ verified: false, exception: true });
  await f.update({ status: 'completed', reason: 'Host exception', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' });
});

test('context line ranges use exact raw Markdown including Properties, like source packets', async () => {
  const f = await fixture(), locator = f.changeContext.locators[0];
  await f.fs.writeNote({ path: locator.path, content: 'Body', frontmatter: { title: 'Original title' }, expectedRevision: locator.revision });
  locator.revision = (await f.fs.readNote(locator.path)).revision;
  locator.endLine = 2;
  await f.create();
  const read = await f.work.reviewContext({ principal: f.peer, taskId: 'task', locatorId: 'before' });
  expect(read.items[0].text).toBe((await f.fs.readNote(locator.path)).originalContent.split(/\r?\n/).slice(0, 2).join('\n'));
});

test('a matching trusted host observation is recorded separately from self-reported tests', async () => {
  const observed = new Map<string, { snapshot: string; environment: string; fingerprint: string }>();
  const f = await fixture({ version: 2, requireHostExecution: true }, { verifyReviewExecution: async (id: string, expected: any) => {
    const record = observed.get(id);
    return record?.snapshot === expected.test.snapshot && record?.environment === expected.test.environment && record?.fingerprint === expected.artifactFingerprint;
  } });
  await f.create(); await f.claim(); await f.review('request'); const proof = await evidence(f);
  const sample = proof.checks[0]!.tests[0]!;
  observed.set('host-result', { snapshot: sample.snapshot, environment: sample.environment, fingerprint: proof.artifactFingerprint });
  (sample as any).executionId = 'host-result';
  await f.review('approve', proof);
  expect((await f.read()).frontmatter.work_review).toMatchObject({ execution_evidence: 'host_observed', verification_level: 'independently_reviewed' });
});

test('context rejects private, escaping and malformed locators before writing task state', async () => {
  const f = await fixture();
  for (const path of ['../outside.md', 'C:/secret.md', '_scopes/users/owner/private.md', '_whispers/private.md']) {
    const locators = f.changeContext.locators.map((l, i) => i ? l : { ...l, path });
    await expect(f.create({ changeContext: { ...f.changeContext, locators } })).rejects.toThrow();
    expect(await f.fs.noteExists('Community/Tasks/task.md')).toBe(false);
  }
});

test('large structured reviews paginate completely within the maximum packet budget', async () => {
  const f = await fixture(), criteria = Array.from({ length: 20 }, (_, i) => `Criterion ${i}`);
  await f.create({ completionCriteria: criteria }); await f.claim(); await f.review('request');
  const proof = await evidence(f); proof.checks = criteria.map(criterion => ({ ...proof.checks[0]!, criterion, rationale: 'r'.repeat(1000) }));
  await f.review('approve', proof);
  let cursor: string | undefined; const items: any[] = [];
  for (let count = 0; count < 50; count++) {
    const packet = await f.work.packet({ taskId: 'task', maxChars: 12000, ...(cursor && { cursor }) });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(12000); items.push(...packet.items); cursor = packet.cursor;
    if (!packet.truncated) break;
  }
  expect(cursor).toBeUndefined();
  expect(items.filter(i => i.kind === 'reviewCriterion')).toHaveLength(20);
});

test('source revision race is fenced at final approval write', async () => {
  const f = await fixture({ version: 2, requireHostExecution: true }, { verifyReviewExecution: async () => {
    const source = await f.fs.readNote('Knowledge/upstream.md');
    await f.fs.writeNote({ path: 'Knowledge/upstream.md', content: 'Concurrent change', expectedRevision: source.revision }); return true;
  } });
  await f.create(); await f.claim(); await f.review('request');
  const before = await f.read(), proof = await evidence(f);
  proof.checks[0]!.tests[0] = { ...proof.checks[0]!.tests[0]!, executionId: 'host-result' } as any;
  await expect(f.review('approve', proof)).rejects.toThrow(/revision|conflict|changed/i);
  expect((await f.read()).revision).toBe(before.revision);
});

test('partial original delivery never covers omitted ranges and continuation is account-bound', async () => {
  const f = await fixture(); const locator = f.changeContext.locators[0];
  await f.fs.writeNote({ path: locator.path, content: Array.from({ length: 80 }, (_, i) => `line ${i} ${'e'.repeat(80)}`).join('\n'), expectedRevision: locator.revision });
  locator.revision = (await f.fs.readNote(locator.path)).revision; locator.endLine = 80;
  await f.create(); await f.claim(); await f.review('request');
  const first = await f.work.reviewContext({ principal: f.peer, taskId: 'task', locatorId: 'before', maxChars: 2400, limit: 1 });
  expect(first.truncated).toBe(true); expect(JSON.stringify(first).length).toBeLessThanOrEqual(2400);
  await expect(f.work.reviewContext({ principal: f.owner, taskId: 'task', locatorId: 'before', cursor: first.cursor })).rejects.toThrow(/cursor|context/i);
  const proof = await evidence(f); proof.contextReceipts = first.items.map((i: any) => i.receipt);
  await expect(f.review('approve', proof)).rejects.toThrow(/range|receipt|context/i);
});
