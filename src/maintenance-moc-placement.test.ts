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

async function fixture(run: (wiki: LlmWikiService, seed: (path: string, fields?: Record<string, unknown>, body?: string) => Promise<string>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-maint-placement-', root = await mkdtemp(join(base, prefix));
  const seed = async (path: string, fields: Record<string, unknown> = {}, body = '# Exact source\n[[Topic]]\n') => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', ...fields })}---\n${body}`;
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

const cases: Array<[string, Record<string, unknown>, boolean]> = [
  ['root map', { note_kind: 'moc' }, false],
  ['nested map', { note_kind: 'moc', moc_parent: '[[Parent]]' }, false],
  ['normalized map', { note_kind: ' MOC ', lifecycle: ' ACTIVE ' }, false],
  ['ordinary missing placement', {}, true],
  ['blank primary', { primary_moc: '  ' }, true],
  ['null primary', { primary_moc: null }, true],
  ['array primary', { primary_moc: ['Map'] }, true],
  ['object primary', { primary_moc: { target: 'Map' } }, true],
  ['boolean primary', { primary_moc: true }, true],
  ['number primary', { primary_moc: 42 }, true],
  ['blank legacy', { moc: ' ' }, true],
  ['array legacy', { moc: ['Map'] }, true],
  ['object legacy', { moc: { target: 'Map' } }, true],
  ['real primary', { primary_moc: ' [[Map]] ' }, false],
  ['real legacy', { moc: ' Map ' }, false],
  ['legacy fallback from malformed primary', { primary_moc: [], moc: 'Map' }, false],
  ['primary with malformed legacy', { primary_moc: 'Map', moc: {} }, false],
  ['additional list is not preferred entry point', { mocs: ['[[Map]]'] }, true],
  ['parent is not ordinary membership', { moc_parent: '[[Map]]' }, true],
  ['archived', { lifecycle: ' ARCHIVED ' }, false],
  ['superseded', { lifecycle: 'superseded' }, false],
  ['source', { llm_wiki_type: 'source' }, false],
  ['invalid moc lifecycle is not a map kind', { lifecycle: 'moc' }, true],
];

test.each(cases)('%s has correct primary-placement debt', async (_label, fields, expected) => {
  await fixture(async (wiki, seed, root) => {
    const raw = await seed('Note.md', fields);
    const result: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    expect(Boolean(result.counts.no_primary_moc)).toBe(expected);
    expect(result.items.some((item: any) => item.reasons.includes('no_primary_moc'))).toBe(expected);
    if (expected) {
      const item = result.items.find((item: any) => item.path === 'Note.md');
      expect(item.curationPlan.inspect).toEqual({ endpointId: 'wiki.read_projection', arguments: { path: 'Note.md', view: 'full', maxChars: 5000 } });
      expect(item.curationPlan.then.endpointId).toBe('wiki.moc_membership');
      expect(item.curationPlan.then.arguments).toEqual({ notePath: 'Note.md' });
      expect(item.curationPlan.then.instruction).toMatch(/complete.*additionalMocPaths/i);
    }
    expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
  });
});

test('empty root map requests authored links, not impossible membership', async () => {
  await fixture(async (wiki, seed, root) => {
    const raw = await seed('Root.md', { note_kind: 'moc' }, '# Root map\n');
    const result: any = await wiki.maintenanceDebt();
    expect(result.counts).toEqual({ empty_moc: 1 });
    expect(result.items[0].reasons).toEqual(['empty_moc']);
    expect(result.items[0].curationPlan.inspect.arguments.path).toBe('Root.md');
    expect(result.items[0].curationPlan.then).toMatchObject({ endpointId: 'notes.patch', arguments: { path: 'Root.md', expectedRevision: result.items[0].revision, dryRun: true } });
    expect(await readFile(join(root, 'Root.md'), 'utf8')).toBe(raw);
  });
});

test('hidden and private placement candidates cannot affect public totals', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Hidden.md', { primary_moc: [], moderation_status: 'hidden', title: 'SECRET' });
    await seed('_scopes/models/claude/Private.md', { primary_moc: {}, title: 'SECRET' });
    const result: any = await wiki.maintenanceDebt();
    expect(result.counts).toEqual({}); expect(result.scanned).toBe(0);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

test('placement preflight preserves additional maps and uses current source revision', async () => {
  await fixture(async (wiki, seed, root) => {
    const raw = await seed('Note.md', { mocs: ['[[Other]]'] });
    await seed('Map.md', { note_kind: 'moc' });
    await seed('Other.md', { note_kind: 'moc' });
    const result: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    expect(result.counts).toEqual({ no_primary_moc: 1 });
    const item = result.items[0];
    const plan = await wiki.mocMembershipPreview(undefined, { ...item.curationPlan.then.arguments, primaryMocPath: 'Map.md', additionalMocPaths: ['Other.md'] });
    expect(plan.valid).toBe(true);
    expect(plan.changes).toEqual([{ path: 'Note.md', expectedRevision: item.revision, frontmatter: { set: { primary_moc: '[[Map]]', mocs: ['[[Other]]'] } } }]);
    expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
  });
});

test('MCP placement repair is bounded and inspection targets the exact note', async () => {
  await fixture(async (_wiki, seed, root) => {
    const raw = await seed('Note.md', { primary_moc: [] }, '# Exact placement context\nKeep the reasoning here.\n');
    await seed('Map.md', { note_kind: 'moc' });
    const server = createServer(root, { version: 'maintenance-placement' });
    const client = new Client({ name: 'maintenance-placement', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const maxChars of [512, 1000, 12000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.maintenance_debt', arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        const value = JSON.parse(text);
        expect(value.counts).toEqual({ no_primary_moc: 1 });
        if (maxChars === 12000) {
          const inspected = await client.callTool({ name: 'call_endpoint', arguments: value.items[0].curationPlan.inspect });
          expect(inspected.isError).not.toBe(true);
          const content = (inspected.content as any)[0].text;
          expect(content.length).toBeLessThanOrEqual(5000);
          expect(content).toContain('Exact placement context');
          expect(content).toContain('Note.md');
        }
      }
      expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
    } finally { await client.close(); await server.close(); }
  });
});

test.each([2500, 4000, 7000, 12000])('placement plans keep a useful ranked prefix within %i characters', async maxChars => {
  await fixture(async (wiki, seed) => {
    for (let i = 0; i < 12; i += 1) await seed(`Note-${String(i).padStart(2, '0')}.md`);
    const result: any = await wiki.maintenanceDebt(undefined, 30, 20, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.counts).toEqual({ no_primary_moc: 12 });
    expect(result.items).toBeDefined();
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.map((item: any) => item.path)).toEqual(
      Array.from({ length: result.items.length }, (_, i) => `Note-${String(i).padStart(2, '0')}.md`));
    expect(result.truncated).toBe(result.items.length < 12);
    for (const item of result.items) {
      expect(item.curationPlan.inspect.arguments.path).toBe(item.path);
      expect(item.curationPlan.then.instruction).toMatch(/complete.*additionalMocPaths/i);
    }
  });
});

test('exact envelope boundary preserves escaped text and marks a formerly complete list truncated', async () => {
  await fixture(async (wiki, seed) => {
    for (let i = 0; i < 3; i += 1) await seed(`Note-${i}.md`, { title: '한글 🗺️ "quoted"\nline' });
    const full: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    expect(full.items).toHaveLength(3); expect(full.truncated).toBe(false);
    const maxChars = JSON.stringify(full).length - 1;
    const bounded: any = await wiki.maintenanceDebt(undefined, 30, 20, maxChars);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(maxChars);
    expect(bounded.items).toEqual(full.items.slice(0, 2));
    expect(bounded.truncated).toBe(true); expect(bounded.counts).toEqual(full.counts);
  });
});
