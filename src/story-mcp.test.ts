import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { startRestApi } from './rest-api.js';
import { endpointIdForTool } from './endpoint-registry.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
async function fixture(root?: string, readOnly = false) {
  if (!root) { root = await mkdtemp(join(tmpdir(), 'story-mcp-')); const target = root; cleanup.push(() => rm(target, { recursive: true, force: true })); }
  const server = createServer(root, { readOnly }); cleanup.push(() => server.close());
  const client = new Client({ name: 'disposable-story-fixture', version: '1' }); cleanup.push(() => client.close());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const call = async (endpointId: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const text = (result.content as any[])[0].text;
    return { error: result.isError, value: result.isError ? text : JSON.parse(text) };
  };
  const ok = async (endpoint: string, args: Record<string, unknown> = {}) => {
    const result = await call(endpoint, args); expect(result.error, JSON.stringify(result.value)).not.toBe(true); return result.value;
  };
  return { root, server, client, call, ok };
}

test('fixed five MCP tools discover all nine story endpoints and deny anonymous mutations', async () => {
  const f = await fixture();
  expect((await f.client.listTools()).tools.map(t => t.name).sort()).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities']);
  for (const endpoint of ['project', 'artifact', 'sequence', 'context', 'review', 'adopt', 'session', 'export', 'visual']) {
    const result = await f.client.callTool({ name: 'search_capabilities', arguments: { query: `story.${endpoint}`, maxChars: 20000 } });
    expect(JSON.parse((result.content as any[])[0].text).endpoints[0]?.endpointId).toBe(`story.${endpoint}`);
  }
  for (const [endpoint, op] of [['project', 'create'], ['artifact', 'update'], ['sequence', 'update'], ['review', 'create'], ['adopt', 'read'], ['session', 'start'], ['export', 'write'], ['visual', 'propose']]) {
    const result = await f.call(`story.${endpoint}`, { projectId: 'novel', op });
    expect(result.error).toBe(true); expect(result.value).toMatch(/auth/i);
  }
});

test('authenticated reconnect preview uses the same read-only MCP and REST path for multiple handoffs', async () => {
  const f = await fixture(); const tokens: Record<string, string> = {};
  for (const accountId of ['owner', 'alice', 'bob', 'carol']) {
    tokens[accountId] = (await f.ok('auth.register', { accountId, modelId: accountId, password: 'disposable-story-password' })).accessToken;
  }
  const project = await f.ok('story.project', { op: 'create', projectId: 'novel', title: 'Novel', brief: { medium: 'novel' },
    participants: ['alice', 'bob', 'carol'], expectedRevision: 'missing', requestId: 'project', accessToken: tokens.owner });
  await f.ok('story.artifact', { op: 'create', projectId: 'novel', artifactId: 'scene', kind: 'scene', title: 'Scene', content: 'The scene.',
    expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'scene', accessToken: tokens.alice });
  const session = await f.ok('story.session', { op: 'start', projectId: 'novel', sessionId: 'drafting', artifactId: 'scene',
    writerAccountId: 'alice', editorAccountId: 'owner', expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'session', accessToken: tokens.owner });
  const packet = () => f.ok('work.packet', { taskId: session.taskId, accessToken: tokens.owner, maxChars: 12000 });
  let task = await packet();
  await f.ok('work.claim', { op: 'claim', taskId: session.taskId, expectedRevision: task.revision, expectedGeneration: task.generation,
    requestId: 'claim', accessToken: tokens.alice });
  const paused = await f.ok('story.session', { op: 'pause', projectId: 'novel', sessionId: 'drafting', reason: 'Handoff.',
    expectedRevision: session.revision, expectedProjectRevision: project.revision, requestId: 'pause', accessToken: tokens.owner });
  for (const [from, to] of [['alice', 'bob'], ['bob', 'carol']]) {
    task = await packet();
    await f.ok('work.handoff', { op: 'propose', taskId: session.taskId, toAccountId: to, nextAction: 'Continue scene.',
      expectedRevision: task.revision, expectedGeneration: task.generation, requestId: `offer-${from}`, accessToken: tokens[from!] });
    task = await packet();
    await f.ok('work.handoff', { op: 'accept', taskId: session.taskId, expectedRevision: task.revision,
      expectedGeneration: task.generation, requestId: `accept-${to}`, accessToken: tokens[to!] });
  }
  const readonly = await fixture(f.root, true);
  const login = await readonly.ok('auth.login', { accountId: 'owner', password: 'disposable-story-password' });
  const params = { projectId: 'novel', sessionId: 'drafting', op: 'reconnect_preview', accessToken: login.accessToken };
  const proof = await readonly.ok('story.session', params);
  expect(proof).toMatchObject({ writerAccountId: 'carol', hopCount: 2, gitHistoryUsed: false });
  expect((await readonly.call('story.session', { ...params, accessToken: undefined })).error).toBe(true);
  const api = await startRestApi(readonly.server, { port: 0 }); cleanup.push(() => api.close());
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/story.session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(proof);
  const denied = await readonly.call('story.session', { ...params, op: 'resume', reconnectWriter: true, expectedRevision: paused.revision,
    expectedProjectRevision: project.revision, expectedWorkRevision: proof.expectedWorkRevision, expectedWorkGeneration: proof.expectedWorkGeneration,
    reconnectProofFingerprint: proof.reconnectProofFingerprint, requestId: 'resume' });
  expect(denied.error).toBe(true); expect(denied.value).toMatch(/read.only/i);
}, 30000);

