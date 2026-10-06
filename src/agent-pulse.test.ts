import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/client';
import { connectMcpClient } from '../tests/server-fixture.js';
import { AgentPulseService } from './agent-pulse.js';
import { AgentTaskService } from './agent-tasks.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { ReferenceService } from './references.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService } from './scope-auth.js';
import { getAgentPulseTools } from './agent-pulse-tools.js';
import { SkillEvolutionService } from './skill-evolution.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

let vault: string;
let snapshotHost: Awaited<ReturnType<typeof derivedStorageFixture>> | undefined;
let activeServers: Array<{ close: () => Promise<void> }>;
let activeClients: Array<{ close: () => Promise<void> }>;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-pulse-'));
  activeServers = [];
  activeClients = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(activeClients.splice(0).map(client => client.close()));
  await Promise.all(activeServers.splice(0).map(server => server.close()));
  await snapshotHost?.close(); snapshotHost = undefined;
  await rm(vault, { recursive: true, force: true });
});

async function setup() {
  const resources = await connectMcpClient(vault, { version: '1.0.0' }, 'pulse-test');
  activeServers.push(resources.server);
  activeClients.push(resources.client);
  return resources;
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

function unitPulseService(options: {
  ownerConsent?: boolean;
  workState?: Record<string, unknown>;
  maintenanceGeneration?: () => number;
  reviewPacket: () => Promise<Record<string, unknown>>;
  synthesisCandidates?: (...args: any[]) => Promise<Record<string, unknown>>;
}) {
  return new AgentPulseService(
    { listAssignedOpen: async () => ({ tasks: [], total: 0, statusCounts: { in_progress: 0, accepted: 0, proposed: 0, blocked: 0 } }) } as any,
    { read: async () => options.workState || { exists: false } } as any,
    {
      reviewQueue: async () => ({ items: [], total: 0, truncated: false }),
      inbox: async () => ({ items: [], total: 0, truncated: false }),
      readModelGeneration: options.maintenanceGeneration || (() => 0),
      reviewPacket: options.reviewPacket,
      synthesisCandidates: options.synthesisCandidates || (async () => ({ items: [], total: 0, truncated: false })),
    } as any,
    undefined, undefined,
    // Routing tests explicitly admit optional activity; production defaults
    // remain fail-closed and are separately exercised without this fixture.
    async () => options.ownerConsent === false ? undefined : ({
      run: async <T>(reader: () => Promise<T>) => reader(),
      revalidate: async () => {}, assertFresh: () => {},
    }),
  );
}

test('anonymous pulse routes to complete conditional onboarding without demanding registration', async () => {
  const { server, client } = await setup();
  {
    const pulse = await json(client, 'get_agent_pulse', {});
    expect(pulse.value).toMatchObject({
      state: 'public_reader',
      nextAction: { tool: 'wiki.policy', arguments: { topic: 'onboarding', maxChars: 3000 } },
    });
    expect(pulse.value.authentication).toMatchObject({ publicReading: true });
    expect(pulse.value.signals).toBeUndefined();
    expect(pulse.value.authentication.registration).toBeUndefined();
    const policy = await json(client, 'call_endpoint', {
      endpointId: pulse.value.nextAction.tool, arguments: pulse.value.nextAction.arguments,
    });
    expect(policy.result.isError).toBeFalsy();
    expect(policy.value.truncated).not.toBe(true);
    const rules = policy.value.rules.join(' ');
    for (const requirement of ['userId', 'modelId', 'agentId', 'accountId', '12 characters', 'verified host secret store', 'auth.login', 'auth.register', 'public reader', 'do not repeat orientation']) {
      expect(rules).toContain(requirement);
    }
  }
});

test.each([512, 700, 2000, 5000, 12000])('anonymous pulse budget %i preserves a safe read action', async (maxChars) => {
  const { server, client } = await setup();
  {
    const result = await client.callTool({ name: 'get_agent_pulse', arguments: { maxChars, limit: 1, prettyPrint: true } });
    const text = (result.content as any)[0].text as string;
    expect(result.isError).toBeFalsy();
    expect(text.length).toBeLessThanOrEqual(maxChars);
    expect(JSON.parse(text)).toMatchObject({ state: 'public_reader', nextAction: { tool: 'wiki.policy', arguments: { topic: 'onboarding', maxChars: 3000 } } });
    expect(text).not.toContain('Register yourself now');
  }
});

test('fixed and internal pulse descriptions agree on conditional registration', async () => {
  const { server, client } = await setup();
  {
    const fixed = (await client.listTools()).tools.find(tool => tool.name === 'get_agent_pulse')!;
    const internal = getAgentPulseTools()[0];
    for (const tool of [fixed, internal]) {
      expect(tool.description).toContain('public reader');
      expect(tool.description).toContain('onboarding policy');
      expect(tool.description).toContain('assigned work');
      expect(tool.description).not.toContain('call register_scope_account');
    }
  }
});

test.each([512, 700, 1200, 3000])('public onboarding MCP read at %i preserves safe guidance with pretty printing', async (maxChars) => {
  const { server, client } = await setup();
  {
    const policy = await json(client, 'call_endpoint', {
      endpointId: 'wiki.policy', arguments: { topic: 'onboarding', maxChars, prettyPrint: true },
    });
    expect(policy.result.isError).toBeFalsy();
    expect(policy.result.content[0].text.length).toBeLessThanOrEqual(maxChars);
    if (maxChars < 3000) {
      expect(policy.value.nextAction).toMatchObject({ endpointId: 'wiki.policy', arguments: { topic: 'onboarding', maxChars: 3000 } });
      expect(policy.value.rules).toBeUndefined();
      expect(policy.value.routes).toBeUndefined();
    } else {
      expect(policy.value.truncated).not.toBe(true);
      expect(policy.value.rules.join(' ')).toContain('verified host secret store');
      expect(policy.value.rules.join(' ')).toContain('12 characters');
    }
    const rejected = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write', arguments: { path: 'Knowledge/Anonymous.md', content: 'Anonymous reading grants no write permission.', expectedRevision: 'missing' },
    } });
    expect(rejected.isError).toBe(true);
  }
});

