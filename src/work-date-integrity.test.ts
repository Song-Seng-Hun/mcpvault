import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-dates-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => {
  const target = await realpath(vault), base = await realpath(tmpdir());
  const local = relative(base, target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-work-dates-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(path: string, fields: Record<string, unknown> = {}) {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', next_action: 'Execute the authored step', ...fields }) + '---\n# Work';
  await writeFile(join(vault, path), raw); return raw;
}
const flow = () => wiki.flowHealth(undefined, 3, 7, 14, 20, 16000) as Promise<any>;
const reflect = () => (wiki as any).collectReviewDashboard(undefined, 20, 18000);
const invalidDates = ['2024-02-30', '2999-02-30', 'January 1, 2000', '1', '', ' ', ['2000-01-01'], null];

test.each(invalidDates.map(value => [value]))('invalid defer %j holds work and dependent stages with repair guidance', async value => {
  const original = await seed('Root.md', { defer_until: value });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  const health = await flow();
  expect(health.flow).toMatchObject({ readyToPull: 0, activeWip: 0, blocked: 2 });
  expect(health.lanes.blocked).toContainEqual(expect.objectContaining({ path: 'Root.md', blockedReason: 'invalid_defer_until', dateIssues: ['invalid_defer_until'] }));
  const root = health.lanes.blocked.find((row: any) => row.path === 'Root.md');
  expect(root.deferUntil).toBeUndefined();
  expect(root.ageDays).toBeUndefined();
  expect(root.dateRepairAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Root.md', expectedRevision: root.revision } });
  expect(health.dependencyPlan.stats.stageable).toBe(0);
  expect(health.dependencyPlan.workflowHoldBlockedDependents.total).toBe(1);
  const readiness = (await reflect()).sections.projectReadiness.items.find((row: any) => row.path === 'Root.md');
  expect(readiness).toMatchObject({ readiness: 'invalid_defer_until', dateIssues: ['invalid_defer_until'] });
  const projects = await wiki.projectPacket(undefined, 20, 16000);
  expect(projects.items.find((row: any) => row.path === 'Root.md')).toMatchObject({ dateIssues: ['invalid_defer_until'], execution: { ready: false, workflowHeld: true } });
  const actions = await wiki.nextActions(undefined, undefined, 20, 16000);
  expect(actions.items).toEqual([]);
  expect(actions.exclusions).toMatchObject({ invalidDefer: 1, dateRepairItems: [expect.objectContaining({ path: 'Root.md', dateIssues: ['invalid_defer_until'] })] });
  expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(original);
});

for (const [field, publicField] of [['due_at', 'dueAt'], ['scheduled_at', 'scheduledAt']]) {
  test.each(invalidDates.map(value => [value]))(`${field} %j is repair metadata, not a date or execution hold`, async value => {
    await seed('Work.md', { [field!]: value });
    const health = await flow();
    expect(health.flow).toMatchObject({ readyToPull: 1, overdue: 0 });
    expect(health.lanes.ready[0].dateIssues).toContain(`invalid_${field}`);
    expect(health.lanes.ready[0][publicField!]).toBeUndefined();
    const dashboard = await reflect();
    expect(dashboard.sections.due.total).toBe(0);
    expect(dashboard.sections.scheduled.total).toBe(0);
    expect(dashboard.sections.projectReadiness.items[0]).toMatchObject({ readiness: 'ready', dateIssues: [`invalid_${field}`] });
    const row = (await wiki.nextActions(undefined, undefined, 20, 16000)).items[0];
    expect(row.path).toBe('Work.md');
    expect(row[publicField!]).toBeUndefined();
    expect(row.dateIssues).toEqual([`invalid_${field}`]);
  });
}

test('correcting or removing a bad hold releases the source and descendant forecast without modifying dependents', async () => {
  await seed('Root.md', { defer_until: null });
  const child = await seed('Child.md', { depends_on: ['[[Root]]'] });
  expect((await flow()).dependencyPlan.stats.stageable).toBe(0);
  for (const fields of [{ defer_until: '2000-02-29T23:59:00+09:00' }, {}]) {
    await seed('Root.md', fields);
    expect((await flow()).dependencyPlan.stats).toMatchObject({ stageable: 2, stages: 2 });
    expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Root.md']);
  }
  expect(await readFile(join(vault, 'Child.md'), 'utf8')).toBe(child);
});

test('valid future defer holds, valid due/scheduled dates retain separate meanings', async () => {
  await seed('Work.md', { defer_until: '2999-01-01', due_at: '2000-02-29', scheduled_at: '2999-01-02T09:00:00+09:00' });
  const health = await flow();
  expect(health.flow).toMatchObject({ readyToPull: 0, deferred: 1, overdue: 1 });
  expect(health.lanes.deferred[0].dateIssues).toBeUndefined();
  const dashboard = await reflect();
  expect(dashboard.sections.due.total).toBe(1);
  expect(dashboard.sections.scheduled.total).toBe(1);
  expect(dashboard.sections.projectReadiness.items[0].readiness).toBe('deferred');
  await seed('Work.md', { scheduled_at: '2999-01-02T09:00:00+09:00' });
  expect((await wiki.nextActions()).items).toHaveLength(1);
});

test('invalid deadline cannot outrank valid deadlines or mask a valid calendar timestamp', async () => {
  await seed('Bad.md', { due_at: '2000-02-30' });
  await seed('Scheduled.md', { due_at: 'not a date', scheduled_at: '2002-01-01' });
  await seed('Due.md', { due_at: '2001-01-01' });
  expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Due.md', 'Scheduled.md', 'Bad.md']);
});

test.each(['waiting', 'blocked'])('invalid defer does not erase independent %s age evidence', async status => {
  const stamp = new Date(Date.now() - 20 * 86400000).toISOString();
  await seed('Work.md', { defer_until: null, task_status: status, [`${status}_since`]: stamp, waiting_for: status === 'waiting' ? 'Peer review' : undefined });
  const row = (await flow()).lanes[status][0];
  expect(row).toMatchObject({ dateIssues: ['invalid_defer_until'], ageDays: 20, aging: true });
  if (status === 'waiting') expect((await reflect()).sections.waiting.items[0].waitingAgeDays).toBe(row.ageDays);
});

test('a completed prerequisite does not regain an execution hold from obsolete invalid defer metadata', async () => {
  await seed('Root.md', { task_status: 'completed', defer_until: null });
  await seed('Child.md', { depends_on: ['[[Root]]'] });
  expect((await flow()).dependencyPlan.stats.stageable).toBe(1);
  expect((await wiki.nextActions()).items.map((row: any) => row.path)).toEqual(['Child.md']);
});

test('invalid hold repair remains discoverable without action text or matching execution capacity', async () => {
  await seed('Missing.md', { defer_until: null, next_action: null, task_context: '@research' });
  await seed('Capacity.md', { defer_until: null, task_context: '@research', time_estimate_minutes: 60, energy: 'high' });
  await seed('OtherContext.md', { defer_until: null, task_context: '@computer' });
  const result = await wiki.nextActions(undefined, '@research', 20, 16000, { maxMinutes: 5, energy: 'low' });
  expect(result.items).toEqual([]);
  expect(result.exclusions).toMatchObject({ invalidDefer: 1, invalidDeferNotes: 2 });
  expect(result.exclusions.dateRepairItems.map((row: any) => row.path).sort()).toEqual(['Capacity.md', 'Missing.md']);
  expect(JSON.stringify(result)).not.toContain('OtherContext.md');
  const empty = await wiki.nextActions(undefined, '@unused', 20, 16000);
  expect(empty.exclusions).toBeUndefined();
});

test.each([512, 1024, 16000])('an actionless invalid hold has repair continuation at %i characters', async maxChars => {
  await seed('Missing.md', { defer_until: null, next_action: null });
  const result = await wiki.nextActions(undefined, undefined, 20, maxChars, { prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
  expect(result.exclusions).toMatchObject({ invalidDefer: 0, invalidDeferNotes: 1 });
  expect(result.exclusions.dateRepairItems?.length || result.nextAction).toBeTruthy();
});

test('actual fixed-five-tool MCP keeps invalid holds safe and repair discoverable at every budget', async () => {
  const raw = await seed('Work.md', { defer_until: null });
  await seed('Hidden.md', { defer_until: null, moderation_status: 'hidden' });
  await mkdir(join(vault, '_scopes/models/claude'), { recursive: true });
  await seed('_scopes/models/claude/Private.md', { defer_until: null });
  const server = createServer(vault, { version: 'work-date-test' });
  const client = new Client({ name: 'work-date-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const endpointId of ['wiki.flow_health', 'wiki.review_dashboard', 'wiki.project_packet', 'wiki.next_actions']) {
      for (const maxChars of [512, 1024, 16000]) {
        const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(response.isError).not.toBe(true);
        const text = (response.content as any)[0].text as string;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(text).not.toContain('Hidden.md');
        expect(text).not.toContain('Private.md');
        const value = JSON.parse(text);
        if (endpointId === 'wiki.next_actions') {
          expect(value.items).toEqual([]);
          expect(value.exclusions.invalidDefer).toBe(1);
          expect(value.exclusions.dateRepairItems?.length || value.nextAction).toBeTruthy();
        }
        if (maxChars === 16000) {
          expect(text).toContain('invalid_defer_until');
          if (endpointId === 'wiki.project_packet') expect(value.items[0].execution.ready).toBe(false);
        }
      }
    }
    expect(await readFile(join(vault, 'Work.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});
