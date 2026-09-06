import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import * as projections from './note-projections.js';

let vault: string, wiki: LlmWikiService;
const path = 'Work.md';
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
const dateFields = { dueAt: 'due_at', scheduledAt: 'scheduled_at', deferUntil: 'defer_until', lastRecalledAt: 'last_recalled_at', retentionAt: 'retention_at', preserveUntil: 'preserve_until', reviewedAt: 'last_reviewed_at', clarifiedAt: 'clarified_at' };
const views = ['summary', 'progressive', 'key_points', 'outline', 'section', 'full'] as const;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-projection-dates-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => {
  vi.restoreAllMocks();
  const target = await realpath(vault), base = await realpath(tmpdir()), local = relative(base, target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-projection-dates-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(fields: Record<string, unknown> = {}, body = '# Work\nAuthored content.\n') {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', next_action: 'Execute the authored step', ...fields }) + '---\n' + body;
  await writeFile(join(vault, path), raw); return raw;
}

for (const [publicField, field] of Object.entries(dateFields)) {
  test.each(['2024-02-30', null, ['2000-01-01']].map(value => [value]))(`${field} %j is a repair finding in every projection, never a usable date`, async value => {
    const raw = await seed({ [field]: value });
    for (const view of views) {
      const result: any = await wiki.readProjection({ path, view, ...(view === 'section' && { section: 'Work' }), maxChars: 12000 });
      expect(result[publicField]).toBeUndefined();
      expect(result.dateIssues).toContain(`invalid_${field}`);
      expect(result.dateRepairAction).toMatchObject({ endpointId: 'notes.read', arguments: { path, expectedRevision: digest(raw) } });
      expect(result.revision).toBe(digest(raw));
    }
    expect(await readFile(join(vault, path), 'utf8')).toBe(raw);
  });
}

test.each([' 2000-02-29 ', '2000-02-29T23:00:00+09:00'])('valid calendar values %j retain their authored date/offset without invented issues', async timestamp => {
  await seed(Object.fromEntries(Object.values(dateFields).map(field => [field, timestamp])));
  const result: any = await wiki.readProjection({ path });
  for (const field of Object.keys(dateFields)) expect(result[field]).toBe(timestamp.trim());
  expect(result.dateIssues).toBeUndefined();
  await seed();
  const absent: any = await wiki.readProjection({ path });
  for (const field of Object.keys(dateFields)) expect(absent[field]).toBeUndefined();
  expect(absent.dateIssues).toBeUndefined();
});

test('full body projection does not compute a discarded outline', async () => {
  const body = '# Work\n' + '# Heading\nBody\n'.repeat(500);
  await seed({}, body);
  const outline = vi.spyOn(projections, 'projectNoteOutline');
  const result = await wiki.readProjection({ path, view: 'full', maxChars: 12000 });
  expect(result.content).toBe(body.trim());
  expect(result.headings).toBeUndefined();
  expect(outline).not.toHaveBeenCalled();
});

test('MCP compact date warnings recover Properties, keep source guards, and do not bypass visibility', async () => {
  const fields = Object.fromEntries(Object.values(dateFields).map(field => [field, null]));
  const raw = await seed(fields, '# Work\n' + 'A long ordinary paragraph. '.repeat(200));
  await mkdir(join(vault, '_scopes/models/claude'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/claude/Private.md'), raw);
  const server = createServer(vault, { version: 'projection-dates' });
  const client = new Client({ name: 'projection-dates', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const call = async (endpointId: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const text = (response.content as any)[0].text as string;
    expect(text.length).toBeLessThanOrEqual(args.maxChars ?? 12000);
    return { response, text, value: text.startsWith('{') ? JSON.parse(text) : undefined };
  };
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    let repair: any;
    for (const view of views) {
      for (const maxChars of [512, 1024, 12000]) {
        const result = await call('wiki.read_projection', { path, view, ...(view === 'section' && { section: 'Work' }), maxChars, prettyPrint: true });
        expect(result.response.isError).not.toBe(true);
        expect(result.value.dateIssues?.length || result.value.dateIssuesOmitted).toBeTruthy();
        repair = result.value.dateRepairAction || result.value.nextAction;
        expect(repair).toMatchObject({ endpointId: 'notes.read', arguments: { path, expectedRevision: digest(raw) } });
        for (const field of Object.keys(dateFields)) expect(result.value[field]).toBeUndefined();
      }
    }
    const recovery = await call(repair.endpointId, repair.arguments);
    expect(recovery.response.isError).not.toBe(true);
    expect(recovery.text).toContain('defer_until');
    await seed({ ...fields, due_at: '2000-01-01' });
    const stale = await call(repair.endpointId, repair.arguments);
    expect(stale.response.isError).toBe(true);
    expect(stale.text).toContain('revision_conflict');
    const fresh = await call('wiki.read_projection', { path, maxChars: 12000 });
    expect(fresh.value.dueAt).toBe('2000-01-01');
    expect(fresh.value.dateIssues).not.toContain('invalid_due_at');
    const largeRaw = await seed({ ...Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`property_${i}`, 'Large authored property '.repeat(8)])), defer_until: null });
    const largeProjection = await call('wiki.read_projection', { path, maxChars: 512 });
    const largeRepair = largeProjection.value.dateRepairAction || largeProjection.value.nextAction;
    const omitted = await call(largeRepair.endpointId, largeRepair.arguments);
    expect(omitted.value.frontmatterOmitted).toBe(true);
    expect(omitted.value.nextAction).toMatchObject({ endpointId: 'mcp.read_note_lines', arguments: { path, startLine: 1, expectedRevision: digest(largeRaw) } });
    let action = omitted.value.nextAction, recovered = '';
    for (let i = 0; action && i < 50; i++) {
      const page = await call(action.endpointId, action.arguments);
      expect(page.response.isError).not.toBe(true);
      recovered += page.value.content;
      action = page.value.nextAction;
    }
    expect(recovered).toContain('defer_until: null');
    await seed({ ...fields, moderation_status: 'hidden' });
    for (const hiddenPath of [path, '_scopes/models/claude/Private.md']) {
      const denied = await call('wiki.read_projection', { path: hiddenPath, maxChars: 512 });
      expect(denied.response.isError).toBe(true);
      expect(denied.text).not.toContain('invalid_defer_until');
      expect(denied.text).not.toContain('A long ordinary');
    }
  } finally { await client.close(); await server.close(); }
});