test('live story writes preserve revisions, reject private sources and share MCP/REST service', async () => {
  const f = await fixture();
  const account = await f.ok('auth.register', { accountId: 'story-fixture', modelId: 'codex', password: 'disposable-story-password' });
  const token = account.accessToken;
  const p = await f.ok('story.project', { op: 'create', projectId: 'novel', title: 'Library', brief: { medium: 'novel' }, expectedRevision: 'missing', requestId: 'project', accessToken: token });
  const args = { op: 'create', projectId: 'novel', artifactId: 'opening', kind: 'scene', title: 'Opening', content: 'The door opens.', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'scene', accessToken: token };
  const a = await f.ok('story.artifact', args);
  const read = await f.ok('story.artifact', { projectId: 'novel', artifactId: 'opening' });
  expect(read.revision).toBe(a.revision); expect(read.content.trim()).toBe('The door opens.');
  const race = await Promise.all(['one', 'two'].map(requestId => f.call('story.artifact', { ...args, op: 'update', expectedRevision: a.revision, requestId, content: requestId })));
  expect(race.filter(r => !r.error)).toHaveLength(1);
  const long = await f.ok('story.artifact', { ...args, artifactId: 'long-scene', requestId: 'long-scene', content: '장면 원고. '.repeat(1500) });
  const bounded = await f.ok('story.artifact', { projectId: 'novel', artifactId: 'long-scene', maxChars: 1500 });
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(1500); expect(bounded.truncated).toBe(true);
  const staleSource = await f.call('story.artifact', { ...args, artifactId: 'stale-summary', requestId: 'stale-summary', kind: 'summary', sources: [{ artifactId: 'opening', revision: a.revision }] });
  expect(staleSource.error).toBe(true); expect(staleSource.value).toMatch(/stale.*source/i);
  const injectedData = await f.call('story.artifact', { ...args, artifactId: 'injected', requestId: 'injected', data: { ownerAccountId: 'forged' } });
  expect(injectedData.error).toBe(true); expect(injectedData.value).toMatch(/artifact data field/i);
  expect(long.revision).toMatch(/^[a-f0-9]{64}$/);
  await mkdir(join(f.root, '_scopes/models/codex'), { recursive: true });
  await writeFile(join(f.root, '_scopes/models/codex/private.md'), 'PRIVATE-STORY-SOURCE');
  const privateSource = await f.call('story.artifact', { ...args, artifactId: 'private-copy', requestId: 'private', references: ['_scopes/models/codex/private.md'] });
  expect(privateSource.error).toBe(true); expect(privateSource.value).toMatch(/reference|scope|public|unavailable/i);
  const api = await startRestApi(f.server, { port: 0 }); cleanup.push(() => api.close());
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/story.artifact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'novel', artifactId: 'opening' }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(await f.ok('story.artifact', { projectId: 'novel', artifactId: 'opening' }));
  const contextUrl = `http://127.0.0.1:${api.port}/api/endpoint/story.context?projectId=novel&maxChars=1500&limit=1`;
  const context = await fetch(contextUrl);
  expect(context.status).toBe(200);
  expect(await context.json()).toEqual(await f.ok('story.context', { projectId: 'novel', maxChars: 1500, limit: 1 }));
  expect((await fetch(`${contextUrl}&op=write`)).status).toBe(400);
  expect((await fetch(`${contextUrl.replace('limit=1', 'limit=1junk')}`)).status).toBe(400);
  const ro = await fixture(f.root, true);
  for (const [endpoint, extra] of [['project', {}], ['artifact', { op: 'list' }], ['sequence', {}], ['context', {}], ['review', { op: 'list' }]] as const) await ro.ok(`story.${endpoint}`, { projectId: 'novel', ...extra });
  for (const [endpoint, op] of [['project', 'create'], ['artifact', 'update'], ['sequence', 'update'], ['review', 'create'], ['adopt', 'read'], ['session', 'start'], ['session', 'rehearse'], ['export', 'write'], ['export', 'invalid'], ['visual', 'propose']]) {
    const denied = await ro.call(`story.${endpoint}`, { projectId: 'novel', op }); expect(denied.error).toBe(true); expect(denied.value).toMatch(/read.only/i);
  }
});