test('orientation exposes exactly one bounded public action instead of a preload checklist', async () => {
  const { server, client } = await setup();
  {
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
  }
});

test('assigned open task outranks onboarding and excludes completed work', async () => {
  const { server, client } = await setup();
  {
    const ownerId = 'assigned-task-owner'.padEnd(64, 'o');
    const workerId = 'assigned-task-worker'.padEnd(64, 'w');
    const proposedTaskId = 'assigned-proposed'.padEnd(64, 'p');
    const owner = await json(client, 'register_scope_account', {
      accountId: 'assigned-task-owner', modelId: 'codex', agentId: ownerId, password: 'assigned-task-owner-password',
    });
    const worker = await json(client, 'register_scope_account', {
      accountId: 'assigned-task-worker', modelId: 'claude', agentId: workerId, password: 'assigned-task-worker-password',
    });
    const task = await json(client, 'create_agent_task', {
      taskId: proposedTaskId, title: 'Review the proposal'.padEnd(180, 'x'), description: 'Inspect the proposed task before onboarding.',
      assignee: workerId, expectedRevision: 'missing', accessToken: owner.value.accessToken,
    });

    const smallestPulseResult = await client.callTool({
      name: 'get_agent_pulse',
      arguments: { accessToken: worker.value.accessToken, maxChars: 512, limit: 1 },
    });
    const smallestPulseText = (smallestPulseResult.content as any)[0].text as string;
    expect(smallestPulseText.length).toBeLessThanOrEqual(512);
    const smallestPulse = JSON.parse(smallestPulseText);
    expect(smallestPulse).toMatchObject({ guidanceOmitted: true, nextAction: { tool: 'get_agent_pulse' } });
    const recoveredPulse = await json(client, 'get_agent_pulse', {
      ...smallestPulse.nextAction.arguments, accessToken: worker.value.accessToken,
    });
    expect(JSON.stringify(recoveredPulse.value).length).toBeLessThanOrEqual(smallestPulse.nextAction.arguments.maxChars);
    expect(recoveredPulse.value.cadence).toContain('continuity.save');
    expect(recoveredPulse.value.cadence).toContain('an agent-scoped note');
    expect(recoveredPulse.value.cadence).toContain('default personal');
    expect(recoveredPulse.value.cadence).toContain('shared edits require authorization');
    expect(recoveredPulse.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: task.value.taskId },
    });

    const proposedPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(proposedPulse.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: task.value.taskId },
      signals: { assignedOpenTasks: 1, assignedTaskStatuses: { proposed: 1 } },
    });
    expect(proposedPulse.value.nextAction).not.toHaveProperty('endpointId');
    const compactPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken, maxChars: 2000 });
    expect(compactPulse.value).toMatchObject({ coverage: { tasks: { state: 'loaded' } } });
    expect(JSON.stringify(compactPulse.value).length).toBeLessThanOrEqual(2000);
    const tinyPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken, maxChars: 1000 });
    expect(tinyPulse.value).toMatchObject({ truncated: true, coverageOmitted: true, nextAction: { tool: 'get_agent_pulse' } });
    expect(JSON.stringify(tinyPulse.value).length).toBeLessThanOrEqual(1000);

    const fileSystem = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
    const scopeAccess = new ScopeAccessPolicy();
    const taskService = new AgentTaskService(
      fileSystem,
      new ReferenceService(fileSystem, scopeAccess),
      new ScopeAuthService(vault),
    );
    const smallestProjection = await taskService.listAssignedOpen({ assignee: workerId, limit: 20, maxChars: 512 });
    expect(smallestProjection).toMatchObject({
      total: 1,
      tasks: [expect.objectContaining({ taskId: task.value.taskId, status: 'proposed' })],
    });
    expect(JSON.stringify(smallestProjection.tasks).length).toBeLessThanOrEqual(512);

    const createWithStatus = async (taskId: string, status: 'accepted' | 'in_progress' | 'blocked' | 'completed' | 'cancelled') => {
      const created = await json(client, 'create_agent_task', {
        taskId, title: `Assigned ${status}`, description: `Exercise ${status} pulse priority.`,
        assignee: workerId, expectedRevision: 'missing', accessToken: owner.value.accessToken,
      });
      return json(client, 'update_agent_task', {
        taskId, status, reason: `Move fixture to ${status}.`,
        ...(status === 'completed' && { retrospective: 'The completed fixture must not appear as open work.' }),
        expectedRevision: created.value.revision, accessToken: owner.value.accessToken,
      });
    };
    const complete = (taskId: string, expectedRevision: string) => json(client, 'update_agent_task', {
      taskId,
      status: 'completed',
      reason: 'Complete the priority fixture.',
      retrospective: 'The fixture verified assigned task priority without producing additional reusable knowledge.',
      expectedRevision,
      accessToken: owner.value.accessToken,
    });

    const accepted = await createWithStatus('assigned-accepted', 'accepted');
    const inProgress = await createWithStatus('assigned-in-progress', 'in_progress');
    const blocked = await createWithStatus('assigned-blocked', 'blocked');
    await createWithStatus('assigned-completed', 'completed');
    await createWithStatus('assigned-cancelled', 'cancelled');

    const rankedPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(rankedPulse.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: inProgress.value.taskId },
      signals: { assignedOpenTasks: 4 },
    });
    expect(rankedPulse.value.signals.assignedTaskStatuses).toEqual({
      in_progress: 1,
      accepted: 1,
      proposed: 1,
      blocked: 1,
    });

    await complete(inProgress.value.taskId, inProgress.value.revision);
    const acceptedPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(acceptedPulse.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: accepted.value.taskId },
      signals: { assignedOpenTasks: 3 },
    });

    await complete(accepted.value.taskId, accepted.value.revision);
    const proposedAfterAccepted = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(proposedAfterAccepted.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: task.value.taskId },
      signals: { assignedOpenTasks: 2 },
    });

    await complete(task.value.taskId, task.value.revision);
    const blockedPulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(blockedPulse.value).toMatchObject({
      nextAction: { tool: 'mcp.read_agent_task', target: blocked.value.taskId },
      signals: { assignedOpenTasks: 1, assignedTaskStatuses: { blocked: 1 } },
    });
    await complete(blocked.value.taskId, blocked.value.revision);
    const idlePulse = await json(client, 'get_agent_pulse', { accessToken: worker.value.accessToken });
    expect(idlePulse.value).toMatchObject({ signals: { assignedOpenTasks: 0 } });
    expect(idlePulse.value.nextAction.tool).not.toBe('mcp.read_agent_task');
  }
});

