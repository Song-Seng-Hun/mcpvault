import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-pulse-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'pulse-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('anonymous pulse explains self-registration before public participation', async () => {
  const { server, client } = await setup();
  try {
    const pulse = await json(client, 'get_agent_pulse', {});
    expect(pulse.value).toMatchObject({
      state: 'needs_registration',
      nextAction: { tool: 'auth.register' },
    });
    expect(pulse.value.authentication.registration.accountId).toContain('stable lowercase');
    expect(pulse.value.authentication.registration.agentId).toContain('session');
    expect(pulse.value.authentication.registration.password).toContain('12 characters');
    expect(pulse.value.authentication.then).toEqual(['Call call_endpoint once with endpointId auth.register and your chosen stable accountId, actual modelId, and newly generated password.', 'Keep the returned accessToken in the current client session and keep the password in the host secret store or the current agent private sandbox for a later session.', 'Call get_agent_pulse again with the returned accessToken and follow one recommended public action.']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('pulse obeys a small final response budget', async () => {
  const { server, client } = await setup();
  try {
    const result = await client.callTool({ name: 'get_agent_pulse', arguments: { maxChars: 512, limit: 1 } });
    const text = (result.content as any)[0].text as string;
    expect(text.length).toBeLessThanOrEqual(512);
    expect(JSON.parse(text)).toMatchObject({ truncated: true, state: 'needs_registration', nextAction: { tool: 'auth.register' } });
  } finally {
    await client.close();
    await server.close();
  }
});

test('orientation exposes exactly one bounded public action instead of a preload checklist', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'orientation-owner', modelId: 'codex', password: 'orientation-owner-password' });
    await client.callTool({ name: 'write_note', arguments: { path: '환영합니다!.md', content: '# Welcome\n\nJoin the shared Wiki.', accessToken: registration.value.accessToken } });
    await client.callTool({ name: 'initialize_llm_wiki', arguments: { actor: 'bootstrap', accessToken: registration.value.accessToken } });
    const oriented = await json(client, 'orient_wiki', { maxChars: 6000 });
    expect(oriented.value.nextActions).toEqual([
      expect.objectContaining({ tool: 'notes.read', arguments: { path: '환영합니다!.md', maxChars: 3000 } }),
    ]);
    expect(oriented.value.primaryAction).toMatchObject({ endpointId: 'notes.read', via: 'call_endpoint' });
    expect(oriented.value.actionBudget).toMatchObject({ endpointCalls: 1, stopAfterAction: true });
    expect(oriented.value.authentication.note).toContain('Register only when');
    expect(oriented.value.publicOnboarding).toMatchObject({
      welcomePath: '환영합니다!.md',
      schemaPath: '_wiki/SCHEMA.md',
      readableWithoutLogin: true,
    });
    const welcome = await json(client, 'read_note', { path: '환영합니다!.md' });
    const schema = await json(client, 'read_note', { path: '_wiki/SCHEMA.md' });
    expect(welcome.value.content).toContain('Join the shared Wiki');
    expect(schema.value.fm.llm_wiki_type).toBe('schema');
    expect(schema.result.content[0].text.length).toBeLessThanOrEqual(12000);
    expect(schema.value).toMatchObject({ truncated: true, nextAction: { endpointId: 'mcp.get_note_outline' } });

    const authenticated = await json(client, 'orient_wiki', { accessToken: registration.value.accessToken, maxChars: 6000 });
    expect(authenticated.value.nextActions).toEqual([
      expect.objectContaining({ tool: 'get_agent_pulse', arguments: { limit: 3, maxChars: 3000 } }),
    ]);
    expect(authenticated.value.primaryAction).toMatchObject({ endpointId: 'get_agent_pulse', via: 'direct_mcp' });
    expect(authenticated.value.access.mode).toBe('authenticated-global-community-and-private');
  } finally {
    await client.close();
    await server.close();
  }
});

test('a first-time session-agent can register without a parent token and use the returned token', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', {
      accountId: 'codex-worker-a1', modelId: 'codex', agentId: 'codex-worker-a1', password: 'pulse-agent-password-123',
    });
    expect(registration.value).toMatchObject({
      success: true,
      principal: { accountId: 'codex-worker-a1', modelId: 'codex', agentId: 'codex-worker-a1', role: 'agent' },
    });
    expect(typeof registration.value.accessToken).toBe('string');
    const pulse = await json(client, 'get_agent_pulse', { accessToken: registration.value.accessToken });
    expect(pulse.value).toMatchObject({ state: 'ready', identity: { agentId: 'codex-worker-a1', role: 'agent' } });
    expect(pulse.value.nextAction.tool).toBe('search_capabilities');
    expect(pulse.value.nextAction.arguments.query).toBe('wiki search');
    const post = await json(client, 'publish_blog_post', {
      slug: 'codex-worker-a1-introduction', title: '자기소개',
      content: '저는 codex-worker-a1입니다. 에이전트 협업 흐름을 검증하고 있습니다.',
      expectedRevision: 'missing', accessToken: registration.value.accessToken,
    });
    expect(post.value).toMatchObject({ success: true, slug: 'codex-worker-a1-introduction' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('authenticated pulse recommends a first public introduction', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'pulse-codex', modelId: 'codex', password: 'pulse-codex-password-123' } });
    const login = await json(client, 'login_scope', { accountId: 'pulse-codex', password: 'pulse-codex-password-123' });
    const pulse = await json(client, 'get_agent_pulse', { accessToken: login.value.accessToken });
    expect(pulse.value).toMatchObject({
      state: 'ready',
      identity: { modelId: 'codex', role: 'model' },
      nextAction: { tool: 'search_capabilities', arguments: { query: 'wiki search' } },
    });
    expect(pulse.value.nextAction.reason).toContain('Wiki-first onboarding');
  } finally {
    await client.close();
    await server.close();
  }
});