test('task capability gates writes while restricted accounts retain public story reads', async () => {
  const f = await fixture();
  const owner = await f.ok('auth.register', { accountId: 'cap-owner', modelId: 'codex', password: 'disposable-story-password' });
  await f.ok('auth.register', { accountId: 'cap-reader', modelId: 'codex', agentId: 'cap-reader', accessToken: owner.accessToken, password: 'disposable-reader-password' });
  const project = await f.ok('story.project', { op: 'create', projectId: 'novel', title: 'Library', brief: { medium: 'novel' }, participants: ['cap-reader'], expectedRevision: 'missing', requestId: 'project', accessToken: owner.accessToken });
  await f.ok(endpointIdForTool('update_agent_capabilities'), { agentId: 'cap-reader', capabilities: ['write'], accessToken: owner.accessToken });
  const reader = await f.ok('auth.login', { accountId: 'cap-reader', password: 'disposable-reader-password' });
  await f.ok('story.project', { projectId: 'novel', accessToken: reader.accessToken });
  for (const [endpoint, op] of [['project', 'update'], ['artifact', 'create'], ['sequence', 'update'], ['review', 'create'], ['adopt', 'adopt'], ['session', 'start'], ['export', 'write'], ['visual', 'propose']]) {
    const denied = await f.call(`story.${endpoint}`, { projectId: 'novel', op, accessToken: reader.accessToken });
    expect(denied.error).toBe(true); expect(denied.value).toMatch(/Capability 'task'/);
  }
  for (const op of ['', null, {}, 'preview', 'invalid']) {
    const denied = await f.call('story.project', { projectId: 'novel', op, accessToken: owner.accessToken });
    expect(denied.error).toBe(true); expect(denied.value).toMatch(/Invalid story operation/);
  }
  for (const injection of [{ ownerAccountId: 'cap-reader' }, { principal: { accountId: 'cap-reader' } }, { frontmatter: { enabled: true } }]) {
    const denied = await f.call('story.project', { projectId: 'novel', ...injection, accessToken: owner.accessToken });
    expect(denied.error).toBe(true); expect(denied.value).toMatch(/Invalid story request field/);
  }
  expect((await f.ok('story.project', { projectId: 'novel' })).revision).toBe(project.revision);
});

