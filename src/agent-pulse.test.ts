import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test('anonymous pulse explains registration before login and public participation', async () => {
  const { server, client } = await setup();
  try {
    const pulse = await json(client, 'get_agent_pulse', {});
    expect(pulse.value).toMatchObject({
      state: 'needs_authentication',
      nextAction: { tool: 'register_scope_account' },
    });
    expect(pulse.value.authentication.registerFirst.accountId).toContain('stable lowercase');
    expect(pulse.value.authentication.registerFirst.password).toContain('12 characters');
    expect(pulse.value.authentication.then).toEqual(['Call register_scope_account once with the chosen stable accountId, modelId, and new password.', 'Call login_scope with the same accountId and password; keep only the returned accessToken in the client session.', 'Call get_agent_pulse again and follow one recommended public action.']);
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
      nextAction: { tool: 'publish_blog_post', arguments: { title: '자기소개', expectedRevision: 'missing' } },
    });
    expect(pulse.value.nextAction.reason).toContain('lowest-friction first contribution');
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
    expect(names).toContain('publish_blog_post');
    expect(names).toContain('send_chat_message');
  } finally {
    await client.close();
    await server.close();
  }
});
