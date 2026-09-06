import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { isOpenActionableKnowledge, organizationLintIssues } from './organization.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-status-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown>) {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', next_action: 'Execute the concrete experiment', ...fields }) + '---\n# Work';
  await writeFile(join(vault, path), raw);
  return raw;
}

test.each([['completed'], ['cancelled'], ['someday']].map(value => [value]))('malformed terminal state remains discoverable for repair: %j', task_status => {
  const fm = { note_kind: 'task', task_status };
  expect(isOpenActionableKnowledge(fm)).toBe(true);
  expect(organizationLintIssues('Work.md', fm, '')).toContainEqual(expect.objectContaining({ code: 'invalid_task_status' }));
});

test.each([['completed'], ['open'], {}, null, false, 0, '', 'invented'].map(value => [value]))('invalid state neither executes nor releases its dependency chain: %j', async task_status => {
  const raw = await seed('Root.md', { task_status });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  await seed('Grandchild.md', { depends_on: ['[[Child]]'] });
  const next: any = await wiki.nextActions(undefined, undefined, 20, 16000);
  expect(next.items).toEqual([]);
  expect(next.exclusions.workflowBlocked).toBe(1);
  const flow: any = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
  expect(flow.dependencyPlan.stats.stageable).toBe(0);
  expect(flow.dependencyPlan.workflowHolds.items).toContainEqual(expect.objectContaining({ path: 'Root.md', taskStatus: 'invalid' }));
  expect(flow.dependencyPlan.workflowHoldBlockedDependents.total).toBe(2);
  expect(flow.lanes.blocked).toContainEqual(expect.objectContaining({ path: 'Root.md', blockedReason: 'invalid_task_status' }));
  expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(raw);
});

test.each([' Waiting ', ' Blocked '])('normalized held states agree in the action list and forecast: %s', async task_status => {
  await seed('Root.md', { task_status });
  const next: any = await wiki.nextActions();
  expect(next.items).toEqual([]);
  expect(next.exclusions.workflowBlocked).toBe(1);
  const flow: any = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
  expect(flow.dependencyPlan.stats.stageable).toBe(0);
});

test('only a valid scalar completed state releases a prerequisite', async () => {
  await seed('Root.md', { task_status: ' Completed ' });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  const next: any = await wiki.nextActions();
  expect(next.items.map((row: any) => row.path)).toEqual(['Child.md']);
  expect((await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000) as any).dependencyPlan.stats.stageable).toBe(1);
});

test('invalid states remain in Reflect with an explicit repair reason', async () => {
  await seed('Root.md', { task_status: ['completed'] });
  const dashboard = await (wiki as any).collectReviewDashboard(undefined, 10, 16000);
  expect(dashboard.sections.projectReadiness.items).toContainEqual(expect.objectContaining({ path: 'Root.md', taskStatus: 'invalid', readiness: 'invalid_task_status' }));
});

test.each([['completed'], ['cancelled'], ['open']].map(value => [value]))('lint reports malformed state without inventing completion obligations: %j', task_status => {
  const issues = organizationLintIssues('Work.md', { note_kind: 'task', task_status }, '- [ ] Actual unfinished task');
  expect(issues).toContainEqual(expect.objectContaining({ code: 'invalid_task_status' }));
  expect(issues.some(issue => issue.code.startsWith('completed_work_'))).toBe(false);
});

test('five-tool MCP keeps an invalid prerequisite held with bounded scope-filtered diagnostics', async () => {
  const raw = await seed('Root.md', { task_status: ['completed'] });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  await seed('Hidden.md', { task_status: ['completed'], moderation_status: 'hidden', title: 'HIDDEN-WORK-IDENTITY' });
  const server = createServer(vault, { version: 'work-status-test' });
  const client = new Client({ name: 'work-status-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities']);
    for (const endpointId of ['wiki.next_actions', 'wiki.flow_health']) {
      for (const maxChars of [512, 16000]) {
        const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(response.isError).not.toBe(true);
        const text = (response.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(text).not.toContain('Hidden.md');
        expect(text).not.toContain('HIDDEN-WORK-IDENTITY');
        if (maxChars === 16000) {
          const value = JSON.parse(text);
          if (endpointId === 'wiki.next_actions') { expect(value.items).toEqual([]); expect(value.exclusions.workflowBlocked).toBe(1); }
          else { expect(value.dependencyPlan.stats.stageable).toBe(0); expect(value.flow.totalWork).toBe(2); }
        }
      }
    }
    expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});

test('repairing an invalid state refreshes the current forecast without rewriting the chain', async () => {
  await seed('Root.md', { task_status: ['completed'] });
  const child = await seed('Child.md', { depends_on: ['[[Root]]'] });
  expect((await wiki.nextActions()).items).toEqual([]);
  await seed('Root.md', { task_status: 'completed' });
  expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Child.md']);
  expect(await readFile(join(vault, 'Child.md'), 'utf8')).toBe(child);
});

test('full lint does not derive a completion reference obligation from an array state', async () => {
  await seed('Root.md', { task_status: ['completed'], knowledge_notes: ['[[Missing]]'] });
  const result = await wiki.lint(undefined, 200);
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_task_status', path: 'Root.md' }));
  expect(result.issues.some(issue => issue.code.startsWith('completed_work_'))).toBe(false);
});

test.each([[['waiting'], false], [' Waiting ', true]])('project waiting-owner check requires normalized scalar waiting: %j', (task_status, expected) => {
  const issues = organizationLintIssues('Work.md', { note_kind: 'project', lifecycle: 'active', task_status }, '');
  expect(issues.some(issue => issue.code === 'waiting_project_without_owner')).toBe(expected);
});