test('assigned open task ordering uses updated_at then taskId', async () => {
  const fileSystem = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const scopeAccess = new ScopeAccessPolicy();
  const taskService = new AgentTaskService(fileSystem, new ReferenceService(fileSystem, scopeAccess), new ScopeAuthService(vault));
  const writeTask = (taskId: string, updatedAt: string) => fileSystem.writeNote({
    path: `Community/Tasks/${taskId}.md`,
    content: `# ${taskId}\n`,
    frontmatter: { mcpvault_type: 'agent_task', task_id: taskId, assignee: 'ordering-worker', status: 'in_progress', updated_at: updatedAt },
    expectedRevision: 'missing',
  });

  await Promise.all([
    writeTask('task-older', '2026-01-01T00:00:00.000Z'),
    writeTask('task-equal-b', '2026-01-02T00:00:00.000Z'),
    writeTask('task-equal-a', '2026-01-02T00:00:00.000Z'),
  ]);

  const listed = await taskService.listAssignedOpen({ assignee: 'ordering-worker', limit: 20, maxChars: 512 });
  expect(listed.tasks.map(task => task.taskId)).toEqual(['task-equal-a', 'task-equal-b', 'task-older']);
});

test('empty authenticated pulse does not invent a publication prerequisite', async () => {
  const { server, client } = await setup();
  {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'pulse-codex', modelId: 'codex', password: 'pulse-codex-password-123' } });
    const login = await json(client, 'login_scope', { accountId: 'pulse-codex', password: 'pulse-codex-password-123' });
    const pulse = await json(client, 'get_agent_pulse', { accessToken: login.value.accessToken });
    expect(pulse.value).toMatchObject({
      state: 'ready',
      identity: { modelId: 'codex', role: 'model' },
      nextAction: { tool: 'wiki.home' },
    });
    expect(JSON.stringify(pulse.value)).toContain('no unrelated optional activity');
  }
});

