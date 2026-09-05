import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const task = (path: string, extra: Record<string, unknown> = {}) => ({ path, revision: 'b'.repeat(64),
  frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Verify', due_at: '2000-01-01', ...extra },
});
async function withDashboard(notes: ReturnType<typeof task>[], run: (wiki: LlmWikiService) => Promise<void>) {
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  // Isolate packing from independent Inbox/knowledge/graph producers; keep
  // real work dependency classification and revision-stamped row construction.
  const spies = [vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes),
    vi.spyOn(wiki, 'inbox').mockResolvedValue({ items: [], total: 0, truncated: false } as any),
    vi.spyOn(wiki, 'reviewQueue').mockResolvedValue({ items: [], total: 0, truncated: false } as any),
    vi.spyOn(wiki, 'graphHealth').mockResolvedValue({ mocCoverage: { needsAttention: 0 },
      unresolvedLinks: { items: [], total: 0, truncated: false } } as any)];
  try { await run(wiki); } finally { for (const spy of spies) spy.mockRestore(); }
}

test.each([false, true])('tiny dashboard keeps a review target and read action (pretty=%s)', async prettyPrint => {
  await withDashboard([task('A.md', { title: '가'.repeat(20000) })], async wiki => {
    const result = await wiki.reviewDashboard(undefined, 10, 512, { prettyPrint });
    expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
    expect(result.selected).toEqual({ section: 'due', path: 'A.md', revision: 'b'.repeat(64) });
    expect(result.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'A.md' } });
    expect(result.detailsOmitted).toBe(true);
  });
});

test('compacted collections report omitted rows instead of retaining false completeness', async () => {
  await withDashboard(Array.from({ length: 10 }, (_, i) => task(`T${i}.md`, { title: 'title'.repeat(1000) })), async wiki => {
    const result: any = await wiki.reviewDashboard(undefined, 10, 6000);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
    expect(result.sections.due.total).toBe(10);
    expect(result.sections.due.items.length).toBeLessThan(10);
    expect(result.sections.due.truncated).toBe(true);
    expect(result.sections.due.items[0]).toMatchObject({ path: 'T0.md', revision: 'b'.repeat(64), overdue: true });
  });
});

test('unrepresentable first review target retries without silently choosing another', async () => {
  await withDashboard([task('a'.repeat(800) + '.md'), task('Z.md')], async wiki => {
    const result: any = await wiki.reviewDashboard(undefined, 10, 512);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
    expect(result.selected).toBeUndefined();
    expect(result.nextAction).toEqual({ endpointId: 'wiki.review_dashboard', reuseOriginalArguments: true,
      overrides: { limit: 1, maxChars: 18000, prettyPrint: false } });
  });
});

test('maximum compact budget does not loop on an impossible exact locator', async () => {
  await withDashboard([task('a'.repeat(19000) + '.md')], async wiki => {
    await expect(wiki.reviewDashboard(undefined, 1, 18000)).rejects.toThrow(/ceiling.*no.*skipped/i);
  });
});

test('empty work lists at a tiny budget do not imply a clean graph or invent a note', async () => {
  await withDashboard([], async wiki => {
    const result = await wiki.reviewDashboard(undefined, 10, 512, { prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
    expect(result.selected).toBeUndefined();
    expect(result.nextAction).toMatchObject({ endpointId: 'wiki.graph_health' });
    expect(result.detailsOmitted).toBe(true);
  });
});

test('a category with an internally omitted sample gets its own retrieval action', async () => {
  await withDashboard([], async wiki => {
    vi.mocked(wiki.inbox).mockResolvedValue({ items: [], total: 5, truncated: true } as any);
    const result = await wiki.reviewDashboard(undefined, 10, 512, { prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
    expect(result).toMatchObject({ section: 'inbox', detailsOmitted: true,
      nextAction: { endpointId: 'wiki.inbox', arguments: { limit: 1, maxChars: 8000 } } });
  });
});

test('graph compaction retains issue counts without presenting missing samples as empty healthy lists', async () => {
  await withDashboard([], async wiki => {
    vi.mocked(wiki.graphHealth).mockResolvedValue({ mocCoverage: { needsAttention: 0 },
      orphanNotes: { total: 50, items: Array.from({ length: 50 }, () => ({ path: 'A.md', title: 'x'.repeat(1000) })), truncated: false } } as any);
    const result = await wiki.reviewDashboard(undefined, 10, 6000);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
    expect(result.sections.graph).toMatchObject({ orphanNotes: { total: 50 }, truncated: true, detailsOmitted: true,
      nextAction: { endpointId: 'wiki.graph_health' } });
    expect(result.sections.graph.orphanNotes.items).toBeUndefined();
  });
});

test.each([512, 1200, 6000, 9000, 18000])('final dashboard formatting fits %i and retains a review path', async maxChars => {
  await withDashboard(Array.from({ length: 20 }, (_, i) => task(`T${i}.md`, { title: '가'.repeat(500) })), async wiki => {
    for (const prettyPrint of [false, true]) {
      const result = await wiki.reviewDashboard(undefined, 20, maxChars, { prettyPrint });
      expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
      const first = result.selected || result.sections.due.items[0];
      expect(first).toMatchObject({ path: 'T0.md', revision: 'b'.repeat(64) });
      if (result.sections) expect(result.sections.due.total).toBe(20);
    }
  });
});
