import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { startMcpHttpApi } from './mcp-http.js';
import { startRestApi } from './rest-api.js';

let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-integration-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'test', readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'peer-work-test', version: '1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (endpointId: string, args: Record<string, unknown> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).filter(item => item.type === 'text').map(item => item.text).join('\n');
    let value: any;
    try { value = JSON.parse(text); } catch { value = undefined; }
    return { error: result.isError, text, value };
  };
  return { server, client, call };
}

test('peer work is dynamically discoverable without expanding the five MCP tools', async () => {
  const { server, client } = await connect();
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name).sort();
    expect(names).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities']);
    for (const endpoint of ['work.review_context', 'work.staffing']) {
      const result = await client.callTool({ name: 'search_capabilities', arguments: { query: endpoint, maxChars: 12000 } });
      expect(JSON.stringify(result.content)).toContain(endpoint);
    }
    const found = await client.callTool({ name: 'search_capabilities', arguments: { query: 'work.board', maxChars: 12000 } });
    expect((found.content as any[]).map(item => item.text).join('\n')).toContain('"work.board"');
  } finally { await client.close(); await server.close(); }
});

test('three stateless clients race, discuss a counterexample and independently review the revised result', async () => {
  const server = createServer(vault, { version: 'test' });
  const api = await startMcpHttpApi(server, { port: 0 });
  const clients: Client[] = [];
  const peers: Array<{ client: Client; account: string; token: string }> = [];
  const invoke = async (client: Client, endpointId: string, args: Record<string, unknown>, token?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(token && { accessToken: token }) } });
    const text = (result.content as any[]).map(item => item.text || '').join('\n');
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  };
  try {
    for (const model of ['codex', 'gemini', 'claude']) {
      const client = new Client({ name: `${model}-protocol-fixture`, version: '1' }, { versionNegotiation: { mode: 'auto' } });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`)));
      const account = `peer-${model}`;
      const registered = await invoke(client, 'auth.register', { accountId: account, userId: 'test-family', modelId: model, agentId: account, password: randomUUID() });
      peers.push({ client, account, token: registered.accessToken });
    }
    const founder = peers[0]!;
    const call = (peer: typeof founder, endpoint: string, args: Record<string, unknown>) => invoke(peer.client, endpoint, args, peer.token);
    await call(founder, 'work.project', { op: 'create', projectId: 'joint-research', title: 'Joint research', goal: 'Check a claim before accepting it', allowedWork: ['Public evidence review'], completionCriteria: ['Peer-checked result'], participants: peers.map(peer => peer.account), expectedRevision: 'missing', requestId: 'create-project' });
    const created = await call(founder, 'mcp.create_agent_task', { taskId: 'verify', projectId: 'joint-research', title: 'Verify the claim', description: 'Test whether a sample supports the general claim.', workKind: 'security', completionCriteria: ['Account for counterexamples'], requestId: 'create-task' });
    await expect(call(founder, 'mcp.update_agent_task', { taskId: 'verify', status: ' COMPLETED ', expectedRevision: created.revision, expectedGeneration: 0, requestId: 'uppercase-completion', reason: 'Attempt premature completion', retrospective: 'This must not bypass review.' })).rejects.toThrow();
    expect((await call(founder, 'mcp.read_agent_task', { taskId: 'verify', includeContent: false })).revision).toBe(created.revision);
    const races = await Promise.allSettled(peers.map(peer => call(peer, 'work.claim', { op: 'start', taskId: 'verify', expectedRevision: created.revision, expectedGeneration: 0, requestId: `claim-${peer.account}` })));
    expect(races.filter(result => result.status === 'fulfilled'), races.map(result => result.status === 'rejected' ? String(result.reason) : 'success').join('\n')).toHaveLength(1);
    const worker = peers[races.findIndex(result => result.status === 'fulfilled')]!;
    const reviewers = peers.filter(peer => peer !== worker);
    const read = () => call(worker, 'mcp.read_agent_task', { taskId: 'verify', includeContent: false });
    const update = async (args: Record<string, unknown>) => {
      const current = await read();
      return call(worker, 'mcp.update_agent_task', { taskId: 'verify', expectedRevision: current.revision, expectedGeneration: current.fm.claim_generation, requestId: randomUUID(), ...args });
    };
    await call(worker, 'community.post', { slug: 'claim-discussion', title: 'Claim discussion', content: 'Does one positive sample prove the general claim? [[Community/Tasks/verify]]', category: 'forum', blockedTask: 'Verify the general claim', attempted: 'Checked one positive sample', helpWanted: 'Find a counterexample', expectedRevision: 'missing' });
    await update({ discussionSlug: 'claim-discussion' });
    const objection = await call(reviewers[0]!, 'community.comment', { slug: 'claim-discussion', content: 'A single positive sample does not exclude a counterexample. Check the missing negative case.' });
    expect(objection.success).toBe(true);
    const discussion = await call(worker, 'community.post_read', { slug: 'claim-discussion', maxChars: 4000 });
    expect(JSON.stringify(discussion)).toContain('counterexample');
    const note = await call(worker, 'notes.write', { path: 'Knowledge/Qualified.md', content: '# Qualified result\nA positive sample is insufficient; the negative case must be checked.', expectedRevision: 'missing' });
    await update({ description: 'Revised after the peer counterexample: do not generalize a single sample.', artifacts: [{ path: 'Knowledge/Qualified.md', revision: note.revision }], verification: 'Checked the negative case; qualified the result.' });
    let current = await read();
    const request = await call(worker, 'work.review', { op: 'request', taskId: 'verify', expectedRevision: current.revision, expectedGeneration: current.fm.claim_generation, reason: 'Please review the revised claim.', requestId: 'request-review' });
    current = await read();
    await expect(call(worker, 'work.review', { op: 'approve', taskId: 'verify', expectedRevision: current.revision, artifactFingerprint: request.artifactFingerprint, reason: 'Self approval', requestId: 'self-review' })).rejects.toThrow(/independent|same|author/i);
    const pulseResult = await reviewers[1]!.client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: reviewers[1]!.token, maxChars: 4000 } });
    expect(pulseResult.isError).toBeFalsy();
    expect(JSON.parse((pulseResult.content[0] as any).text).nextAction).toMatchObject({ tool: 'work.packet', arguments: { taskId: 'verify' } });
    await call(reviewers[1]!, 'work.review', { op: 'approve', taskId: 'verify', expectedRevision: current.revision, artifactFingerprint: request.artifactFingerprint, reason: 'Reviewed the qualified result and negative case.', requestId: 'independent-review' });
    await update({ status: 'completed', reason: 'Independent review and checks complete.', retrospective: 'A peer counterexample prevented an unsupported generalization.' });
    expect((await read()).fm.status).toBe('completed');
    const board = await call(founder, 'work.board', { projectId: 'joint-research', maxChars: 1000 });
    expect(JSON.stringify(board).length).toBeLessThanOrEqual(1000);
    expect(JSON.stringify(board)).toContain('completed');
  } finally {
    for (const client of clients) await client.close();
    await api.close(); await server.close();
  }
}, 20000);

test('work project public reads and work mutations have different authority', async () => {
  const { server, client, call } = await connect();
  try {
    const auth = await call('auth.register', { accountId: 'work-owner', userId: 'owner-family', modelId: 'codex', agentId: 'work-owner', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy();
    const created = await call('work.project', { op: 'create', projectId: 'review-project', title: 'Peer review', goal: 'Verify one result', allowedWork: ['Research public evidence'], completionCriteria: ['A verified note'], expectedRevision: 'missing', requestId: 'create-project' }, auth.value.accessToken);
    expect(created.error, created.text).toBeFalsy();
    const group = await call('work.group', { op: 'create', groupId: 'research-circle', title: 'Research circle', purpose: 'Voluntary cross-field learning', requestId: 'create-circle', expectedRevision: 'missing' }, auth.value.accessToken);
    expect(group.error, group.text).toBeFalsy();
    expect((await call('work.group', { groupId: 'research-circle' })).error).toBeFalsy();
    expect((await call('work.group', { op: 'join', groupId: 'research-circle', expectedRevision: group.value.revision, requestId: 'anon-join' })).error).toBe(true);
    expect((await call('work.coverage', { projectId: 'review-project', maxChars: 4000 })).error).toBeFalsy();
    const read = await call('work.project', { op: 'read', projectId: 'review-project' });
    expect(read.error, read.text).toBeFalsy();
    expect(read.text).toContain('Peer review');
    const catalog = await client.callTool({ name: 'search_capabilities', arguments: { query: 'work.project', maxChars: 12000 } });
    const descriptor = JSON.parse((catalog.content[0] as any).text).endpoints.find((item: any) => item.endpointId === 'work.project');
    expect(descriptor).toMatchObject({ available: true, requires: [], operations: { read: { available: true }, create: { available: false }, update: { available: false } } });
    for (const [endpoint, op] of [['work.project', 'update'], ['work.claim', 'claim'], ['work.handoff', 'accept'], ['work.review', 'approve']]) {
      const refused = await call(endpoint!, { op, projectId: 'review-project', taskId: 'unknown', expectedRevision: 'missing', requestId: 'anonymous' });
      expect(refused.error, endpoint).toBe(true);
      expect(refused.text).toMatch(/auth|login/i);
    }
  } finally { await client.close(); await server.close(); }
  const readonly = await connect(true);
  try {
    const catalog = await readonly.client.callTool({ name: 'search_capabilities', arguments: { query: 'work.project', maxChars: 12000 } });
    const descriptor = JSON.parse((catalog.content[0] as any).text).endpoints.find((item: any) => item.endpointId === 'work.project');
    expect(descriptor).toMatchObject({ available: true, operations: { read: { available: true }, update: { available: false, state: 'disabled' } } });
    expect((await readonly.call('work.project', { op: 'read', projectId: 'review-project' })).error).toBeFalsy();
    expect((await readonly.call('work.board', { projectId: 'review-project' })).error).toBeFalsy();
    expect((await readonly.call('work.group', { groupId: 'research-circle' })).error).toBeFalsy();
    const refusedGroup = await readonly.call('work.group', { op: 'join', groupId: 'research-circle', requestId: 'read-only' });
    expect(refusedGroup.error).toBe(true);
    expect(refusedGroup.text).toMatch(/read.only/i);
    for (const [endpoint, op] of [['work.project', 'create'], ['work.claim', 'start'], ['work.handoff', 'propose'], ['work.review', 'request']]) {
      const refused = await readonly.call(endpoint!, { op, projectId: 'review-project', taskId: 'unknown' });
      expect(refused.error, endpoint).toBe(true);
      expect(refused.text).toMatch(/read.only/i);
    }
  } finally { await readonly.client.close(); await readonly.server.close(); }
});

test('v2 MCP and REST share context receipts, approval gates and readonly operation policy', async () => {
  const { server, client, call } = await connect(); const api = await startRestApi(server, { port: 0 });
  const ownerPassword = randomUUID();
  let ownerToken = '', peerToken = '';
  const must = async (endpoint: string, args: Record<string, unknown>, token = ownerToken) => {
    const result = await call(endpoint, args, token); expect(result.error, result.text).toBeFalsy(); return result.value;
  };
  try {
    ownerToken = (await must('auth.register', { accountId: 'v2-owner', modelId: 'gpt', password: ownerPassword })).accessToken;
    peerToken = (await must('auth.register', { accountId: 'v2-peer', modelId: 'claude', password: randomUUID() }, '')).accessToken;
    await must('work.project', { op: 'create', projectId: 'v2', title: 'V2', goal: 'Exact reviewed change', allowedWork: ['Public parser work'],
      completionCriteria: ['Parser correct'], participants: ['v2-peer'], reviewPolicy: { version: 2 }, staffingPolicy: { taskType: 'code' }, requestId: 'project' });
    const locators: any[] = [];
    for (const role of ['before', 'after', 'test']) {
      const path = `Knowledge/v2-${role}.md`, content = ['before', 'after'].includes(role) ? `---\nsource_work_id: parser-fixture\n---\n\n${role} parser fixture` : `${role} parser fixture`;
      const note = await must('notes.write', { path, content, expectedRevision: 'missing' });
      locators.push({ id: role, role, path, revision: note.revision, startLine: 1, endLine: content.split('\n').length, required: true });
    }
    const task = await must('mcp.create_agent_task', { taskId: 'v2-task', projectId: 'v2', title: 'Parser', description: 'Fix parser', completionCriteria: ['Parser correct'],
      changeContext: { reason: 'Parser correction', scope: 'One function', locators }, verification: 'Focused parser check', requestId: 'create' });
    const claimed = await must('work.claim', { op: 'start', taskId: 'v2-task', expectedRevision: task.revision, expectedGeneration: 0, requestId: 'start' });
    const direct = await call('mcp.update_agent_task', { taskId: 'v2-task', status: ' COMPLETED ', expectedRevision: claimed.revision, expectedGeneration: 1,
      requestId: 'bypass', reason: 'Premature', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' }, ownerToken);
    expect(direct.error).toBe(true);
    const requested = await must('work.review', { op: 'request', taskId: 'v2-task', expectedRevision: claimed.revision, expectedGeneration: 1, requestId: 'request', reason: 'Review actual parser' });
    const requestArgs = { op: 'approve', taskId: 'v2-task', expectedRevision: requested.revision, artifactFingerprint: requested.artifactFingerprint,
      requestId: 'approve', reason: 'Compared snapshots and parser test' };
    expect((await call('work.review', requestArgs, peerToken)).error).toBe(true);
    const contextReceipts: string[] = [];
    for (const locator of locators) {
      const response = await fetch(`http://127.0.0.1:${api.port}/api/work/review-context?taskId=v2-task&locatorId=${locator.id}`, { headers: { authorization: `Bearer ${peerToken}` } });
      expect(response.status).toBe(200);
      const value: any = await response.json(); expect(value.items[0].text).toContain(`${locator.role} parser fixture`); contextReceipts.push(value.items[0].receipt);
    }
    const approved = await must('work.review', { ...requestArgs, contextReceipts, checks: [{ criterion: 'Parser correct', verdict: 'pass', rationale: 'Exact snapshots and focused parser result',
      evidenceIds: ['before', 'after', 'test'], missingChecks: [], tests: [{ locatorId: 'test', snapshot: locators[1].revision, environment: 'isolated fixture', result: 'pass', missingChecks: [] }] }] }, peerToken);
    await must('mcp.update_agent_task', { taskId: 'v2-task', status: 'completed', expectedRevision: approved.revision, expectedGeneration: 1, requestId: 'complete',
      reason: 'Reviewed', noReusableKnowledge: true, knowledgeDispositionReason: 'Fixture only' });
    expect((await must('mcp.read_agent_task', { taskId: 'v2-task', includeContent: false })).fm.work_review.verification_level).toBe('independently_reviewed');
    const staff = await fetch(`http://127.0.0.1:${api.port}/api/work/staffing?projectId=v2&taskId=v2-task`, { headers: { authorization: `Bearer ${ownerToken}` } });
    expect(staff.status).toBe(200); expect(await staff.json()).toMatchObject({ advisory: true });
    const generic = await call('mcp.update_frontmatter', { path: 'Community/Tasks/v2-task.md', frontmatter: { status: 'completed', work_review_contract: 1 } }, ownerToken);
    expect(generic.error).toBe(true); expect(generic.text).toMatch(/managed community/i);
  } finally { await api.close(); await client.close(); await server.close(); }
  const readonly = await connect(true);
  try {
    const login = await readonly.call('auth.login', { accountId: 'v2-owner', password: ownerPassword });
    expect(login.error, login.text).toBeFalsy(); ownerToken = login.value.accessToken;
    const result = await readonly.call('work.review', { op: 'self_verify', taskId: 'v2-task', expectedRevision: 'any', requestId: 'readonly', reason: 'Must reject' }, ownerToken);
    expect(result.error).toBe(true); expect(result.text).toMatch(/read.only/i);
    const staff = await readonly.call('work.staffing', { projectId: 'v2', maxChars: 4000 }, ownerToken);
    expect(staff.error, staff.text).toBeFalsy();
  } finally { await readonly.client.close(); await readonly.server.close(); }
}, 20000);