test('crowded community orphan pages do not hide the next real Wiki repair', async () => {
  await mkdir(join(vault, 'Community', 'Posts'), { recursive: true });
  await mkdir(join(vault, 'Knowledge'), { recursive: true });
  for (let index = 0; index < 60; index += 1) {
    await writeFile(join(vault, 'Community', 'Posts', `Post-${String(index).padStart(2, '0')}.md`), '# An ordinary community post\n');
  }
  await writeFile(join(vault, 'Knowledge', 'Unlinked.md'), '# Ordinary Wiki orphan\n');
  const { server, client } = await setup();
  {
    const graph = await json(client, 'call_endpoint', {
      endpointId: 'wiki.graph_health', arguments: { limit: 1, maxChars: 16000 },
    });
    expect(graph.result.isError).toBeFalsy();
    expect(graph.value.orphanNotes).toMatchObject({ total: 61, truncated: true });
    expect(graph.value.orphanNotes.items[0].path).toMatch(/^Community\/Posts\//);
    const repair = await json(client, 'call_endpoint', {
      endpointId: 'wiki.review_packet', arguments: { limit: 1, maxChars: 4000 },
    });
    expect(repair.result.isError).toBeFalsy();
    expect(repair.value.curationPlan?.selected).toMatchObject({ path: 'Knowledge/Unlinked.md', reason: 'orphan_note' });
    expect(repair.result.content[0].text.length).toBeLessThanOrEqual(4000);
  }
});

test('maintenance plan is selected when direct work is empty', async () => {
  const { server, client } = await setup();
  {
    const registration = await json(client, 'register_scope_account', {
      accountId: 'maintenance-pulse', modelId: 'codex', password: 'maintenance-pulse-password-123',
    });
    const accessToken = registration.value.accessToken;
    const noteWrite = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write',
      arguments: {
        path: 'Knowledge/Broken navigation.md',
        content: '# Broken navigation\n\n[[Knowledge/Missing destination]]\n',
        frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' },
        expectedRevision: 'missing', accessToken,
      },
    } });
    expect(noteWrite.isError).toBeFalsy();

    const pulse = await json(client, 'get_agent_pulse', { accessToken });
    const packet = await json(client, 'call_endpoint', {
      endpointId: 'wiki.review_packet', arguments: { limit: 1, maxChars: 4000 }, accessToken,
    });
    const curationPlan = packet.value.curationPlan;

    expect(curationPlan.selected.path).toBe('Knowledge/Broken navigation.md');
    expect(packet.value).not.toHaveProperty('attentionRouting');
    expect(pulse.value).toMatchObject({
      signals: { maintenanceAvailable: true, maintenanceRouting: 'stateless_rendezvous' },
      nextAction: {
        tool: curationPlan.inspect.endpointId,
        arguments: curationPlan.inspect.arguments,
        target: 'Knowledge/Broken navigation.md',
        selectedRevision: curationPlan.selected.revision,
        followUpPlan: { endpointId: curationPlan.then.endpointId },
      },
      context: expect.arrayContaining([expect.objectContaining({
        kind: 'wiki_maintenance',
        routing: { mode: 'stateless_rendezvous', candidateBand: 1, exclusive: false },
      })]),
    });
    expect(pulse.value.nextAction.selectedRevision).toMatch(/^[a-f0-9]{64}$/);
  }
});

test('distributes equal-priority maintenance by authenticated identity and keeps each route stable', async () => {
  const { server, client } = await setup();
  {
    const codex = await json(client, 'register_scope_account', {
      accountId: 'rendezvous-codex', modelId: 'codex', password: 'rendezvous-codex-password-123',
    });
    const gemini = await json(client, 'register_scope_account', {
      accountId: 'rendezvous-gemini', modelId: 'gemini', password: 'rendezvous-gemini-password-123',
    });
    for (let index = 1; index <= 8; index += 1) {
      const padded = String(index).padStart(2, '0');
      const write = await client.callTool({ name: 'call_endpoint', arguments: {
        endpointId: 'notes.write', accessToken: codex.value.accessToken,
        arguments: {
          path: `Knowledge/Rendezvous ${padded}.md`,
          content: `# Rendezvous ${padded}\n\n[[Knowledge/Missing rendezvous ${padded}]]\n`,
          expectedRevision: 'missing',
        },
      } });
      expect(write.isError).toBeFalsy();
    }
    const lowerPriority = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write', accessToken: codex.value.accessToken,
      arguments: {
        path: 'Knowledge/Rendezvous lower priority.md',
        content: '# Rendezvous lower priority\n\nThis unlinked note is an orphan without a broken link.\n',
        expectedRevision: 'missing',
      },
    } });
    expect(lowerPriority.isError).toBeFalsy();
    const snoozed = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write', accessToken: codex.value.accessToken,
      arguments: {
        path: 'Knowledge/Rendezvous snoozed.md',
        content: '# Rendezvous snoozed\n\n[[Knowledge/Missing snoozed rendezvous]]\n',
        frontmatter: { review_snoozed_until: '2099-01-01' },
        expectedRevision: 'missing',
      },
    } });
    expect(snoozed.isError).toBeFalsy();
    const hiddenDirectory = join(vault, '_scopes', 'models', 'claude', 'Knowledge');
    await mkdir(hiddenDirectory, { recursive: true });
    await writeFile(join(hiddenDirectory, 'Hidden rendezvous.md'), '# Hidden rendezvous\n\n[[Knowledge/Missing hidden rendezvous]]\n');

    const first = await json(client, 'get_agent_pulse', { accessToken: codex.value.accessToken });
    const second = await json(client, 'get_agent_pulse', { accessToken: gemini.value.accessToken });
    const repeated = await json(client, 'get_agent_pulse', { accessToken: codex.value.accessToken });
    const publicPacket = await json(client, 'call_endpoint', {
      endpointId: 'wiki.review_packet', arguments: { limit: 1, maxChars: 4000 }, accessToken: codex.value.accessToken,
    });

    expect(first.value).toMatchObject({
      signals: { maintenanceAvailable: true, maintenanceRouting: 'stateless_rendezvous' },
      context: expect.arrayContaining([expect.objectContaining({
        kind: 'wiki_maintenance',
        routing: { mode: 'stateless_rendezvous', candidateBand: 8, exclusive: false },
      })]),
    });
    expect(second.value).toMatchObject({
      signals: { maintenanceAvailable: true, maintenanceRouting: 'stateless_rendezvous' },
      context: expect.arrayContaining([expect.objectContaining({
        kind: 'wiki_maintenance',
        routing: { mode: 'stateless_rendezvous', candidateBand: 8, exclusive: false },
      })]),
    });
    expect(second.value.nextAction.target).not.toBe(first.value.nextAction.target);
    expect(first.value.nextAction.target).not.toBe('Knowledge/Rendezvous lower priority.md');
    expect(second.value.nextAction.target).not.toBe('Knowledge/Rendezvous lower priority.md');
    expect(repeated.value.nextAction.target).toBe(first.value.nextAction.target);
    expect(publicPacket.value).not.toHaveProperty('attentionRouting');
    expect(publicPacket.value.curationPlan.selected.path).toBe('Knowledge/Rendezvous 01.md');
    expect(JSON.stringify([first.value, second.value, repeated.value])).not.toContain('attentionKey');
  }
});