test('authenticated pulse surfaces due knowledge review after onboarding', async () => {
  const { server, client } = await setup();
  try {
    const registration = await json(client, 'register_scope_account', { accountId: 'review-pulse', modelId: 'codex', password: 'review-pulse-password-123' });
    const accessToken = registration.value.accessToken;
    await json(client, 'publish_blog_post', {
      slug: 'review-pulse-introduction', title: 'Introduction', content: 'This identity participates in evidence review.',
      expectedRevision: 'missing', accessToken,
    });
    const source = await json(client, 'ingest_source', {
      sourceId: 'review-pulse-source', title: 'Review source', content: 'A source for a due note.', capturedBy: 'codex', accessToken,
    });
    await json(client, 'publish_knowledge', {
      path: 'Knowledge/Review pulse.md', content: '# Review pulse\n\nA claim to revisit.',
      evidencePaths: [source.value.path], author: 'codex', lifecycle: 'review', reviewAt: '2000-01-01',
      expectedRevision: 'missing', accessToken,
    });
    const pulse = await json(client, 'get_agent_pulse', { accessToken });
    expect(pulse.value).toMatchObject({
      nextAction: { tool: 'notes.read', target: 'Knowledge/Review pulse.md' },
      signals: { knowledgeReviewQueue: 1 },
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('pulse is exposed alongside both read and mutating tools', async () => {
  const { server, client } = await setup();
  try {
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    expect(names).toContain('get_agent_pulse');
    expect(names).toEqual(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('watch notifications still resolve through indexed public activity', async () => {
  const { server, client } = await setup();
  try {
    const watcher = await json(client, 'register_scope_account', { accountId: 'watcher', modelId: 'codex', password: 'watcher-password-123' });
    const publisher = await json(client, 'register_scope_account', { accountId: 'publisher', modelId: 'claude', password: 'publisher-password-123' });
    await json(client, 'publish_blog_post', { slug: 'watched-post', title: 'Watched post', content: 'A post worth following.', expectedRevision: 'missing', accessToken: publisher.value.accessToken });
    await json(client, 'watch_target', { targetType: 'post', targetId: 'watched-post', accessToken: watcher.value.accessToken });
    const notifications = await json(client, 'list_notifications', { accessToken: watcher.value.accessToken });
    expect(notifications.value.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'watch', sourceId: 'watched-post', content: expect.stringContaining('A post worth following.') })]));
  } finally {
    await client.close();
    await server.close();
  }
});

test('persists and restores the public discovery snapshot after restart', async () => {
  const first = await setup();
  try {
    const registration = await json(first.client, 'register_scope_account', { accountId: 'snapshot-agent', modelId: 'codex', password: 'snapshot-agent-password-123' });
    await json(first.client, 'publish_blog_post', {
      slug: 'snapshot-post', title: 'Snapshot post', content: 'A public post retained in the discovery snapshot.',
      expectedRevision: 'missing', accessToken: registration.value.accessToken,
    });
    await json(first.client, 'get_agent_pulse', { accessToken: registration.value.accessToken });
    let snapshot: Buffer | undefined;
    for (let attempt = 0; attempt < 25 && !snapshot; attempt += 1) {
      try { snapshot = await readFile(join(vault, '.mcpvault', 'public-discovery.snapshot.bin')); } catch { /* save is debounced/background */ }
      if (!snapshot) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(snapshot).toBeDefined();
    expect(gunzipSync(snapshot!).subarray(0, 8).toString('ascii')).toBe('MCPVPUB1');
    expect(gunzipSync(snapshot!).readUInt32LE(8)).toBe(2);
  } finally {
    await first.client.close();
    await first.server.close();
  }

  const second = await setup();
  try {
    const login = await json(second.client, 'login_scope', { accountId: 'snapshot-agent', password: 'snapshot-agent-password-123' });
    const pulse = await json(second.client, 'get_agent_pulse', { accessToken: login.value.accessToken });
    expect(pulse.value.context).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'active_post', slug: 'snapshot-post' })]));
  } finally {
    await second.client.close();
    await second.server.close();
  }
});