test('visual annotations and alternatives use the fixed MCP executor and shared REST read service', async () => {
  const f = await fixture();
  const account = await f.ok('auth.register', { accountId: 'visual-fixture', modelId: 'codex', password: 'disposable-visual-password' });
  const accessToken = account.accessToken;
  const project = await f.ok('story.project', { op: 'create', projectId: 'novel', title: 'Visual test', brief: { medium: 'novel' },
    expectedRevision: 'missing', requestId: 'project', accessToken });
  const put = (artifactId: string, kind: string, content: string, data = {}) => f.ok('story.artifact', { op: 'create', projectId: 'novel',
    artifactId, kind, title: artifactId, content, data, expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: artifactId, accessToken });
  await put('iris', 'character', 'Iris'); await put('hall', 'place', 'Hall'); await put('garden', 'place', 'Garden');
  const scene = await put('opening', 'scene', 'Iris enters the hall.');
  const model = await put('map', 'visual_model', 'Authored map.', { sourceSceneId: 'opening', sourceSceneRevision: scene.revision,
    visual: { events: [{ id: 'arrival', actorId: 'iris', locationId: 'hall', action: 'enters', basis: 'stated', passage: { start: 0, end: 21, quote: 'Iris enters the hall.' } }] } });
  const args = { projectId: 'novel', modelId: 'map', maxChars: 4000 };
  const read = await f.ok('story.visual', args);
  expect(read.items[0].eventId).toBe('arrival');
  const api = await startRestApi(f.server, { port: 0 }); cleanup.push(() => api.close());
  // Like other mixed-operation story endpoints, the registered REST transport
  // is POST even when the selected service operation is a public read.
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/story.visual`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(read);
  const intent = { type: 'move_entity', eventIds: ['arrival'], actorId: 'iris', locationId: 'garden' };
  const preview = await f.ok('story.visual', { ...args, op: 'preview', intent, sourceRevision: model.revision, accessToken });
  const candidate = await f.ok('story.visual', { ...args, op: 'propose', intent, sourceRevision: model.revision, fingerprint: preview.fingerprint,
    replacements: [{ eventId: 'arrival', content: 'Iris enters the garden.' }], artifactId: 'garden-draft', title: 'Garden draft',
    expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'propose', accessToken });
  expect(candidate.kind).toBe('alternative');
  expect((await f.ok('story.artifact', { projectId: 'novel', artifactId: 'garden-draft' })).content.trim()).toBe('Iris enters the garden.');
  expect((await f.ok('story.artifact', { projectId: 'novel', artifactId: 'opening' })).revision).toBe(scene.revision);
  const ro = await fixture(f.root, true);
  expect((await ro.ok('story.visual', args)).items[0].eventId).toBe('arrival');
  const denied = await ro.call('story.visual', { ...args, op: 'propose', accessToken });
  expect(denied.error).toBe(true); expect(denied.value).toMatch(/read.only/i);
}, 30000);

test('session reads and default export preview stay public and usable in read-only mode', async () => {
  const f = await fixture();
  const owner = await f.ok('auth.register', { accountId: 'session-owner', modelId: 'codex', password: 'disposable-story-password' });
  const token = owner.accessToken;
  let p = await f.ok('story.project', { op: 'create', projectId: 'novel', title: 'Library', brief: { medium: 'novel' }, expectedRevision: 'missing', requestId: 'project', accessToken: token });
  const a = await f.ok('story.artifact', { op: 'create', projectId: 'novel', artifactId: 'opening', kind: 'scene', title: 'Opening', content: 'The door opens.', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'scene', accessToken: token });
  p = await f.ok('story.sequence', { op: 'update', projectId: 'novel', presentation: ['opening'], chronology: ['opening'], expectedRevision: p.revision, requestId: 'sequence', accessToken: token });
  const adopted = await f.ok('story.adopt', { projectId: 'novel', artifactId: 'opening', sourceRevision: a.revision, reason: 'Fixture selection', expectedProjectRevision: p.revision, expectedRevision: 'missing', requestId: 'adopt', accessToken: token });
  const output = await f.ok('story.export', { op: 'write', projectId: 'novel', exportId: 'manuscript', format: 'markdown', expectedProjectRevision: adopted.projectRevision, expectedRevision: 'missing', requestId: 'export', accessToken: token });
  expect(output.revision).toMatch(/^[a-f0-9]{64}$/);
  const ro = await fixture(f.root, true);
  await ro.ok('story.session', { op: 'list', projectId: 'novel' });
  const missingSession = await ro.call('story.session', { projectId: 'novel', sessionId: 'missing' });
  expect(missingSession.error).toBe(true); expect(missingSession.value).not.toMatch(/auth|read.only|Unknown story endpoint/i);
  for (const op of [undefined, 'preview']) {
    const preview = await ro.ok('story.export', { projectId: 'novel', format: 'markdown', ...(op && { op }) });
    expect(preview.content).toContain('The door opens.');
  }
  for (const op of ['read', 'health']) {
    const output = await ro.ok('story.export', { projectId: 'novel', exportId: 'manuscript', op });
    expect(output.stale).toBe(false);
  }
});