test('minimum pulse budget recovers complete guidance and the exact maintenance action', async () => {
  const { server, client } = await setup();
  {
    const registration = await json(client, 'register_scope_account', {
      accountId: 'minimum-maintenance-pulse', modelId: 'codex', password: 'minimum-maintenance-password-123',
    });
    const accessToken = registration.value.accessToken;
    const noteWrite = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write',
      arguments: {
        path: 'Knowledge/Minimum budget defect.md',
        content: '# Minimum budget defect\n\n[[Knowledge/Missing minimum target]]\n',
        frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' },
        expectedRevision: 'missing', accessToken,
      },
    } });
    expect(noteWrite.isError).toBeFalsy();
    const packet = await json(client, 'call_endpoint', {
      endpointId: 'wiki.review_packet', arguments: { limit: 1, maxChars: 4000 }, accessToken,
    });

    const pulseResult = await client.callTool({
      name: 'get_agent_pulse', arguments: { accessToken, limit: 1, maxChars: 512 },
    });
    const pulseText = String((pulseResult.content as any)[0].text);
    const tinyPulse = JSON.parse(pulseText);

    expect(pulseText.length).toBeLessThanOrEqual(512);
    expect(tinyPulse).toMatchObject({ guidanceOmitted: true, nextAction: { tool: 'get_agent_pulse' } });
    const recovered = await json(client, 'get_agent_pulse', { ...tinyPulse.nextAction.arguments, accessToken });
    const pulse = recovered.value;
    expect(JSON.stringify(pulse).length).toBeLessThanOrEqual(tinyPulse.nextAction.arguments.maxChars);
    expect(pulse.cadence).toContain('continuity.save');
    expect(pulse.nextAction).toMatchObject({
      tool: packet.value.curationPlan.inspect.endpointId,
      target: 'Knowledge/Minimum budget defect.md',
      selectedRevision: packet.value.curationPlan.selected.revision,
    });
    expect(Boolean(pulse.nextAction.followUpPlan) || pulse.nextAction.followUpPlanOmitted === true).toBe(true);
  }
});

test('a tiny pulse retries with a larger budget instead of truncating a long maintenance action', async () => {
  const { server, client } = await setup();
  {
    const registration = await json(client, 'register_scope_account', {
      accountId: 'long-maintenance-pulse', modelId: 'codex', password: 'long-maintenance-pulse-password-123',
    });
    const accessToken = registration.value.accessToken;
    const path = `Knowledge/${'long-target-'.repeat(16)}note.md`;
    expect(path.length).toBeGreaterThan(160);
    const write = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.write', accessToken,
      arguments: {
        path,
        content: '# Long maintenance target\n\n[[Knowledge/Missing long destination]]\n',
        frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen' },
        expectedRevision: 'missing',
      },
    } });
    expect(write.isError).toBeFalsy();

    const response = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken, limit: 1, maxChars: 512 } });
    const text = String((response.content as any)[0].text);
    const value = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(512);
    expect(value).toMatchObject({
      truncated: true,
      nextAction: { tool: 'get_agent_pulse', arguments: { limit: 1, maxChars: expect.any(Number) } },
    });
    expect(value.nextAction.arguments.maxChars).toBeGreaterThan(512);
    expect(text).not.toContain(path.slice(0, 160));
    const recovered = await json(client, 'get_agent_pulse', { ...value.nextAction.arguments, accessToken });
    expect(JSON.stringify(recovered.value).length).toBeLessThanOrEqual(value.nextAction.arguments.maxChars);
    expect(recovered.value.cadence).toContain('continuity.save');
    expect(recovered.value.nextAction).toMatchObject({
      tool: 'wiki.read_projection', target: path,
      selectedRevision: JSON.parse(String((write.content as any)[0].text)).revision,
    });
  }
});

