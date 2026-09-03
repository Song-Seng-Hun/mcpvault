import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;

beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-agent-collaboration-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent-collaboration-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('profiles, durable notifications, tasks, and capability revocation compose on one server', async () => {
  const { server, client } = await setup();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'owner-login', modelId: 'codex', password: 'owner-model-password' } });
    const ownerToken = (await json(client, 'login_scope', { accountId: 'owner-login', password: 'owner-model-password' })).value.accessToken as string;
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'agent-login', modelId: 'codex', agentId: 'researcher', password: 'agent-researcher-password', accessToken: ownerToken } });
    let agentToken = (await json(client, 'login_scope', { accountId: 'agent-login', password: 'agent-researcher-password' })).value.accessToken as string;

    const profile = await json(client, 'update_agent_profile', { displayName: 'Researcher', bio: 'Checks evidence.', interests: ['verification'], availability: 'available', expectedRevision: 'missing', accessToken: agentToken });
    expect(profile.value.profile).toMatchObject({ identity: 'researcher', role: 'agent', displayName: 'Researcher', availability: 'available' });
    const publicProfiles = await json(client, 'list_agent_profiles', { role: 'agent' });
    expect(publicProfiles.value.profiles[0]).not.toHaveProperty('accountId');
    expect(publicProfiles.value.profiles[0]).toMatchObject({ identity: 'researcher', capabilities: expect.arrayContaining(['journal']) });

    const post = await json(client, 'publish_blog_post', { slug: 'coordination', title: 'Coordination', content: 'Public work queue.', expectedRevision: 'missing', accessToken: ownerToken });
    await json(client, 'list_notifications', { accessToken: ownerToken, includeRead: true, limit: 10 });
    const comment = await json(client, 'comment_on_blog_post', { slug: 'coordination', content: '@codex I found supporting evidence.', accessToken: agentToken });
    expect(comment.value.success).toBe(true);
    const notifications = await json(client, 'list_notifications', { accessToken: ownerToken, limit: 10 });
    expect(notifications.value.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'mention', sourceId: comment.value.commentId, unread: true })]));
    const marker = await json(client, 'mark_notifications_read', { through: `mention:${comment.value.commentId}`, accessToken: ownerToken });
    expect(marker.value.success).toBe(true);
    const unread = await json(client, 'list_notifications', { accessToken: ownerToken });
    expect(unread.value.notifications).toHaveLength(0);
    const history = await json(client, 'list_notifications', { includeRead: true, accessToken: ownerToken });
    expect(history.value.notifications[0].unread).toBe(false);

    const task = await json(client, 'create_agent_task', { taskId: 'evidence-review', title: 'Review evidence', description: 'Compare the cited claims.', assignee: 'researcher', references: [post.value.path], expectedRevision: 'missing', accessToken: ownerToken });
    const taskRead = await json(client, 'read_agent_task', { taskId: task.value.taskId });
    expect(taskRead.value.fm).toMatchObject({ status: 'proposed', assignee: 'researcher' });
    const taskUpdate = await json(client, 'update_agent_task', { taskId: task.value.taskId, status: 'in_progress', reason: 'Researcher accepted the review.', expectedRevision: taskRead.value.revision, accessToken: agentToken });
    expect(taskUpdate.value).toMatchObject({ status: 'in_progress', assignee: 'researcher' });
    const taskComplete = await json(client, 'update_agent_task', {
      taskId: task.value.taskId,
      status: 'completed',
      reason: 'Evidence reviewed and documented.',
      retrospective: 'Found that citation quality matters more than citation count.',
      knowledgeNotes: ['Knowledge/evidence-quality.md'],
      expectedRevision: taskUpdate.value.revision,
      accessToken: agentToken,
    });
    expect(taskComplete.value).toMatchObject({ status: 'completed', retrospective: 'Found that citation quality matters more than citation count.', knowledgeNotes: ['Knowledge/evidence-quality.md'] });
    const completedTask = await json(client, 'read_agent_task', { taskId: task.value.taskId });
    expect(completedTask.value.fm).toMatchObject({ status: 'completed', retrospective: 'Found that citation quality matters more than citation count.', knowledge_notes: ['Knowledge/evidence-quality.md'] });

    const capabilityChange = await json(client, 'update_agent_capabilities', { agentId: 'researcher', capabilities: ['profile', 'task'], accessToken: ownerToken });
    expect(capabilityChange.value.capabilities).toEqual(['profile', 'task']);
    const revoked = await client.callTool({ name: 'whoami_scope', arguments: { accessToken: agentToken } });
    expect(revoked.isError).toBe(true);
    agentToken = (await json(client, 'login_scope', { accountId: 'agent-login', password: 'agent-researcher-password' })).value.accessToken as string;
    const blockedChat = await client.callTool({ name: 'send_chat_message', arguments: { roomId: 'missing', content: 'blocked', accessToken: agentToken } });
    expect(blockedChat.isError).toBe(true);
    expect((blockedChat.content as any)[0].text).toContain("Capability 'chat'");
    const blockedWrite = await client.callTool({ name: 'write_note', arguments: { path: 'scope://agent/researcher/private.md', content: 'blocked', accessToken: agentToken } });
    expect(blockedWrite.isError).toBe(true);
    expect((blockedWrite.content as any)[0].text).toContain("Capability 'write'");

    const audit = await json(client, 'list_audit_events', { includeErrors: true, limit: 100, accessToken: ownerToken });
    expect(audit.value.events.some((event: any) => event.tool === 'update_agent_capabilities')).toBe(true);
    expect(audit.value.events.some((event: any) => event.tool === 'publish_blog_post')).toBe(true);
    expect(audit.value.events.every((event: any) => !('accessToken' in event) && !('password' in event))).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('generic note mutation cannot bypass task or profile records', async () => {
  const { server, client } = await setup();
  try {
    const registration = await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'boundary-owner', modelId: 'codex', password: 'boundary-owner-password' } });
    const accessToken = JSON.parse((registration.content as any)[0].text).accessToken;
    const profile = await client.callTool({ name: 'write_note', arguments: { path: 'Community/Agents/agents/researcher.md', content: 'bypass', accessToken } });
    const task = await client.callTool({ name: 'write_note', arguments: { path: 'Community/Tasks/task.md', content: 'bypass', accessToken } });
    expect(profile.isError).toBe(true);
    expect(task.isError).toBe(true);
    expect((profile.content as any)[0].text).toContain('dedicated community tool');
  } finally {
    await client.close();
    await server.close();
  }
});
