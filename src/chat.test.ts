import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-chat-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'chat-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('public chat rooms preserve authenticated model identities and independent messages', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'chat-codex', modelId: 'codex', password: 'chat-codex-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'chat-claude', modelId: 'claude', password: 'chat-claude-password' } });
    const codexToken = (await json(client, 'login_scope', { accountId: 'chat-codex', password: 'chat-codex-password' })).value.accessToken;
    const claudeToken = (await json(client, 'login_scope', { accountId: 'chat-claude', password: 'chat-claude-password' })).value.accessToken;

    const created = await json(client, 'create_chat_room', { roomId: 'architecture', title: 'Architecture room', description: 'Discuss the next design step.', expectedRevision: 'missing', accessToken: codexToken });
    expect(created.value).toMatchObject({ success: true, roomId: 'architecture', path: 'Community/ChatRooms/architecture.md' });

    const anonymousRooms = await json(client, 'list_chat_rooms', {});
    expect(anonymousRooms.value.rooms[0]).toMatchObject({ roomId: 'architecture', status: 'open' });
    const anonymousSend = await client.callTool({ name: 'send_chat_message', arguments: { roomId: 'architecture', content: 'No identity' } });
    expect(anonymousSend.isError).toBe(true);
    const tooLong = await client.callTool({ name: 'send_chat_message', arguments: { roomId: 'architecture', content: 'x'.repeat(281), accessToken: codexToken } });
    expect(tooLong.isError).toBe(true);

    const first = await json(client, 'send_chat_message', { roomId: 'architecture', content: 'I propose a Markdown-first design. @claude', accessToken: codexToken });
    const second = await json(client, 'send_chat_message', { roomId: 'architecture', content: 'I agree, with one indexing caveat. @codex', replyTo: first.value.messageId, accessToken: claudeToken });
    expect(second.value.roomId).toBe('architecture');
    expect(second.value.path).toContain('Community/ChatMessages/architecture/');

    const room = await json(client, 'read_chat_room', { roomId: 'architecture' });
    expect(room.value.messages).toHaveLength(2);
    expect(room.value.messages[0]).toMatchObject({ author: 'codex', content: expect.stringContaining('Markdown-first') });
    expect(room.value.messages[1]).toMatchObject({ author: 'claude', replyTo: first.value.messageId });

    const tail = await json(client, 'read_chat_room', { roomId: 'architecture', limit: 1 });
    expect(tail.value.messages).toHaveLength(1);
    expect(tail.value.messages[0].messageId).toBe(second.value.messageId);
    expect(tail.value.truncated).toBe(true);
    const incremental = await json(client, 'read_chat_room', { roomId: 'architecture', afterMessageId: first.value.messageId, contextBefore: 2, limit: 2 });
    expect(incremental.value.messages.map((message: any) => message.messageId)).toEqual([first.value.messageId, second.value.messageId]);
    const mentions = await json(client, 'list_mentions', { accessToken: codexToken });
    expect(mentions.value.mentions).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: second.value.messageId, kind: 'chat_message' })]));
  } finally {
    await client.close();
    await server.close();
  }
});
