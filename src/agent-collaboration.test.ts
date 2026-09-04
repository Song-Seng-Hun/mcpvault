import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    await mkdir(join(vault, 'Knowledge'), { recursive: true });
    await writeFile(join(vault, 'Knowledge/evidence-quality.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: review\nknowledge_status: draft\n---\n# Evidence quality\n');
    const taskComplete = await json(client, 'update_agent_task', {
      taskId: task.value.taskId,
      status: 'completed',
      reason: 'Evidence reviewed and documented.',
      retrospective: 'Found that citation quality matters more than citation count.',
      knowledgeNotes: ['Knowledge/evidence-quality.md'],
      expectedRevision: taskUpdate.value.revision,
      accessToken: agentToken,
    });
    expect(taskComplete.value).toMatchObject({ status: 'completed', retrospective: 'Found that citation quality matters more than citation count.', knowledgeNotes: ['Knowledge/evidence-quality.md'], knowledgeDispositions: ['linked_knowledge', 'retrospective'] });
    const completedTask = await json(client, 'read_agent_task', { taskId: task.value.taskId });
    expect(completedTask.value.fm).toMatchObject({ status: 'completed', retrospective: 'Found that citation quality matters more than citation count.', knowledge_notes: ['Knowledge/evidence-quality.md'], knowledge_dispositions: ['linked_knowledge', 'retrospective'] });

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

test('task completion requires a bounded auditable knowledge disposition', async () => {
  const { server, client } = await setup();
  try {
    const registration = await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'disposition-owner', modelId: 'codex', password: 'disposition-owner-password' } });
    const accessToken = JSON.parse((registration.content as any)[0].text).accessToken as string;
    await mkdir(join(vault, 'Knowledge/Failed approaches'), { recursive: true });
    await writeFile(join(vault, 'Knowledge/Durable lesson.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: review\nknowledge_status: draft\n---\n# Durable lesson\n');
    await writeFile(join(vault, 'Knowledge/Failed approaches/Blind retry.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: review\nknowledge_status: disputed\nknowledge_polarity: negative\nnegative_type: failure\n---\n# Blind retry\n');

    const createTask = async (taskId: string) => json(client, 'create_agent_task', {
      taskId,
      title: `Disposition ${taskId}`,
      description: 'Verify that task learning is not silently discarded.',
      expectedRevision: 'missing',
      accessToken,
    });

    const missing = await createTask('missing-disposition');
    const rejected = await client.callTool({ name: 'update_agent_task', arguments: {
      taskId: missing.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      expectedRevision: missing.value.revision,
      accessToken,
    } });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain('knowledge disposition');
    expect((await json(client, 'read_agent_task', { taskId: missing.value.taskId })).value.fm.status).toBe('proposed');

    const retrospectiveTask = await createTask('retrospective-disposition');
    const retrospective = await json(client, 'update_agent_task', {
      taskId: retrospectiveTask.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      retrospective: 'Revision guards prevented an accidental overwrite.',
      expectedRevision: retrospectiveTask.value.revision,
      accessToken,
    });
    expect(retrospective.value).toMatchObject({ knowledgeDispositions: ['retrospective'] });

    const linkedTask = await createTask('linked-disposition');
    const linked = await json(client, 'update_agent_task', {
      taskId: linkedTask.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      knowledgeNotes: ['Knowledge/Durable lesson.md'],
      expectedRevision: linkedTask.value.revision,
      accessToken,
    });
    expect(linked.value).toMatchObject({ knowledgeDispositions: ['linked_knowledge'], knowledgeNotes: ['Knowledge/Durable lesson.md'] });

    const negativeTask = await createTask('negative-disposition');
    const negative = await json(client, 'update_agent_task', {
      taskId: negativeTask.value.taskId,
      status: 'completed',
      reason: 'The attempted approach failed.',
      negativeKnowledgeNotes: ['Knowledge/Failed approaches/Blind retry.md'],
      expectedRevision: negativeTask.value.revision,
      accessToken,
    });
    expect(negative.value).toMatchObject({ knowledgeDispositions: ['negative_knowledge'], negativeKnowledgeNotes: ['Knowledge/Failed approaches/Blind retry.md'] });

    const emptyTask = await createTask('no-reusable-disposition');
    const noReusable = await json(client, 'update_agent_task', {
      taskId: emptyTask.value.taskId,
      status: 'completed',
      reason: 'The acknowledgement is complete.',
      noReusableKnowledge: true,
      knowledgeDispositionReason: 'The task only confirmed an already documented fact and produced no new reusable result.',
      expectedRevision: emptyTask.value.revision,
      accessToken,
    });
    expect(noReusable.value).toMatchObject({ knowledgeDispositions: ['no_reusable_knowledge'], knowledgeDispositionReason: expect.stringContaining('already documented') });

    const contradictoryTask = await createTask('contradictory-disposition');
    const contradictory = await client.callTool({ name: 'update_agent_task', arguments: {
      taskId: contradictoryTask.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      retrospective: 'A reusable lesson exists.',
      noReusableKnowledge: true,
      knowledgeDispositionReason: 'No reusable result.',
      expectedRevision: contradictoryTask.value.revision,
      accessToken,
    } });
    expect(contradictory.isError).toBe(true);
    expect((contradictory.content as any)[0].text).toContain('cannot be combined');

    const invalidTask = await createTask('invalid-linked-disposition');
    const invalid = await client.callTool({ name: 'update_agent_task', arguments: {
      taskId: invalidTask.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      knowledgeNotes: ['Knowledge/does-not-exist.md'],
      expectedRevision: invalidTask.value.revision,
      accessToken,
    } });
    expect(invalid.isError).toBe(true);
    expect((invalid.content as any)[0].text).toContain('visible public knowledge notes');
    expect((invalid.content as any)[0].text).not.toContain('does-not-exist');

    const staleTask = await createTask('stale-disposition');
    const changed = await json(client, 'update_agent_task', {
      taskId: staleTask.value.taskId,
      status: 'in_progress',
      reason: 'Work started.',
      expectedRevision: staleTask.value.revision,
      accessToken,
    });
    const stale = await client.callTool({ name: 'update_agent_task', arguments: {
      taskId: staleTask.value.taskId,
      status: 'completed',
      reason: 'Work finished.',
      retrospective: 'This update used a stale revision.',
      expectedRevision: staleTask.value.revision,
      accessToken,
    } });
    expect(stale.isError).toBe(true);
    expect((stale.content as any)[0].text).toMatch(/revision/i);
    expect(changed.value.status).toBe('in_progress');

    const legacyTask = await createTask('legacy-compatible');
    await writeFile(join(vault, 'Community/Tasks/legacy-compatible.md'), `---\nmcpvault_type: agent_task\ntask_id: legacy-compatible\ntitle: Legacy compatible\ndescription: Historical completion.\nrequester: codex\nrequester_role: model\nstatus: completed\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n# Legacy compatible\n\nHistorical completion.\n`);
    const legacyRead = await json(client, 'read_agent_task', { taskId: legacyTask.value.taskId });
    const legacyUpdate = await json(client, 'update_agent_task', {
      taskId: legacyTask.value.taskId,
      description: 'Historical completion remains editable.',
      expectedRevision: legacyRead.value.revision,
      accessToken,
    });
    expect(legacyUpdate.value.status).toBe('completed');
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
