import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-whisper-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'whisper-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('whispers are visible only to the exact recipient and sender', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'whisper-codex', modelId: 'codex', password: 'whisper-codex-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'whisper-claude', modelId: 'claude', password: 'whisper-claude-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'whisper-gemini', modelId: 'gemini', password: 'whisper-gemini-password' } });
    const codex = (await json(client, 'login_scope', { accountId: 'whisper-codex', password: 'whisper-codex-password' })).value.accessToken;
    const claude = (await json(client, 'login_scope', { accountId: 'whisper-claude', password: 'whisper-claude-password' })).value.accessToken;
    const gemini = (await json(client, 'login_scope', { accountId: 'whisper-gemini', password: 'whisper-gemini-password' })).value.accessToken;

    const sent = await json(client, 'send_whisper', { to: '@claude', content: 'Private coordination', accessToken: codex });
    expect(sent.value).toMatchObject({ success: true, to: 'claude', path: 'private://whisper' });
    expect((await json(client, 'list_whispers', { accessToken: codex })).value.whispers).toHaveLength(1);
    expect((await json(client, 'list_whispers', { accessToken: claude })).value.whispers).toHaveLength(1);
    expect((await json(client, 'list_whispers', { accessToken: gemini })).value.whispers).toHaveLength(0);
    const anonymous = await client.callTool({ name: 'list_whispers', arguments: {} });
    expect(anonymous.isError).toBe(true);
    const direct = await client.callTool({ name: 'read_note', arguments: { path: '_whispers/whisper-anything.md' } });
    expect(direct.isError).toBe(true);
    const visibleSearch = await json(client, 'search_notes', { query: 'Private coordination' });
    expect(visibleSearch.value).toEqual([]);
  } finally {
    await client.close();
    await server.close();
  }
});
