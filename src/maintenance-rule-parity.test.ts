import { expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { organizationLintIssues } from './organization.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

async function fixture(run: (wiki: LlmWikiService, seed: (path: string, fm: Record<string, unknown>, body?: string) => Promise<string>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-maint-parity-', root = await mkdtemp(join(base, prefix));
  const seed = async (path: string, fm: Record<string, unknown>, body = '# Work\n') => {
    const raw = `---\n${stringify(fm)}---\n${body}`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), raw);
    return raw;
  };
  try {
    const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), seed, root);
  } finally {
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

const workCases: Array<[string, Record<string, unknown>, boolean]> = [
  ['missing action', {}, true],
  ['normalized active state', { lifecycle: ' ACTIVE ', task_status: ' OPEN ' }, true],
  ['list action', { next_actions: ['Inspect the evidence'] }, false],
  ['mixed list', { next_actions: [null, ' ', ' Inspect evidence '] }, false],
  ['scalar action', { next_action: 'Inspect evidence' }, false],
  ['blank text', { next_action: ' ', next_actions: [' ', null], waiting_for: ' ' }, true],
  ['malformed text', { next_action: {}, next_actions: [false], waiting_for: ['owner'] }, true],
  ['wait owner', { waiting_for: 'Peer review' }, false],
  ['waiting lane', { task_status: 'waiting' }, false],
  ['blocked lane', { task_status: 'blocked' }, false],
  ['completed lane', { task_status: 'completed' }, false],
  ['cancelled lane', { task_status: 'cancelled' }, false],
  ['someday lane', { task_status: 'someday' }, false],
  ['archived knowledge', { lifecycle: 'archived' }, false],
  ['superseded knowledge', { lifecycle: 'superseded' }, false],
  ['invalid lane is repairable', { task_status: ['completed'] }, true],
  ['non-work source', { llm_wiki_type: 'source' }, false],
];
for (const kind of ['project', 'task', 'question']) test.each(workCases)(`${kind}: %s has consistent missing-action debt`, async (_label, fields, expected) => {
  await fixture(async (wiki, seed, root) => {
    const fm = { llm_wiki_type: 'knowledge', note_kind: kind, lifecycle: 'active', task_status: 'open', primary_moc: 'Map', ...fields };
    const raw = await seed('Work.md', fm);
    const lint = organizationLintIssues('Work.md', fm, '# Work\n');
    const code = kind === 'project' ? 'active_project_without_next_action' : 'active_work_without_next_action';
    expect.soft(lint.some(issue => issue.code === code)).toBe(expected);
    const debt: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    const reason = kind === 'project' ? 'project_without_next_action' : 'work_without_next_action';
    expect.soft(Boolean(debt.counts[reason])).toBe(expected);
    expect.soft(debt.items.some((item: any) => item.reasons.includes(reason))).toBe(expected);
    if (expected) {
      const item = debt.items.find((item: any) => item.reasons.includes(reason));
      expect.soft(item?.curationPlan?.inspect).toEqual({ endpointId: endpointIdForTool('read_wiki_projection'), arguments: { path: 'Work.md', view: 'full', maxChars: 5000 } });
      expect.soft(item?.curationPlan?.then?.requiredArguments).toEqual(['nextAction or nextActions or waitingFor']);
    }
    expect(await readFile(join(root, 'Work.md'), 'utf8')).toBe(raw);
  });
});

const mocCases: Array<[string, string, boolean]> = [
  ['empty', '# Map\n', false],
  ['backtick fence', '```md\n[[Example]]\n```', false],
  ['tilde fence', '~~~md\n[[Example]]\n~~~', false],
  ['short closer', '````md\n[[Example]]\n```\n[[Still literal]]', false],
  ['wrong closer', '~~~\n[[Example]]\n```\n[[Still literal]]', false],
  ['inline literal', '`[[Example]]`', false],
  ['escaped opener', '\\[[Example]]', false],
  ['anchor only', '[[#Heading]]', false],
  ['external only', '[Website](https://example.com)', false],
  ['normal wikilink', '[[Missing#Heading|Alias]]', true],
  ['block link', '[[Missing#^block-id]]', true],
  ['relative Markdown', '[Note](./Missing.md)', true],
  ['fence then real', '```\n[[Example]]\n```\n[[Missing]]', true],
  ['unmatched inline backtick', '` [[Missing]]', true],
];
test.each(mocCases)('MOC %s agrees between lint and maintenance', async (_label, body, hasLink) => {
  await fixture(async (wiki, seed, root) => {
    const fm = { llm_wiki_type: 'knowledge', note_kind: 'moc', lifecycle: 'active', primary_moc: 'Map' };
    const raw = await seed('Map.md', fm, body);
    expect.soft(organizationLintIssues('Map.md', fm, body).some(issue => issue.code === 'moc_without_links')).toBe(!hasLink);
    const debt: any = await wiki.maintenanceDebt();
    expect.soft(Boolean(debt.counts.empty_moc)).toBe(!hasLink);
    expect(await readFile(join(root, 'Map.md'), 'utf8')).toBe(raw);
  });
});

test('ordinary passive questions remain knowledge, not invented work', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Question.md', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', primary_moc: 'Map' });
    expect((await wiki.maintenanceDebt()).items).toEqual([]);
  });
});

