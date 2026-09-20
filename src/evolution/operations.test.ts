import { expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../../tests/server-fixture.js';
import { hash } from './policy.js';
import { startMcpHttpApi } from '../mcp-http.js';
import { startRestApi } from '../rest-api.js';
import { EvolutionOperations } from './operations.js';

export function memoryStorage() {
  const records = new Map<string, any>(); let held = false;
  return { records, storage: { refresh: async () => ({ version: 1 as const, enabled: true }), acquire: async () => {
    if (held) throw Error('busy'); held = true;
    return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: {
    read: async (key: string) => ({ revision: records.has(key) ? hash(records.get(key)) : 'missing', value: structuredClone(records.get(key)) }),
    write: async (key: string, value: any, expected: string) => {
      if (!held || expected !== (records.has(key) ? hash(records.get(key)) : 'missing')) throw Error('conflict');
      records.set(key, structuredClone(value)); return { revision: hash(value) };
    },
  } } as any };
}

test('completed server reads publish only hashed positive delivery facts; cache faults never replay the read', async () => {
  const { storage, records } = memoryStorage();
  const delivered: any[] = [];
  const actor: any = { accountId: 'alice', modelId: 'model', authority: 'current', assert: async () => {} };
  const host: any = { runTask: async (_token: string, _context: any, run: () => unknown) => run(),
    deliverContext: async () => ({ packet: { basis: 'unchanged' } }) };
  const sink: any = { recordCurationDelivery: async (event: any) => { delivered.push(event); throw Error('cache unavailable'); } };
  const ops = new EvolutionOperations(storage, host, async () => actor, sink);
  const task = await ops.begin('private-token', { requestId: 'begin', sessionId: 'reported', taskKind: 'read' });
  const result = { content: [{ type: 'text', text: JSON.stringify({ path: 'Secret.md', revision: 'a'.repeat(64), content: 'Private source.' }) }] };
  let calls = 0;
  const args = { evolutionTask: task.task.id, evolutionRequestId: 'read' };
  expect(await ops.run('private-token', 'notes.read', args, async () => { calls++; return result; })).toBe(result);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({ actor: hash(['curation-account-v1', 'alice']), documents: [
    { document: hash(['curation-document-v1', 'Secret.md']), revision: 'a'.repeat(64) }] });
  expect(delivered[0].observedAt).toBeGreaterThan(0);
  const persisted = JSON.stringify([...records.values()]);
  for (const secret of ['Secret.md', 'Private source.', 'private-token']) expect(persisted).not.toContain(secret);
  await expect(ops.run('private-token', 'notes.read', args, async () => { calls++; return result; })).rejects.toThrow();
  expect(calls).toBe(1);
  await ops.run('private-token', 'notes.read', { ...args, evolutionRequestId: 'failed' }, async () => ({ ...result, isError: true }));
  expect(delivered).toHaveLength(1);
  await ops.close();
});

test('memory and continuity observations retain only bounded delivery evidence, not bodies or inferred use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-observations-'));
  const { storage, records } = memoryStorage();
  await writeFile(join(root, 'Episode.md'), '---\nmemory_role: episodic\n---\n# Incident\n\nA synthetic mount failed only after suspend.\n');
  const server = createServer(root, { evolutionRuntime: { storage } });
  const runtime = getServerRuntime(server)!;
  const wire = (endpointId: string, args: any) => runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
  const call = async (endpointId: string, args: any) => {
    const r = await wire(endpointId, args); expect(r.isError, r.content[0].text).not.toBe(true); return JSON.parse(r.content[0].text);
  };
  try {
    const { accessToken } = await call('auth.register', { accountId: 'memory-observer', agentId: 'memory-observer', modelId: 'model', password: 'synthetic-memory-password' });
    const started = await call('evolution.context', { op: 'begin', requestId: 'start', sessionId: 'reported', taskKind: 'memory', accessToken });
    const tracked = { accessToken, evolutionTask: started.task.id };
    for (const endpointId of ['memory.brief', 'memory.recall', 'memory.consolidate']) {
      const reply = await call(endpointId, { ...tracked, evolutionRequestId: endpointId.replace('.', '-'), scope: 'global', query: 'mount', semantic: false, maxChars: 4000 });
      expect(reply.items[0].role).toBe('episodic');
    }
    await call('continuity.save', { accessToken, topic: 'Synthetic fixture', summary: 'Private checkpoint prose.', nextAction: 'Read incident.' });
    const checkpoint = await call('continuity.resume', { ...tracked, evolutionRequestId: 'resume' });
    const observed = await call('evolution.context', { op: 'observations', taskId: started.task.id, accessToken, maxChars: 12000 });
    expect(observed.items).toHaveLength(4);
    for (const event of observed.items.slice(0, 3)) {
      expect(event).toMatchObject({ state: 'completed', measurementScope: 'memory_server', effectVerified: false,
        evidence: { status: 'delivered', resources: [expect.objectContaining({ role: 'episodic', revision: expect.stringMatching(/^[a-f0-9]{64}$/), startLine: expect.any(Number), endLine: expect.any(Number) })] } });
      expect(event.resourceRevisions).toHaveLength(1);
      expect(event.evidence.resources[0].resourceId).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(observed.items[3]).toMatchObject({ measurementScope: 'continuity_server', evidence: { status: 'delivered', resources: [expect.objectContaining({ role: 'working', revision: checkpoint.revision })] } });
    const persisted = JSON.stringify([...records.values()]);
    for (const secret of ['Episode.md', 'synthetic mount failed', 'Private checkpoint prose', accessToken]) expect(persisted).not.toContain(secret);
    const repeated = await wire('memory.recall', { ...tracked, evolutionRequestId: 'memory-recall', scope: 'global', query: 'mount' });
    expect(repeated.isError).toBe(true);
    const denied = await wire('memory.recall', { ...tracked, evolutionRequestId: 'denied', scope: 'user' });
    expect(denied.isError).toBe(true);
    const after = await call('evolution.context', { op: 'observations', taskId: started.task.id, accessToken, maxChars: 12000 });
    expect(after.items[4]).toMatchObject({ state: 'failed', evidence: { status: 'unavailable', resources: [] } });
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('server-issued tasks record actual reads, do not store content, and refuse replay or foreign account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evolution-operations-'));
  const { storage, records } = memoryStorage();
  await writeFile(join(root, 'Welcome.md'), '# Evidence\nExact 17 ms condition.\n');
  const server = createServer(root, { evolutionRuntime: { storage } });
  const runtime = getServerRuntime(server)!;
  const wire = (endpointId: string, args: any) => runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
  const call = async (endpointId: string, args: any) => { const r = await wire(endpointId, args); if (r.isError) throw Error(r.content[0].text); return JSON.parse(r.content[0].text); };
  try {
    const alice = await call('auth.register', { accountId: 'alice', modelId: 'model', agentId: 'alice', password: 'synthetic-alice-password' });
    const bob = await call('auth.register', { accountId: 'bob', modelId: 'model', agentId: 'bob', password: 'synthetic-bob-password' });
    const args = { op: 'begin', requestId: 'begin1', sessionId: 'reported-session', taskKind: 'evidence_read', project: 'wiki', accessToken: alice.accessToken };
    const started = await call('evolution.context', args);
    expect(started.task).toMatchObject({ sessionProvenance: 'agent_report', effectVerified: false });
    expect(started.task.id).toMatch(/^task-/);
    expect((await call('evolution.cycle', { op: 'diagnose' })).operational).toMatchObject({ taskObservations: true, modelMetering: false });
    expect((await call('evolution.context', args)).task.id).toBe(started.task.id);
    const read = { path: 'Welcome.md', accessToken: alice.accessToken, evolutionTask: started.task.id, evolutionRequestId: 'read1' };
    expect((await wire('notes.read', read)).isError).not.toBe(true);
    const observations = await call('evolution.context', { op: 'observations', taskId: started.task.id, accessToken: alice.accessToken });
    expect(observations.items).toHaveLength(1);
    expect(observations.items[0]).toMatchObject({ state: 'completed', endpointId: 'notes.read', measurementScope: 'search_server', effectVerified: false });
    expect(observations.items[0].returnedChars).toBeGreaterThan(0);
    expect(JSON.stringify(await call('evolution.context', { op: 'observations', taskId: started.task.id, accessToken: alice.accessToken, maxChars: 1000 })).length).toBeLessThanOrEqual(1000);
    expect(JSON.stringify([...records.values()])).not.toContain('Exact 17 ms');
    expect(JSON.stringify([...records.values()])).not.toContain(alice.accessToken);
    expect((await wire('notes.read', read)).isError).toBe(true);
    expect((await wire('notes.read', { ...read, accessToken: bob.accessToken })).isError).toBe(true);
    const rest = await startRestApi(server, { port: 0 });
    try {
      const url = `http://127.0.0.1:${rest.port}/api/evolution/context`;
      const headers = { authorization: `Bearer ${alice.accessToken}`, 'content-type': 'application/json' };
      expect((await fetch(`${url}?op=begin&requestId=unsafe&taskKind=evidence_read&sessionId=s`, { headers })).status).toBe(405);
      const startedRest = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...args, requestId: 'rest1' }) });
      expect(startedRest.status).toBe(200);
    } finally { await rest.close(); }
    expect((await wire('evolution.context', { ...args, project: 'different' })).isError).toBe(true);
    const review = (runtime as any).evolutionReview;
    expect(review).toBeDefined();
    const feedback = { id: 'ordering1', taskId: started.task.id, sessionId: 'reported-session', target: { kind: 'persona', id: 'assistant' },
      scope: { kind: 'project', id: 'wiki' }, kind: 'preference', signal: 'explicit', key: 'ordering', value: 'outcome_first',
      summary: 'Outcome first; no claim of operational improvement.', basis: [] };
    const request = await call('evolution.feedback', { op: 'request_review', accessToken: alice.accessToken, feedback, requestId: 'review1', expectedRevision: 'missing' });
    expect(request.status).toBe('awaiting_direct_review');
    expect((await call('evolution.feedback', { op: 'request_review', accessToken: alice.accessToken, feedback, requestId: 'review1', expectedRevision: 'missing' })).reviewId).toBe(request.reviewId);
    const http = await startMcpHttpApi(server, { port: 0 });
    try {
      const origin = `http://127.0.0.1:${http.port}`, url = `${origin}/evolution/review`;
      const page = await fetch(url);
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await page.text();
      const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)![1]!;
      const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
      const post = (values: Record<string, string>, extra = {}) => fetch(url, { method: 'POST', headers: {
        origin, cookie, 'content-type': 'application/x-www-form-urlencoded', ...extra,
      }, body: new URLSearchParams({ csrf, ...values }) });
      expect((await post({ action: 'login' }, { origin: 'https://evil.invalid' })).status).toBe(403);
      expect((await post({ action: 'login', csrf: 'forged' })).status).toBe(403);
      expect((await fetch(`${url}?token=not-permitted`)).status).toBe(403);
      const loginReview = await post({ action: 'login', accountId: 'alice', password: 'synthetic-alice-password' });
      const rendered = await loginReview.text();
      expect(rendered).toContain('outcome_first');
      expect(rendered).not.toContain(alice.accessToken);
      const confirmed = await post({ action: 'confirm', reviewId: request.reviewId });
      expect(confirmed.status).toBe(200);
      const recorded = await call('evolution.feedback', { op: 'read', accessToken: alice.accessToken, feedbackId: feedback.id });
      expect(recorded.feedback.origin).toBe('human');
      expect((await post({ action: 'confirm', reviewId: request.reviewId })).status).toBe(409);
      let cycle = await call('evolution.cycle', { op: 'prepare', accessToken: alice.accessToken, cycleId: 'ordering-cycle', feedbackIds: [feedback.id], requestId: 'prepare1', expectedRevision: 'missing' });
      for (const op of ['advance', 'check']) cycle = await call('evolution.cycle', { op, accessToken: alice.accessToken, cycleId: cycle.cycleId,
        requestId: op, expectedRevision: cycle.revision, ...(op === 'advance' && { candidate: { key: 'ordering', value: 'outcome_first' } }) });
      expect(cycle).toMatchObject({ status: 'evaluated', evaluation: { method: 'static', measurementScope: 'returned_context' }, effect: null });
      const preview = await call('evolution.cycle', { op: 'preview', cycleId: cycle.cycleId, accessToken: alice.accessToken });
      cycle = await call('evolution.cycle', { op: 'apply', cycleId: cycle.cycleId, expectedRevision: cycle.revision, fingerprint: preview.fingerprint, requestId: 'apply1', accessToken: alice.accessToken });
      const next = await call('evolution.context', { ...args, requestId: 'next-task', sessionId: 'synthetic-next-session' });
      expect(next.packet.preferences[0].value).toBe('outcome_first');
      const effect = await call('evolution.cycle', { op: 'request_effect_review', accessToken: alice.accessToken, cycleId: cycle.cycleId,
        expectedRevision: cycle.revision, requestId: 'effect-review', deliveryToken: next.receipts[0].token,
        responseExcerpt: 'Result: synthetic fixture only. Not a real user task.', responseSource: 'agent_report' });
      expect((await post({ action: 'confirm', reviewId: effect.reviewId })).status).toBe(409); // Must first display the exact review.
      const effectPage = await fetch(url, { headers: { cookie } });
      const effectHtml = await effectPage.text();
      expect(effectHtml).toContain('synthetic fixture only');
      expect(effectHtml).toContain('outcome_first');
      expect((await post({ action: 'confirm', reviewId: effect.reviewId })).status).toBe(200);
      cycle = await call('evolution.cycle', { op: 'read', accessToken: alice.accessToken, cycleId: cycle.cycleId });
      expect(cycle.effect).toMatchObject({ method: 'operational', source: 'direct_user_review' });
      expect(JSON.stringify([...records.values()])).not.toContain('Result: synthetic fixture only');
      const source = await call('notes.read', { path: 'Welcome.md', accessToken: alice.accessToken });
      const hf = { ...feedback, id: 'harness1', target: { kind: 'harness', id: 'retrieval-budget' }, key: 'maxChars', value: '2000',
        basis: [{ path: 'Welcome.md', revision: source.revision }] };
      const eventToken = await runtime.evolutionHost!.captureFeedback(alice.accessToken, hf, 'human', 'synthetic-harness-event');
      await call('evolution.feedback', { op: 'record', accessToken: alice.accessToken, feedback: hf, eventToken, requestId: 'hf', expectedRevision: 'missing' });
      let hc = await call('evolution.cycle', { op: 'prepare', accessToken: alice.accessToken, cycleId: 'budget-cycle', feedbackIds: [hf.id], requestId: 'hp', expectedRevision: 'missing' });
      hc = await call('evolution.cycle', { op: 'advance', accessToken: alice.accessToken, cycleId: hc.cycleId, requestId: 'ha', expectedRevision: hc.revision,
        candidate: { modelId: 'model', taskKind: 'evidence_read', route: 'auto', optionalSkillBundles: 1, maxChars: 2000, expansionLimit: 2, repairLimit: 1, optionalReview: true } });
      hc = await call('evolution.cycle', { op: 'check', accessToken: alice.accessToken, cycleId: hc.cycleId, requestId: 'he', expectedRevision: hc.revision });
      expect(hc).toMatchObject({ status: 'review_required', reason: 'diagnostic_evaluation_only', evaluation: { measurementScope: 'search_server', baselineTokens: null, candidateTokens: null } });
    } finally { await http.close(); }
    await call('auth.logout', { accessToken: alice.accessToken });
    expect((await wire('evolution.context', { op: 'observations', taskId: started.task.id, accessToken: alice.accessToken })).isError).toBe(true);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
