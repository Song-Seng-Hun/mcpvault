import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { CollectionHealthProjection } from './collection-health.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-collection-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields: Record<string, unknown> = {}) {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), `---\n${stringify(fields)}---\n# Current\n\nCurrent explanation.`);
}

test('collection fields share the coherent lint source rather than stale query Properties', async () => {
  await seed('Concept.md', { domain: 'Current', note_kind: 'atomic' });
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    return { ...result, notes: result.notes.map(note => ({ ...note, frontmatter: { ...note.frontmatter, domain: 'Stale', note_kind: 'moc', moc_purpose: 'Outdated purpose' } })) };
  });
  const result = await service.organizationHealth(undefined, 30, 16000);
  expect(JSON.stringify(result.collectionHealth)).not.toMatch(/Stale|Outdated/);
  expect(result.collectionHealth.items[0]).toMatchObject({ key: 'domain:Current', knowledge: 1, withoutSummary: 1 });
});

test('collection grouping keeps distinct long keys and membership-specific labels', async () => {
  const prefix = 'A'.repeat(510);
  await seed('One.md', { primary_moc: `${prefix}one`, mocs: [`${prefix}two`] });
  const result: any = await service.collectionHealth(undefined, 20, 12000);
  expect(result.collectionTotal).toBe(2);
  expect(result.items.map((item: any) => item.key)).toEqual(expect.arrayContaining([`${prefix}one`, `${prefix}two`]));
  expect(result.items.find((item: any) => item.key.endsWith('two')).entryPoint).toBe(`${prefix}two`);
});

test('blank summaries and empty key points do not suppress missing projection signals', async () => {
  await seed('A.md', { note_kind: 'atomic', summary: '  ', key_points: [] });
  await seed('B.md', { llm_wiki_type: 'knowledge', key_points: [' ', ''] });
  const result: any = await service.collectionHealth(undefined, 20, 12000);
  expect(result.items.reduce((n: number, item: any) => n + item.withoutSummary, 0)).toBe(2);
  expect(result.items.reduce((n: number, item: any) => n + item.knowledge, 0)).toBe(2);
});

test('collection repair selects the most actionable current member with an exact read', async () => {
  await seed('A-quiet.md', { domain: 'Shared', note_kind: 'atomic', summary: 'Present' });
  await seed('B-due.md', { domain: 'Shared', note_kind: 'atomic', review_at: '2000-01-01T00:00:00.000Z' });
  const current = await fs.readNote('B-due.md');
  const result: any = await service.collectionHealth(undefined, 20, 12000);
  expect(result.items[0]).toMatchObject({ repairTarget: { path: 'B-due.md', revision: current.revision }, action: { endpointId: 'notes.read', arguments: { path: 'B-due.md' } } });
  expect(result.nextAction).toEqual(result.items[0].action);
});

test('collection output respects whole budgets without abandoning an exact repair', async () => {
  await seed('Map.md', { note_kind: 'moc', domain: 'Shared', moc_purpose: '"\\'.repeat(500), moc_scope: 'S'.repeat(500), moc_questions: ['Q'.repeat(300)] });
  await seed('Note.md', { domain: 'Shared', note_kind: 'atomic' });
  for (const maxChars of [512, 700, 1200, 6000, 12000]) {
    const result: any = await service.collectionHealth(undefined, 20, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Note.md' } });
  }
});

test('long repair identities retry the existing organization endpoint', async () => {
  const path = Array.from({ length: 8 }, (_, i) => `${i}-${'folder'.repeat(9)}`).join('/') + '/Note.md';
  await seed(path, { note_kind: 'atomic' });
  const result: any = await service.collectionHealth(undefined, 20, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.retry).toEqual({ endpointId: 'wiki.organization_health', reuseOriginalArguments: true, overrides: { maxChars: 16000 } });
});

test('cached collection changes review counts at the known review time boundary', async () => {
  const start = Date.parse('2030-01-01T00:00:00Z');
  const time = vi.spyOn(Date, 'now').mockReturnValue(start);
  await seed('Due.md', { domain: 'Shared', review_at: new Date(start + 1000).toISOString() });
  expect((await service.collectionHealth(undefined, 20, 12000)).items[0].reviewDue).toBe(0);
  time.mockReturnValue(start + 1001);
  expect((await service.collectionHealth(undefined, 20, 12000)).items[0].reviewDue).toBe(1);
});

test('collection overflow reports retained groups and skipped memberships, not invented unique counts', async () => {
  await seed('Many.md', { mocs: Array.from({ length: 130 }, (_, i) => `Map${i}`) });
  const result: any = await service.collectionHealth(undefined, 50, 12000);
  expect(result).toMatchObject({ collectionTotal: 120, collectionCountComplete: false, untrackedMemberships: 10, truncated: true });
});

test('returned collection objects cannot mutate the cached repair target', async () => {
  await seed('Note.md', { note_kind: 'atomic' });
  const first: any = await service.collectionHealth(undefined, 20, 12000);
  first.items[0].repairTarget.path = 'Unrelated.md';
  const next: any = await service.collectionHealth(undefined, 20, 12000);
  expect(next.items[0].repairTarget.path).toBe('Note.md');
  expect(next.nextAction.arguments.path).toBe('Note.md');
});

test('collection reuses the verified lint scan instead of another metadata inventory query', async () => {
  await seed('Note.md', { note_kind: 'atomic' });
  await service.lint(undefined, 200);
  const query = vi.spyOn(fs, 'queryNotes');
  await service.collectionHealth(undefined, 20, 12000);
  expect(query).not.toHaveBeenCalled();
});

test('an oversized authored group label cannot force endless retries for a short real target', async () => {
  await seed('Note.md', { domain: 'Huge label '.repeat(2000), note_kind: 'atomic' });
  const report: any = await service.collectionHealth(undefined, 20, 12000);
  expect(JSON.stringify(report).length).toBeLessThanOrEqual(12000);
  expect(report.nextAction.arguments.path).toBe('Note.md');
  expect(report.items[0]).toMatchObject({ groupKeyOmitted: true, repairTarget: { path: 'Note.md' } });
  expect(report.retry).toBeUndefined();
});

test('an exact target larger than the maximum budget gives an explicit terminal omission', () => {
  const projection = new CollectionHealthProjection(path => path);
  projection.add({ path: 'p'.repeat(15000) + '.md', revision: 'a'.repeat(64), frontmatter: {} });
  const report: any = projection.report(20, 12000);
  expect(JSON.stringify(report).length).toBeLessThanOrEqual(12000);
  expect(report.unavailable).toBe('exact_target_exceeds_maximum_budget');
  expect(report.retry).toBeUndefined();
});
