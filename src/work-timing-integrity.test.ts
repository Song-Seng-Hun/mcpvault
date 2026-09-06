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
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-timing-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function seed(fields: Record<string, unknown>) {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active', next_action: 'Verify the observation', ...fields }) + '---\n# Work';
  await writeFile(join(vault, 'Work.md'), raw); return raw;
}
const flow = () => wiki.flowHealth(undefined, 3, 7, 14, 20, 16000) as Promise<any>;
const reflect = () => (wiki as any).collectReviewDashboard(undefined, 10, 16000);

test('actual MCP preserves unknown waiting age, bounded responses and hidden-note isolation', async () => {
  const raw = await seed({ task_status: 'waiting', waiting_for: 'Peer review', updated_at: '2000-01-01' });
  await writeFile(join(vault, 'Hidden.md'), '---\nnote_kind: task\ntask_status: waiting\nwaiting_since: 1999-01-01\nmoderation_status: hidden\n---\n# HIDDEN-AGE');
  const server = createServer(vault, { version: 'work-timing-test' });
  const client = new Client({ name: 'work-timing-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const endpointId of ['wiki.flow_health', 'wiki.review_dashboard']) {
      for (const maxChars of [512, 1024, 16000]) {
        const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(response.isError).not.toBe(true);
        const text = (response.content as any)[0].text as string;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(text).not.toContain('Hidden.md');
        expect(text).not.toContain('HIDDEN-AGE');
        expect(text).not.toContain('"followUpNeeded": true');
        const value = JSON.parse(text);
        if (maxChars === 16000) {
          const row = endpointId === 'wiki.flow_health' ? value.lanes.waiting[0] : value.sections.waiting.items[0];
          expect(row.path).toBe('Work.md');
          expect(row.waitingSince).toBeUndefined();
          expect(row.ageDays).toBeUndefined();
          expect(row.waitingAgeDays).toBeUndefined();
          expect(endpointId === 'wiki.flow_health' ? value.flow.waiting : value.sections.waiting.total).toBe(1);
        }
      }
    }
    expect(await readFile(join(vault, 'Work.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});

test.each(['waiting', 'blocked'])('%s age is unknown without its own timestamp, regardless of file dates', async task_status => {
  const raw = await seed({ task_status, updated_at: '2000-01-01', created_at: '1999-01-01', started_at: '1999-01-02' });
  const result = await flow(), item = result.lanes[task_status][0];
  expect(item.ageDays).toBeUndefined();
  expect(item.aging).toBeUndefined();
  expect(item[task_status === 'waiting' ? 'waitingSince' : 'blockedSince']).toBeUndefined();
  expect(result.observability.missingTimestamps).toContainEqual(expect.objectContaining({ path: 'Work.md', missing: `${task_status}_since` }));
  if (task_status === 'waiting') {
    const row = (await reflect()).sections.waiting.items[0];
    expect(row.waitingSince).toBeUndefined();
    expect(row.waitingAgeDays).toBeUndefined();
    expect(row.followUpNeeded).toBeUndefined();
  }
  expect(await readFile(join(vault, 'Work.md'), 'utf8')).toBe(raw);
});

test('an owner-only waiting hold cannot borrow updated_at for Reflect follow-up', async () => {
  await seed({ waiting_for: 'Independent peer review', updated_at: '2000-01-01' });
  const row = (await reflect()).sections.waiting.items[0];
  expect(row.waitingAgeDays).toBeUndefined();
  expect(row.followUpNeeded).toBeUndefined();
  expect((await flow()).lanes.waiting[0].ageDays).toBeUndefined();
});

for (const [status, field, lane] of [['waiting', 'waiting_since', 'waiting'], ['blocked', 'blocked_since', 'blocked'], ['next_action', 'started_at', 'active']]) {
  test.each(['1', 'January 1, 2000', '2999-01-01', 'bad timestamp', ['2000-01-01'], null].map(value => [value]))(`${field} does not fabricate an elapsed age from %j`, async value => {
    await seed({ task_status: status, [field]: value, updated_at: '2000-01-01' });
    const result = await flow();
    expect(result.lanes[lane][0].ageDays).toBeUndefined();
    expect(result.lanes[lane][0].aging).toBeUndefined();
    expect(result.observability.missingTimestamps).toContainEqual(expect.objectContaining({ path: 'Work.md', missing: field }));
    if (status === 'waiting') {
      const row = (await reflect()).sections.waiting.items[0];
      expect(row.waitingAgeDays).toBeUndefined();
      expect(row.followUpNeeded).toBeUndefined();
    }
  });
}

test('explicit waiting evidence survives unrelated edits and is shared by Flow and Reflect', async () => {
  const waiting_since = new Date(Date.now() - 20 * 86400000).toISOString();
  await seed({ task_status: 'waiting', waiting_since, updated_at: new Date().toISOString() });
  const first = await flow();
  expect(first.lanes.waiting[0]).toMatchObject({ waitingSince: waiting_since, ageDays: 20, aging: true });
  expect((await reflect()).sections.waiting.items[0]).toMatchObject({ waitingSince: waiting_since, waitingAgeDays: 20, followUpNeeded: true });
  await seed({ task_status: 'waiting', waiting_since, updated_at: '2000-01-01', title: 'Unrelated edit' });
  expect((await flow()).lanes.waiting[0].ageDays).toBe(20);
  const recent = new Date(Date.now() - 86400000).toISOString();
  await seed({ task_status: 'waiting', waiting_since: recent, updated_at: '2000-01-01' });
  expect((await flow()).lanes.waiting[0]).toMatchObject({ waitingSince: recent, ageDays: 1 });
  expect((await reflect()).sections.waiting.items[0].followUpNeeded).toBeUndefined();
});

test.each([['next_action', 'started_at', 'active'], ['blocked', 'blocked_since', 'blocked']])('%s keeps valid authored age independent of updated_at', async (task_status, field, lane) => {
  const timestamp = new Date(Date.now() - 8 * 86400000).toISOString();
  await seed({ task_status, [field]: timestamp, updated_at: new Date().toISOString() });
  expect((await flow()).lanes[lane][0].ageDays).toBe(8);
});