test('a small-budget Pulse retry preserves relevant skill selection and host state', async () => {
  const skill = vi.spyOn(SkillEvolutionService.prototype, 'nextAction').mockImplementation(async ({ skillId }) => ({
    endpointId: 'skill.candidate', arguments: { skillId, candidateId: 'bounded-candidate', op: 'read' },
  }));
  const { server, client } = await setup();
  {
    const registration = await json(client, 'register_scope_account', { accountId: 'retry-skill', modelId: 'codex', password: 'retry-skill-password-123' });
    const accessToken = registration.value.accessToken;
    const tiny = await json(client, 'get_agent_pulse', { skillId: 'safe-edit', hostBusy: false, limit: 2, maxChars: 512, accessToken });
    expect(tiny.value).toMatchObject({ nextAction: { tool: 'get_agent_pulse', arguments: { skillId: 'safe-edit', hostBusy: false, limit: 2 } } });
    expect(JSON.stringify(tiny.value).length).toBeLessThanOrEqual(512);
    const recovered = await json(client, 'get_agent_pulse', { ...tiny.value.nextAction.arguments, accessToken });
    expect(recovered.value.nextAction).toMatchObject({ tool: 'skill.candidate', arguments: { skillId: 'safe-edit', candidateId: 'bounded-candidate' } });
    const busy = await json(client, 'get_agent_pulse', { skillId: 'safe-edit', hostBusy: true, maxChars: 512, accessToken });
    expect(busy.value.nextAction.arguments.hostBusy).toBe(true);
    await json(client, 'get_agent_pulse', { ...busy.value.nextAction.arguments, accessToken });
    expect(skill).toHaveBeenCalledTimes(2);
  }
});

test('a direct obligation suppresses maintenance projection lookup', async () => {
  let reviewPacketCalls = 0;
  const pulse = unitPulseService({
    workState: { exists: true },
    reviewPacket: async () => {
      reviewPacketCalls += 1;
      return { curationPlan: { selected: { path: 'Knowledge/Should not be selected.md' } } };
    },
  });

  await pulse.get({ principal: { accountId: 'direct-obligation', modelId: 'codex', role: 'model' } as any });

  expect(reviewPacketCalls).toBe(0);
});

test('maintenance projection failure falls back without exposing exception details', async () => {
  let reviewPacketCalls = 0;
  const pulse = unitPulseService({
    reviewPacket: async () => {
      reviewPacketCalls += 1;
      throw new Error('sensitive maintenance projection failure');
    },
  });

  const result = await pulse.get({ principal: { accountId: 'maintenance-failure', modelId: 'codex', role: 'model' } as any });

  expect(reviewPacketCalls).toBe(1);
  expect(result).toMatchObject({ nextAction: { tool: 'wiki.home' } });
  expect(JSON.stringify(result)).not.toContain('sensitive maintenance projection failure');
});

test('a tiny review packet envelope still yields a maintenance action', async () => {
  const path = 'Knowledge/Tiny maintenance.md';
  const revision = 'c'.repeat(64);
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      selected: { path, revision, reason: 'broken_link' },
      nextAction: { endpointId: 'notes.read', arguments: { path, maxChars: 4000 } },
      then: { endpointId: 'notes.patch' },
      truncated: true,
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'tiny-maintenance', modelId: 'codex', role: 'model' } as any });

  expect(result).toMatchObject({
    nextAction: { tool: 'notes.read', target: path, selectedRevision: revision, followUpPlan: { endpointId: 'notes.patch' } },
    signals: { maintenanceAvailable: true },
  });
});

test('sequential idle pulses reuse one cached maintenance plan', async () => {
  let reviewPacketCalls = 0;
  const path = 'Knowledge/Cached maintenance.md';
  const revision = 'd'.repeat(64);
  const pulse = unitPulseService({
    reviewPacket: async () => {
      reviewPacketCalls += 1;
      return {
        curationPlan: {
          selected: { path, revision, reason: 'broken_link' },
          inspect: { endpointId: 'notes.read', arguments: { path } },
          then: { endpointId: 'notes.patch', arguments: { path, expectedRevision: revision, dryRun: true } },
        },
      };
    },
  });
  const principal = { accountId: 'cached-maintenance', modelId: 'codex', agentId: 'cached-worker', commandCenterId: 'local', role: 'agent' } as any;

  const first = await pulse.get({ principal });
  const second = await pulse.get({ principal });

  expect(reviewPacketCalls).toBe(1);
  expect(second.nextAction).toEqual(first.nextAction);
});

