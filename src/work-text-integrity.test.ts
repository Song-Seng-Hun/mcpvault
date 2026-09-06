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
import { organizationLintIssues } from './organization.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-text-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function seed(fields: Record<string, unknown>) {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'project', lifecycle: 'active', ...fields }) + '---\n# Work';
  await writeFile(join(vault, 'Work.md'), raw);
  return raw;
}
const emptyText = [{}, [], ['owner'], null, false, 0, '   '];

test.each(emptyText.map(value => [value]))('non-text waiting declaration does not fabricate a workflow hold: %j', async waiting_for => {
  const raw = await seed({ next_action: 'Execute the experiment', waiting_for });
  const actions = await wiki.nextActions();
  expect(actions.items.map((row: any) => row.path)).toEqual(['Work.md']);
  expect(actions.items[0].waitingFor).toBeUndefined();
  const flow: any = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
  expect(flow.flow).toMatchObject({ waiting: 0, readyToPull: 1 });
  expect(flow.dependencyPlan.workflowHolds.total).toBe(0);
  const reflect = await (wiki as any).collectReviewDashboard(undefined, 10, 16000);
  expect(reflect.sections.projectReadiness.items[0].readiness).toBe('ready');
  expect(reflect.sections.waiting.total).toBe(0);
  expect(await readFile(join(vault, 'Work.md'), 'utf8')).toBe(raw);
});

test.each(emptyText.map(value => [value]))('empty action declarations do not make Reflect ready: %j', async value => {
  await seed({ next_action: value, next_actions: [value] });
  const reflect = await (wiki as any).collectReviewDashboard(undefined, 10, 16000);
  expect(reflect.sections.projectReadiness.items[0].readiness).toBe('needs_next_action');
  expect((await wiki.nextActions()).items).toEqual([]);
  expect((await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000) as any).flow.readyToPull).toBe(0);
});

test.each(['project', 'task'])('a real action in a mixed list satisfies %s lint without a scalar action', note_kind => {
  const issues = organizationLintIssues('Work.md', { note_kind, lifecycle: 'active', next_actions: ['', null, 'Execute the experiment'] }, '');
  expect(issues.some(issue => ['active_project_without_next_action', 'active_work_without_next_action'].includes(issue.code))).toBe(false);
});

test.each(['project', 'task'])('malformed text is repair debt rather than an action or owner for %s', note_kind => {
  const fields = { note_kind, lifecycle: 'active', next_action: {}, next_actions: [null, ' '], waiting_for: ['owner'] };
  const issues = organizationLintIssues('Work.md', fields, '');
  expect(issues).toContainEqual(expect.objectContaining({ code: note_kind === 'project' ? 'active_project_without_next_action' : 'active_work_without_next_action' }));
  const waiting = organizationLintIssues('Work.md', { ...fields, task_status: 'waiting' }, '');
  expect(waiting).toContainEqual(expect.objectContaining({ code: note_kind === 'project' ? 'waiting_project_without_owner' : 'waiting_work_without_owner' }));
});

test.each(emptyText.map(value => [value]))('explicit waiting state remains held even with an unusable owner: %j', async waiting_for => {
  await seed({ next_action: 'Execute the experiment', task_status: 'waiting', waiting_for });
  expect((await wiki.nextActions()).items).toEqual([]);
  const flow: any = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
  expect(flow.flow.waiting).toBe(1);
  expect(flow.lanes.waiting[0].waitingFor).toBeUndefined();
  const reflect = await (wiki as any).collectReviewDashboard(undefined, 10, 16000);
  expect(reflect.sections.waiting.items[0].waitingFor).toBeUndefined();
});

test('real waiting text preserves a trimmed owner in all projections', async () => {
  await seed({ next_action: 'Execute the experiment', waiting_for: '  Review from team  ' });
  expect((await wiki.nextActions()).items).toEqual([]);
  const flow: any = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
  expect(flow.lanes.waiting[0].waitingFor).toBe('Review from team');
  const reflect = await (wiki as any).collectReviewDashboard(undefined, 10, 16000);
  expect(reflect.sections.waiting.items[0].waitingFor).toBe('Review from team');
});

test.each(['next_action', 'waiting_for'])('malformed %s gets a direct Property repair diagnostic', field => {
  const issues = organizationLintIssues('Work.md', { note_kind: 'task', [field]: {} }, '');
  expect(issues).toContainEqual(expect.objectContaining({ code: 'property_contract_violation', detail: expect.stringContaining(`${field} must be a text property`) }));
});

test('empty text placeholders are absent content, not a Property type violation', () => {
  const issues = organizationLintIssues('Work.md', { note_kind: 'task', next_action: ' ', waiting_for: '' }, '');
  expect(issues.some(issue => issue.code === 'property_contract_violation')).toBe(false);
});

test('MCP work projections agree on blank waiting text within response and visibility budgets', async () => {
  const raw = await seed({ next_action: 'Execute the experiment', waiting_for: '   ' });
  await writeFile(join(vault, 'Waiting.md'), '---\nllm_wiki_type: knowledge\nnote_kind: task\ntask_status: waiting\nwaiting_for: {}\nnext_action: Execute after review\n---\n# Waiting');
  await writeFile(join(vault, 'Hidden.md'), '---\nllm_wiki_type: knowledge\nnote_kind: task\nmoderation_status: hidden\nnext_action: HIDDEN-ACTION\n---\n# Hidden');
  const server = createServer(vault, { version: 'work-text-test' });
  const client = new Client({ name: 'work-text-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    for (const endpointId of ['wiki.next_actions', 'wiki.flow_health']) {
      for (const maxChars of [512, 16000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(text).not.toContain('Hidden.md');
        expect(text).not.toContain('HIDDEN-ACTION');
        expect(text).not.toContain('[object Object]');
        if (maxChars === 16000) {
          const value = JSON.parse(text);
          if (endpointId === 'wiki.next_actions') expect(value.items.map((row: any) => row.path)).toEqual(['Work.md']);
          else expect(value.flow).toMatchObject({ readyToPull: 1, waiting: 1, totalWork: 2 });
        }
      }
    }
    expect(await readFile(join(vault, 'Work.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});
