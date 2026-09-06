import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-action-ready-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown>) {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', ...fields }) + '---\n# Work';
  await writeFile(join(vault, path), raw); return raw;
}
const flow = () => wiki.flowHealth(undefined, 3, 7, 14, 20, 16000) as Promise<any>;

test('actual MCP keeps actionless forecasts bounded and excludes hidden work', async () => {
  const raw = await seed('Root.md', { task_status: 'next_action' });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  await seed('Hidden.md', { moderation_status: 'hidden', title: 'HIDDEN-ACTIONLESS' });
  const server = createServer(vault, { version: 'action-readiness-test' });
  const client = new Client({ name: 'action-readiness-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities']);
    for (const endpointId of ['wiki.flow_health', 'wiki.project_packet', 'wiki.next_actions']) {
      for (const maxChars of [512, 1024, 16000]) {
        const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(response.isError).not.toBe(true);
        const text = (response.content as any)[0].text as string;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(text).not.toContain('Hidden.md');
        expect(text).not.toContain('HIDDEN-ACTIONLESS');
        const value = JSON.parse(text);
        if (endpointId === 'wiki.flow_health') {
          if (maxChars === 512) {
            expect(value).toMatchObject({ truncated: true, nextAction: { endpointId } });
          } else expect(value.flow).toMatchObject({ totalWork: 2, activeWip: 0, readyToPull: 0, blocked: 2 });
          if (maxChars === 16000) {
            expect(value.dependencyPlan.stats.stageable).toBe(0);
            expect(value.lanes.blocked).toContainEqual(expect.objectContaining({ path: 'Child.md', needsNextAction: true, blockedReason: 'dependency' }));
          }
        } else if (endpointId === 'wiki.project_packet') {
          for (const item of value.items) expect(item.execution.ready).toBe(false);
          if (maxChars === 16000) {
            expect(value.items).toHaveLength(2);
            expect(value.items.every((item: any) => item.execution.needsNextAction && item.execution.workflowHeld)).toBe(true);
          }
        } else expect(value.items).toEqual([]);
      }
    }
    expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});

test.each(['open', 'next_action'])('a %s item without authored action is repair work, not executable WIP', async task_status => {
  const raw = await seed('Root.md', { task_status, next_action: {}, next_actions: [null, ' '], updated_at: '2020-01-01', started_at: '2020-01-01' });
  const result = await flow();
  expect(result.flow).toMatchObject({ activeWip: 0, readyToPull: 0, blocked: 1 });
  expect(result.lanes.blocked[0]).toMatchObject({ path: 'Root.md', needsNextAction: true, blockedReason: 'missing_next_action' });
  expect(result.lanes.blocked[0].ageDays).toBeUndefined();
  expect(result.lanes.blocked[0].aging).toBeUndefined();
  expect(result.dependencyPlan.stats.stageable).toBe(0);
  expect(result.dependencyPlan.workflowHolds.items[0]).toMatchObject({ path: 'Root.md', needsNextAction: true });
  expect((await wiki.projectPacket()).items[0].execution.ready).toBe(false);
  expect((await wiki.nextActions()).items).toEqual([]);
  expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(raw);
});

test('missing root action holds descendant forecasts until the source is repaired', async () => {
  await seed('Root.md', {});
  const child = await seed('Child.md', { next_action: 'Execute child', depends_on: ['[[Root]]'] });
  await seed('Grandchild.md', { next_action: 'Execute grandchild', depends_on: ['[[Child]]'] });
  const held = await flow();
  expect(held.dependencyPlan.stats.stageable).toBe(0);
  expect(held.dependencyPlan.workflowHoldBlockedDependents.total).toBe(2);
  await seed('Root.md', { next_actions: [null, ' ', 'Execute root'] });
  const repaired = await flow();
  expect(repaired.dependencyPlan.stats).toMatchObject({ stageable: 3, stages: 3 });
  expect(repaired.dependencyPlan.workflowHolds.total).toBe(0);
  expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Root.md']);
  expect(await readFile(join(vault, 'Child.md'), 'utf8')).toBe(child);
});

test('completed prerequisite needs no new action to release current work', async () => {
  await seed('Root.md', { task_status: 'completed' });
  await seed('Child.md', { next_action: 'Execute child', depends_on: ['[[Root]]'] });
  const result = await flow();
  expect(result.dependencyPlan.stats.stageable).toBe(1);
  expect(result.dependencyPlan.workflowHolds.total).toBe(0);
  expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Child.md']);
});

test.each(['waiting', 'blocked', 'deferred'])('missing action preserves the existing %s lane', async state => {
  await seed('Root.md', state === 'deferred' ? { defer_until: '2999-01-01' } : { task_status: state });
  const result = await flow();
  expect(result.lanes[state][0]).toMatchObject({ path: 'Root.md', needsNextAction: true });
  if (state === 'blocked') expect(result.lanes.blocked[0].blockedReason).toBe('explicit_status');
  expect(result.dependencyPlan.stats.stageable).toBe(0);
});

test('project execution agrees with the current plan for future-deferred work that has an action', async () => {
  await seed('Root.md', { next_action: 'Execute after deferral', defer_until: '2999-01-01' });
  expect((await flow()).dependencyPlan.stats.stageable).toBe(0);
  expect((await wiki.projectPacket()).items[0].execution.ready).toBe(false);
});