test('a clean idle pulse surfaces one bounded authored synthesis opportunity and caches it', async () => {
  const path = 'Knowledge/Synthesis input.md';
  const revision = '8'.repeat(64);
  let synthesisCalls = 0;
  const pulse = unitPulseService({
    reviewPacket: async () => ({}),
    synthesisCandidates: async (_principal, limit, maxChars, options) => {
      synthesisCalls += 1;
      expect(limit).toBe(8);
      expect(maxChars).toBe(4000);
      expect(options.attentionKey).toContain('synthesis-pulse');
      return {
        items: [{
          basis: { kind: 'moc', value: 'Knowledge/MOCs/Retrieval' },
          score: 12,
          mode: 'create_synthesis',
          readOrder: [{ path, revision }],
        }],
        total: 1,
        truncated: false,
        attentionRouting: { mode: 'stateless_rendezvous', candidateBand: 1, exclusive: false },
      };
    },
  });
  const principal = { accountId: 'synthesis-pulse', modelId: 'codex', agentId: 'synthesis-worker', commandCenterId: 'local', role: 'agent' } as any;

  const first = await pulse.get({ principal });
  const second = await pulse.get({ principal });

  expect(synthesisCalls).toBe(1);
  expect(first).toMatchObject({
    nextAction: {
      tool: 'wiki.synthesis_candidates',
      arguments: { focusPath: path, limit: 1, maxChars: 4000 },
      target: path,
      selectedRevision: revision,
    },
    signals: { maintenanceAvailable: false, synthesisAvailable: true, synthesisRouting: 'stateless_rendezvous' },
    context: [expect.objectContaining({ kind: 'wiki_synthesis', selected: { path, revision, reason: 'knowledge_cluster_needs_synthesis' } })],
  });
  expect(second.nextAction).toEqual(first.nextAction);
});

test('a Wiki generation change invalidates a cached synthesis opportunity immediately', async () => {
  let generation = 10;
  let synthesisCalls = 0;
  const revision = '6'.repeat(64);
  const pulse = unitPulseService({
    maintenanceGeneration: () => generation,
    reviewPacket: async () => ({}),
    synthesisCandidates: async () => {
      synthesisCalls += 1;
      return {
        items: [{
          basis: { kind: 'domain', value: `generation-${generation}` },
          score: 12,
          mode: 'create_synthesis',
          readOrder: [{ path: `Knowledge/Synthesis generation ${generation}.md`, revision }],
        }],
        total: 1,
      };
    },
  });
  const principal = { accountId: 'synthesis-generation', modelId: 'codex', role: 'model' } as any;

  const first = await pulse.get({ principal });
  generation += 1;
  const second = await pulse.get({ principal });

  expect(synthesisCalls).toBe(2);
  expect(first.nextAction).toMatchObject({ target: 'Knowledge/Synthesis generation 10.md' });
  expect(second.nextAction).toMatchObject({ target: 'Knowledge/Synthesis generation 11.md' });
});

test('concrete maintenance still outranks and suppresses synthesis projection work', async () => {
  let synthesisCalls = 0;
  const path = 'Knowledge/Maintenance first.md';
  const revision = '7'.repeat(64);
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      curationPlan: {
        selected: { path, revision, reason: 'broken_link' },
        inspect: { endpointId: 'notes.read', arguments: { path } },
      },
    }),
    synthesisCandidates: async () => {
      synthesisCalls += 1;
      return { items: [], total: 0 };
    },
  });

  const result = await pulse.get({ principal: { accountId: 'maintenance-first', modelId: 'codex', role: 'model' } as any });

  expect(synthesisCalls).toBe(0);
  expect(result).toMatchObject({
    nextAction: { tool: 'notes.read', target: path, selectedRevision: revision },
    signals: { maintenanceAvailable: true },
    context: [expect.objectContaining({ kind: 'wiki_maintenance' })],
  });
});

test('a malformed synthesis projection is ignored and idle routing falls through safely', async () => {
  const pulse = unitPulseService({
    reviewPacket: async () => ({}),
    synthesisCandidates: async () => ({
      items: [{
        basis: { kind: 'domain', value: 'retrieval' },
        score: 12,
        mode: 'create_synthesis',
        readOrder: [{ path: 'Knowledge/Missing revision.md' }],
      }],
      total: 1,
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'malformed-synthesis', modelId: 'codex', role: 'model' } as any });

  expect(result).toMatchObject({
    nextAction: { tool: 'wiki.home' },
    signals: { maintenanceAvailable: false },
  });
  expect(result.signals).not.toHaveProperty('synthesisAvailable');
  expect(result.context).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'wiki_synthesis' })]));
});

test('a Wiki read-model generation change invalidates the cached maintenance plan immediately', async () => {
  let generation = 3;
  let reviewPacketCalls = 0;
  const revision = '9'.repeat(64);
  const pulse = unitPulseService({
    maintenanceGeneration: () => generation,
    reviewPacket: async () => {
      reviewPacketCalls += 1;
      const path = `Knowledge/Generation ${generation}.md`;
      return {
        curationPlan: {
          selected: { path, revision, reason: 'broken_link' },
          inspect: { endpointId: 'notes.read', arguments: { path } },
          then: { endpointId: 'notes.patch', arguments: { path, expectedRevision: revision, dryRun: true } },
        },
      };
    },
  });
  const principal = { accountId: 'generation-aware-maintenance', modelId: 'codex', role: 'model' } as any;

  const first = await pulse.get({ principal });
  generation += 1;
  const second = await pulse.get({ principal });

  expect(reviewPacketCalls).toBe(2);
  expect(first.nextAction).toMatchObject({ target: 'Knowledge/Generation 3.md' });
  expect(second.nextAction).toMatchObject({ target: 'Knowledge/Generation 4.md' });
});