test('private and hidden work/MOC candidates do not leak into repair counts', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Hidden.md', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', task_status: 'open', moderation_status: 'hidden', title: 'SECRET-HIDDEN' });
    await seed('_scopes/models/claude/Private.md', { note_kind: 'moc', title: 'SECRET-PRIVATE' }, '```\n[[Example]]\n```');
    const debt: any = await wiki.maintenanceDebt();
    expect(debt.counts).toEqual({}); expect(debt.items).toEqual([]);
    expect(JSON.stringify(debt)).not.toContain('SECRET');
  });
});

test.each([
  { nextAction: 'Inspect the evidence' },
  { nextActions: ['Inspect the evidence'] },
  { waitingFor: 'Peer evidence review' },
])('suggested repair %j clears only missing-action debt and preserves the body', async repair => {
  await fixture(async (wiki, seed, root) => {
    const body = '# Question\nKeep the original research context.\n';
    await seed('Question.md', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', task_status: 'open', epistemic_status: 'open', primary_moc: 'Map' }, body);
    const before: any = await wiki.maintenanceDebt();
    const item = before.items.find((candidate: any) => candidate.path === 'Question.md');
    expect(item.reasons).toContain('work_without_next_action');
    await wiki.triage({ path: 'Question.md', expectedRevision: item.revision, ...repair });
    expect((await wiki.maintenanceDebt()).items).toEqual([]);
    expect(await readFile(join(root, 'Question.md'), 'utf8')).toContain(body);
    await expect(wiki.triage({ path: 'Question.md', expectedRevision: item.revision, nextAction: 'Stale replacement' })).rejects.toThrow();
  });
});

test('MCP repair inspection reads the chosen question rather than a project listing', async () => {
  await fixture(async (_wiki, seed, root) => {
    const raw = await seed('Question.md', { llm_wiki_type: 'knowledge', note_kind: 'question', lifecycle: 'active', task_status: 'open', primary_moc: 'Map' }, '# Exact target\nInspect this question.');
    const server = createServer(root, { version: 'maintenance-parity-test' });
    const client = new Client({ name: 'maintenance-parity', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      const discovered = await client.callTool({ name: 'search_capabilities', arguments: { query: 'triage_wiki_note', limit: 1, maxChars: 20000 } });
      expect(discovered.isError).not.toBe(true);
      const endpoint = JSON.parse((discovered.content as any)[0].text).endpoints[0];
      expect(endpoint.endpointId).toBe('wiki.triage');
      expect(endpoint.input.properties.nextAction).toMatchObject({ type: 'string', maxLength: 500 });
      expect(endpoint.input.properties.nextActions).toMatchObject({ type: 'array', maxItems: 20 });
      expect(endpoint.input.properties.waitingFor).toMatchObject({ type: 'string' });
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.maintenance_debt', arguments: { maxChars: 12000 } } });
      expect(result.isError).not.toBe(true);
      const packet = JSON.parse((result.content as any)[0].text);
      const target = packet.items.find((item: any) => item.path === 'Question.md');
      expect(target).toBeDefined();
      const inspected = await client.callTool({ name: 'call_endpoint', arguments: target.curationPlan.inspect });
      expect(inspected.isError).not.toBe(true);
      const text = (inspected.content as any)[0].text;
      expect(text.length).toBeLessThanOrEqual(5000);
      expect(text).toContain('Exact target');
      expect(text).toContain('Question.md');
      expect(await readFile(join(root, 'Question.md'), 'utf8')).toBe(raw);
    } finally { await client.close(); await server.close(); }
  });
});
