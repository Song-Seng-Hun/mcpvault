import { expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

async function fixture(run: (wiki: LlmWikiService, seed: (fields: Record<string, unknown>, path?: string) => Promise<string>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-maint-dates-', root = await mkdtemp(join(base, prefix));
  const seed = async (fields: Record<string, unknown>, path = 'Note.md') => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'inbox', primary_moc: 'Map', created_at: '2000-01-01', updated_at: '2999-01-01', last_reviewed_at: '2001-01-01', ...fields })}---\n# Original body\n`;
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

const badDates = [['2000-01-01'], '2024-02-30', null, '', 'January 1, 2000', {}, false];
for (const field of ['updated_at', 'created_at', 'review_at', 'last_reviewed_at']) {
  test.each(badDates.map(value => [value]))(`${field}=%j is repair debt, not invented chronology`, async value => {
    await fixture(async (wiki, seed, root) => {
      const raw = await seed({
        ...(field === 'created_at' && { updated_at: undefined }),
        ...(field === 'last_reviewed_at' && { updated_at: '2000-01-01' }),
        [field]: value,
      });
      const result: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
      const item = result.items[0];
      expect.soft(result.counts[`invalid_${field}`]).toBe(1);
      expect.soft(item.reasons).toContain(`invalid_${field}`);
      expect.soft(item.reasons).not.toContain('review_due');
      expect.soft(item.reasons).not.toContain('never_reviewed');
      if (field === 'created_at' || field === 'updated_at') {
        expect.soft(item.updatedAt).toBeUndefined(); expect.soft(item.ageDays).toBeUndefined();
        expect.soft(item.reasons).not.toContain('aging');
      }
      expect.soft(item.curationPlan.inspect).toEqual({ endpointId: 'notes.read', arguments: { path: 'Note.md', maxChars: 5000 } });
      expect.soft(item.curationPlan.then).toMatchObject({ endpointId: 'notes.patch', arguments: { path: 'Note.md', expectedRevision: item.revision, dryRun: true } });
      expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
    });
  });
}

test('only absent updated_at falls back to creation and only absent review history is never-reviewed', async () => {
  await fixture(async (wiki, seed) => {
    await seed({ updated_at: undefined, last_reviewed_at: undefined });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items[0]).toMatchObject({ updatedAt: '2000-01-01T00:00:00.000Z', ageDays: expect.any(Number) });
    expect(result.items[0].reasons).toEqual(expect.arrayContaining(['never_reviewed', 'aging']));
    expect(Object.keys(result.counts).some(key => key.startsWith('invalid_'))).toBe(false);
  });
});

test('valid leap days and offsets preserve overdue ranking without date repair', async () => {
  await fixture(async (wiki, seed) => {
    await seed({ updated_at: '2000-02-29T23:00:00-08:00', review_at: '2000-02-29', last_reviewed_at: '2000-01-01T00:00:00Z' });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items[0].updatedAt).toBe('2000-03-01T07:00:00.000Z');
    expect(result.items[0].reasons).toEqual(expect.arrayContaining(['review_due', 'aging']));
    expect(Object.keys(result.counts).some(key => key.startsWith('invalid_'))).toBe(false);
  });
});

test('an invalid creation date does not discard an independently valid modification date', async () => {
  await fixture(async (wiki, seed) => {
    await seed({ created_at: 'bad', updated_at: '2000-01-01', review_at: '2001-01-01' });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items[0].updatedAt).toBe('2000-01-01T00:00:00.000Z');
    expect(result.counts).toMatchObject({ invalid_created_at: 1, review_due: 1, aging: 1 });
    expect(result.items[0].curationPlan.then.endpointId).toBe('notes.patch');
  });
});

test('a malformed date alone is discoverable without another maintenance reason', async () => {
  await fixture(async (wiki, seed) => {
    await seed({ lifecycle: 'evergreen', review_at: 'bad' });
    const result: any = await wiki.maintenanceDebt();
    expect(result.counts).toEqual({ invalid_review_at: 1 });
    expect(result.items[0].reasons).toEqual(['invalid_review_at']);
    expect(result.items[0].curationPlan.then.endpointId).toBe('notes.patch');
  });
});

test('hidden and private invalid dates never enter maintenance counts', async () => {
  await fixture(async (wiki, seed) => {
    await seed({ review_at: 'bad', moderation_status: 'hidden' });
    await seed({ updated_at: 'bad' }, '_scopes/models/claude/Private.md');
    const result: any = await wiki.maintenanceDebt();
    expect(result.counts).toEqual({}); expect(result.scanned).toBe(0);
  });
});

test.each([
  ['_sources/Bad.md', 'knowledge', false],
  ['Source.md', 'source', false],
  ['Frozen.md', 'knowledge', true],
  ['Community/Posts/Bad.md', 'knowledge', false],
])('managed or immutable %s is inspected without a generic date patch', async (path, type, immutable) => {
  await fixture(async (wiki, seed, root) => {
    const raw = await seed({ llm_wiki_type: type, immutable, updated_at: null }, path as string);
    const result: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    const item = result.items[0];
    expect(item.reasons).toContain('invalid_updated_at');
    expect(item.curationPlan.inspect.endpointId).toBe('notes.read');
    expect(item.curationPlan.then).toBeUndefined();
    expect(item.curationPlan.instruction).toMatch(/managed|immutable/i);
    expect(await readFile(join(root, path as string), 'utf8')).toBe(raw);
  });
});

test('MCP date repair output stays bounded and read-only at small budgets', async () => {
  await fixture(async (_wiki, seed, root) => {
    const raw = await seed({ updated_at: null, review_at: ['2000-01-01'] });
    const server = createServer(root, { version: 'maintenance-date-semantics' });
    const client = new Client({ name: 'maintenance-dates', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      for (const maxChars of [512, 1000, 12000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.maintenance_debt', arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        const value = JSON.parse(text);
        expect(value.counts).toMatchObject({ invalid_updated_at: 1, invalid_review_at: 1 });
        expect(value.counts.review_due).toBeUndefined();
        expect(value.counts.aging).toBeUndefined();
      }
      expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
    } finally { await client.close(); await server.close(); }
  });
});