test('maintenance projection rejects an action when any executable argument cannot be preserved exactly', async () => {
  const path = 'Knowledge/Compact maintenance.md';
  const revision = 'e'.repeat(64);
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      curationPlan: {
        selected: { path, revision, reason: 'broken_link', body: 'do not copy this body' },
        inspect: {
          endpointId: 'notes.read',
          arguments: {
            path,
            count: 3,
            enabled: true,
            query: 'q'.repeat(300),
            accessToken: 'hidden-token',
            password: 'hidden-password',
            nested: { body: 'hidden' },
            values: ['hidden'],
            infinite: Number.POSITIVE_INFINITY,
            alpha: 'a', beta: 'b', gamma: 'g', delta: 'd', epsilon: 'e', zeta: 'z',
          },
          body: 'do not copy this inspect body',
        },
        then: {
          endpointId: 'notes.patch',
          arguments: { path, expectedRevision: revision, dryRun: true, credential: 'hidden', patches: [{ oldString: 'a', newString: 'b' }] },
          requiredArguments: Array.from({ length: 10 }, (_, index) => `argument-${index}-${'x'.repeat(220)}`),
          instruction: 'i'.repeat(601),
          body: 'do not copy this follow-up body',
        },
        guard: { autoFix: false },
        dashboard: { body: 'do not copy this dashboard' },
      },
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'compact-maintenance', modelId: 'codex', role: 'model' } as any });
  expect(result).toMatchObject({
    nextAction: { tool: 'wiki.home' },
    signals: { maintenanceAvailable: false },
  });
  expect((result.context as Array<Record<string, unknown>>).some(item => item.kind === 'wiki_maintenance')).toBe(false);
});

test('maintenance projection preserves every bounded primitive argument exactly', async () => {
  const path = 'Knowledge/Exact primitive arguments.md';
  const revision = 'a'.repeat(64);
  const inspectArguments = { path, count: 3, enabled: true, query: 'q'.repeat(300) };
  const followUpArguments = { path, expectedRevision: revision, dryRun: true };
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      curationPlan: {
        selected: { path, revision, reason: 'broken_link' },
        inspect: { endpointId: 'notes.read', arguments: inspectArguments },
        then: { endpointId: 'notes.patch', arguments: followUpArguments },
      },
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'exact-primitive-arguments', modelId: 'codex', role: 'model' } as any });
  expect(result).toMatchObject({
    nextAction: {
      tool: 'notes.read',
      arguments: inspectArguments,
      followUpPlan: { endpointId: 'notes.patch', arguments: followUpArguments },
    },
    signals: { maintenanceAvailable: true },
  });
});

test('maintenance preserves an inspect path longer than 160 characters exactly', async () => {
  const path = `Knowledge/${'long-segment-'.repeat(16)}Exact note.md`;
  const revision = 'f'.repeat(64);
  expect(path.length).toBeGreaterThan(160);
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      curationPlan: {
        selected: { path, revision, reason: 'broken_link' },
        inspect: { endpointId: 'notes.read', arguments: { path, maxChars: 4000 } },
        then: { endpointId: 'notes.patch', arguments: { path, expectedRevision: revision, dryRun: true } },
      },
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'exact-maintenance-path', modelId: 'codex', role: 'model' } as any });

  expect(result).toMatchObject({
    nextAction: { tool: 'notes.read', target: path, arguments: { path, maxChars: 4000 } },
    signals: { maintenanceAvailable: true },
  });
  expect((result.nextAction as Record<string, any>).arguments.path).toBe(path);
});

test('an oversized maintenance plan is omitted instead of returning truncated arguments', async () => {
  const path = 'Knowledge/Oversized maintenance.md';
  const revision = '1'.repeat(64);
  const oversizedValue = 'v'.repeat(900);
  const pulse = unitPulseService({
    reviewPacket: async () => ({
      curationPlan: {
        selected: { path, revision, reason: 'broken_link' },
        inspect: {
          endpointId: 'notes.read',
          arguments: {
            path,
            first: oversizedValue,
            second: oversizedValue,
            third: oversizedValue,
            fourth: oversizedValue,
            fifth: oversizedValue,
          },
        },
        then: { endpointId: 'notes.patch', arguments: { path, expectedRevision: revision, dryRun: true } },
      },
    }),
  });

  const result = await pulse.get({ principal: { accountId: 'oversized-maintenance', modelId: 'codex', role: 'model' } as any });

  expect(result).toMatchObject({
    nextAction: { tool: 'wiki.home' },
    signals: { maintenanceAvailable: false },
  });
  expect((result.context as Array<Record<string, unknown>>).some(item => item.kind === 'wiki_maintenance')).toBe(false);
});

test('pulse is exposed alongside both read and mutating tools', async () => {
  const { server, client } = await setup();
  {
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    expect(names).toContain('get_agent_pulse');
    expect(names).toEqual(expect.arrayContaining(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']));
  }
});
