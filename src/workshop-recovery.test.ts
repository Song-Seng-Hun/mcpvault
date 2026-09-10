import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';

let base: string, vault: string, client: Client, server: ReturnType<typeof createServer>, fs: FileSystemService;
let token: string, state: { revision: string };
const workshopPath = 'Community/Workshops/meeting.md';
async function call(endpointId: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { ...args, ...(token && { accessToken: token }) } } });
  if (r.isError) throw Error(JSON.stringify(r.content));
  return JSON.parse((r.content[0] as { text: string }).text);
}
const update = (operation: string, payload: unknown, requestId = operation) => call('workshop.facilitation_update', {
  workshopId: 'meeting', operation, payload, requestId, expectedRevision: state.revision,
});
beforeEach(async () => {
  token = ''; base = await realpath(tmpdir()); vault = await mkdtemp(join(base, 'workshop-recovery-'));
  fs = new FileSystemService(vault); server = createServer(vault); client = new Client({ name: 'workshop-recovery', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  token = (await call('auth.register', { accountId: 'owner', modelId: 'codex', agentId: 'owner', userId: 'family-owner', password: 'disposable-recovery-password' })).accessToken;
  await call('notes.write', { path: 'Evidence.md', content: 'Original basis', expectedRevision: 'missing' });
  const source = await fs.readNote('Evidence.md');
  await call('work.project', { op: 'create', projectId: 'project', title: 'Project', goal: 'Bounded responses',
    allowedWork: ['Document architecture'], completionCriteria: ['One grounded choice'], participants: ['owner'], requestId: 'project' });
  state = await call('workshop.create', { workshopId: 'meeting', title: 'Checklist', prompt: 'Review response design', facilitation: {
    version: 1, purpose: 'Review design', scope: 'Project only', successCriteria: ['Choice with caveats'],
    sourceRevisions: [{ path: 'Evidence.md', revision: source.revision }], methods: [{ methodId: 'checklist' }],
    facilitatorAccountId: 'owner', participants: ['owner'], decisionAuthority: {},
  } });
});
afterEach(async () => {
  vi.restoreAllMocks(); await client?.close(); await server?.close();
  const actual = await realpath(vault), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('workshop-recovery-')) throw Error('Unsafe cleanup');
  await rm(actual, { recursive: true, force: true });
});
async function ready() {
  for (const stepId of ['checklist-prepare', 'checklist-progress', 'checklist-close']) {
    await call('workshop.contribute', { workshopId: 'meeting', kind: 'evaluation', content: 'Inspected evidence.', stepId,
      expectedRevision: state.revision, requestId: stepId, structured: { checks: [{ itemId: 'bounded', status: 'pass',
        actor: 'owner', evidence: 'Evidence.md', reason: 'Inspected' }] } });
    if (stepId !== 'checklist-close') state = await update('advance', { reason: 'Checks complete' }, stepId);
  }
  state = await update('synthesize', { synthesis: 'Bounded responses with unresolved latency.', structured: {
    adopted: ['Bounded responses'], rejected: ['Unlimited output'], minority: ['Latency'], uncertainty: ['Load'], revisit: 'After measurement',
  } });
  state = await update('delegate', { projectId: 'project', accountId: 'owner', decisionKinds: ['architecture'], taskKinds: ['general'],
    scope: 'Document only', reason: 'Owner approval' });
}
async function lostOutput(type: 'decision' | 'task') {
  await ready();
  const source = await call('mcp.ingest_source', { sourceId: 'output-source', title: 'Output source', content: 'Bounded output evidence' });
  const payload = { outputId: 'result', type, kind: type === 'task' ? 'general' : 'architecture', title: 'Bounded output',
    ...(type === 'task' ? { description: 'Measure output', completionCriteria: ['Record results'] } : { context: 'Response budgets', decision: 'Bound outputs' }),
    alternatives: ['Unlimited'], consequences: ['Continuation'], minority: ['Latency'], uncertainty: ['Load'], revisit: ['After measurement'], evidencePaths: [source.path],
  };
  const original = FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
  const spy = vi.spyOn(FileSystemService.prototype, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function (write, guards, policy) {
    const result = await original.call(this, write, guards, policy);
    if (write.frontmatter?.workshop_output?.outputId === 'result') throw Error('Injected response loss');
    return result;
  });
  try { await expect(update('execute_output', payload)).rejects.toThrow(/Injected response loss/); } finally { spy.mockRestore(); }
  state = await fs.readNote(workshopPath);
  const pending = (state as any).frontmatter.workshop_output_pending;
  expect(pending.input.outputId).toBe('result');
  return { target: pending.input.path as string, output: await fs.readNote(pending.input.path) };
}
test.each(['decision', 'task'] as const)('reconciles intact %s after response loss and stale basis without changing the output', async type => {
  const { target, output } = await lostOutput(type);
  const basis = await fs.readNote('Evidence.md');
  await fs.writeNote({ path: 'Evidence.md', content: 'Changed basis', expectedRevision: basis.revision });
  const result = await update('reconcile_output', { outputId: 'result', outputRevision: output.revision, reason: 'Keep original output; basis changed' });
  expect(result.outcome).toBe('unresolved');
  const current = await fs.readNote(workshopPath);
  expect(current.frontmatter.workshop_output_pending).toBeUndefined();
  expect(current.frontmatter.workshop_outputs).toHaveLength(1);
  expect(current.frontmatter.workshop_outputs[0]).toMatchObject({ outputId: 'result', path: target, revision: output.revision, outcome: 'unresolved' });
  expect((await fs.readNote(target)).revision).toBe(output.revision);
  state = current;
  expect((await update('reconcile_output', { outputId: 'result', outputRevision: output.revision, reason: 'Keep original output; basis changed' })).replayed).toBe(true);
  state = await update('close', { outcome: 'unresolved', reason: 'Evidence changed, no new approval' });
  expect((await fs.readNote(workshopPath)).frontmatter.facilitation_close_outcome).toBe('unresolved');
  expect((await fs.readNote(target)).revision).toBe(output.revision);
});

test('unresolved close permits incomplete stale-basis discussion but normal close does not', async () => {
  const basis = await fs.readNote('Evidence.md');
  await fs.writeNote({ path: 'Evidence.md', content: 'Changed basis', expectedRevision: basis.revision });
  await expect(update('close', { reason: 'Normal close' })).rejects.toThrow(/changed|source|revision/i);
  await expect(update('close', { outcome: 'unresolved', reason: '' }, 'empty')).rejects.toThrow(/reason/i);
  state = await update('close', { outcome: 'unresolved', reason: 'Not resolved; preserve discussion' }, 'unresolved');
  const current = await fs.readNote(workshopPath);
  expect(current.frontmatter).toMatchObject({ phase: 'closed', status: 'closed', facilitation_close_outcome: 'unresolved' });
  expect(current.frontmatter.facilitation.outputs).toEqual([]);
  expect((await call('workshop.facilitation', { workshopId: 'meeting' })).nextAction.kind).toBe('closed');
});

test.each(['decision', 'task'] as const)('rejects edited %s properties even with an unchanged body', async type => {
  const { target, output } = await lostOutput(type);
  await fs.writeNote({ path: target, content: output.content, frontmatter: { ...output.frontmatter,
    ...(type === 'decision' ? { decision_status: 'rejected' } : { status: 'cancelled' }) }, expectedRevision: output.revision });
  const edited = await fs.readNote(target);
  await expect(update('reconcile_output', { outputId: 'result', outputRevision: edited.revision, reason: 'Must reject changed output' })).rejects.toThrow(/integrity|changed|receipt/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
  expect((await fs.readNote(target)).revision).toBe(edited.revision);
});

test('reconciliation replay rechecks the currently visible output revision', async () => {
  const { target, output } = await lostOutput('decision');
  const payload = { outputId: 'result', outputRevision: output.revision, reason: 'Recover once' };
  state = await update('reconcile_output', payload);
  await fs.writeNote({ path: target, content: output.content, frontmatter: { ...output.frontmatter, moderation_status: 'hidden' }, expectedRevision: output.revision });
  const prior = await fs.readNote(workshopPath);
  await expect(update('reconcile_output', payload)).rejects.toThrow(/unavailable|changed|revision|visibility/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(prior.revision);
});

test('only the current facilitator can reconcile after handoff, without reviving delegate authority', async () => {
  const { target, output } = await lostOutput('task');
  const oldToken = token;
  token = '';
  const nextToken = (await call('auth.register', { accountId: 'next', modelId: 'codex', agentId: 'next', userId: 'next-family', password: 'disposable-next-password' })).accessToken;
  token = oldToken;
  state = await update('handoff', { facilitatorAccountId: 'next' });
  const payload = { outputId: 'result', outputRevision: output.revision, reason: 'Preserve original output after handoff' };
  await expect(update('reconcile_output', payload)).rejects.toThrow(/facilitator/i);
  token = nextToken;
  state = await update('reconcile_output', payload);
  expect((await fs.readNote(workshopPath)).frontmatter.workshop_outputs[0]).toMatchObject({ actor: 'owner', reconciledBy: 'next', outcome: 'unresolved' });
  expect((await fs.readNote(target)).revision).toBe(output.revision);
  token = oldToken;
  await expect(update('reconcile_output', payload)).rejects.toThrow(/facilitator/i);
});

test('legacy Decision without a full original-state witness remains intact and pending', async () => {
  const { target, output } = await lostOutput('decision');
  const frontmatter = { ...output.frontmatter }; delete frontmatter.workshop_output_integrity;
  await fs.writeNote({ path: target, content: output.content, frontmatter, expectedRevision: output.revision });
  const legacy = await fs.readNote(target);
  await expect(update('reconcile_output', { outputId: 'result', outputRevision: legacy.revision, reason: 'Cannot infer missing original state' })).rejects.toThrow(/integrity/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
  expect((await fs.readNote(target)).revision).toBe(legacy.revision);
});

test('output CAS fences a competing write and preserves pending', async () => {
  const { target, output } = await lostOutput('task');
  const original = FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
  let injected = false;
  vi.spyOn(FileSystemService.prototype, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function (write, guards, policy) {
    if (write.path === workshopPath && !write.frontmatter?.workshop_output_pending && !injected) {
      injected = true;
      await fs.writeNote({ path: target, content: output.content + '\nExternal change', frontmatter: output.frontmatter, expectedRevision: output.revision });
    }
    return original.call(this, write, guards, policy);
  });
  await expect(update('reconcile_output', { outputId: 'result', outputRevision: output.revision, reason: 'Race must fail' })).rejects.toThrow(/revision|unavailable/i);
  expect(injected).toBe(true);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
});

test.each(['first', 'replay'])('opposite-type conflict rejects %s reconciliation without changing the workshop', async mode => {
  const { target, output } = await lostOutput('task');
  const payload = { outputId: 'result', outputRevision: output.revision, reason: 'Recover original' };
  if (mode === 'replay') state = await update('reconcile_output', payload);
  const opposite = target.replace('Community/Tasks/', 'Community/Knowledge/Decisions/');
  await fs.writeNote({ path: opposite, content: 'Other output type', expectedRevision: 'missing' });
  await expect(update('reconcile_output', payload)).rejects.toThrow(/conflict|unavailable|revision/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
  expect((await fs.readNote(target)).revision).toBe(output.revision);
});

test('output mutation during replay workshop reread rejects historical success', async () => {
  const { target, output } = await lostOutput('decision');
  const payload = { outputId: 'result', outputRevision: output.revision, reason: 'Recover original' };
  state = await update('reconcile_output', payload);
  const original = FileSystemService.prototype.readNote;
  let reads = 0, injected = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function (path, ...rest) {
    const result = await original.call(this, path, ...rest);
    if (path === workshopPath && ++reads === 2) {
      injected = true;
      await fs.writeNote({ path: target, content: output.content, frontmatter: { ...output.frontmatter, moderation_status: 'hidden' }, expectedRevision: output.revision });
    }
    return result;
  });
  await expect(update('reconcile_output', payload)).rejects.toThrow(/unavailable|changed|revision/i);
  expect(injected).toBe(true);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
});

test('read-only runtime rejects reconciliation and unresolved close without modifying pending output', async () => {
  const { output } = await lostOutput('task');
  await client.close(); await server.close();
  server = createServer(vault, { readOnly: true }); client = new Client({ name: 'recovery-readonly', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  token = '';
  token = (await call('auth.login', { accountId: 'owner', password: 'disposable-recovery-password' })).accessToken;
  await expect(update('reconcile_output', { outputId: 'result', outputRevision: output.revision, reason: 'Not writable' })).rejects.toThrow(/read.only/i);
  await expect(update('close', { outcome: 'unresolved', reason: 'Not writable' })).rejects.toThrow(/read.only/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
});

test('a legitimate later Work transition is not accepted through its historical creation receipt', async () => {
  const { target, output } = await lostOutput('task');
  await call('work.claim', { op: 'claim', taskId: output.frontmatter.task_id, expectedRevision: output.revision,
    expectedGeneration: output.frontmatter.claim_generation, requestId: 'claim', reason: 'Take proposed work' });
  const changed = await fs.readNote(target);
  const origin = changed.frontmatter.work_receipts.find((r: any) => r.action === 'task.create');
  expect(origin.result.revision).toBe(output.revision);
  await expect(update('reconcile_output', { outputId: 'result', outputRevision: changed.revision, reason: 'Must preserve changed work' })).rejects.toThrow(/integrity|changed/i);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
  expect((await fs.readNote(target)).revision).toBe(changed.revision);
});

test('unresolved close rejects logout after the initial lock-time authentication check', async () => {
  const original = FileSystemService.prototype.writeNoteWithReceipt;
  let revoked = false;
  vi.spyOn(FileSystemService.prototype, 'writeNoteWithReceipt').mockImplementation(async function (write, policy = {}) {
    if (write.path !== workshopPath || write.frontmatter?.facilitation_close_outcome !== 'unresolved') return original.call(this, write, policy);
    return original.call(this, write, { ...policy, assertAccess: async () => {
      await policy.assertAccess?.();
      if (!revoked) { revoked = true; await call('auth.logout', {}); }
    } });
  });
  await expect(update('close', { outcome: 'unresolved', reason: 'End without approval' })).rejects.toThrow(/actor|token|login|authenticated/i);
  expect(revoked).toBe(true);
  expect((await fs.readNote(workshopPath)).revision).toBe(state.revision);
});
