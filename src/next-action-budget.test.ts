import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const task = (path: string, extra: Record<string, unknown> = {}) => ({ path, revision: 'a'.repeat(64),
  frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Check the evidence', ...extra },
});
async function withWiki(notes: ReturnType<typeof task>[], run: (wiki: LlmWikiService) => Promise<void>) {
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  try { await run(new LlmWikiService(fs, access, new ReferenceService(fs, access))); }
  finally { inventory.mockRestore(); }
}

test.each([false, true])('small final JSON keeps an exact actionable locator (pretty=%s)', async prettyPrint => {
  await withWiki([task('A.md', { title: '가'.repeat(20000), task_context: '@' + 'x'.repeat(10000) })], async wiki => {
    const result = await wiki.nextActions(undefined, undefined, 20, 512, { prettyPrint });
    expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
    expect(result.items[0]).toMatchObject({ path: 'A.md', revision: 'a'.repeat(64), action: 'Check the evidence',
      readAction: { endpointId: 'notes.read', arguments: { path: 'A.md' } } });
    expect(result.detailsOmitted).toBe(true);
  });
});

test('long authored actions are explicitly previews with a source read', async () => {
  await withWiki([task('A.md', { next_action: 'x'.repeat(700) })], async wiki => {
    const result: any = await wiki.nextActions(undefined, undefined, 1, 16000);
    expect(result.items[0]).toMatchObject({ actionTruncated: true,
      readAction: { endpointId: 'notes.read', arguments: { path: 'A.md' } } });
    expect(result.items[0].action.length).toBeLessThanOrEqual(600);
  });
});

test('oversized highest ranked identity retries original filters without skipping to cheaper work', async () => {
  const path = 'a'.repeat(800) + '.md';
  await withWiki([task(path, { due_at: '1970-01-01', task_context: '@lab', energy: 'low' }),
    task('Z.md', { task_context: '@lab', energy: 'low' })], async wiki => {
    const result = await wiki.nextActions(undefined, '@lab', 20, 512, { energy: 'low', prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.nextAction).toEqual({ endpointId: 'wiki.next_actions', reuseOriginalArguments: true,
      overrides: { maxChars: 16000, limit: 1, prettyPrint: false } });
    const retry: any = await wiki.nextActions(undefined, '@lab', 1, 16000, { energy: 'low' });
    expect(retry.items[0].path).toBe(path);
  });
});

test('ceiling failure is explicit and cannot produce an identical retry loop', async () => {
  await withWiki([task('a'.repeat(17000) + '.md')], async wiki => {
    await expect(wiki.nextActions(undefined, undefined, 1, 16000)).rejects.toThrow(/ceiling.*no.*skipped/i);
  });
});

test('no executable work remains distinguishable from omitted exclusion details', async () => {
  await withWiki([task('A.md', { task_status: 'blocked', task_context: 'x'.repeat(10000) })], async wiki => {
    const result = await wiki.nextActions(undefined, 'x'.repeat(10000), 20, 512, { prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.exclusions.workflowBlocked).toBe(1);
    expect(result.detailsOmitted).toBe(true);
  });
});

test('an action that cannot fit is a locator requiring a read, not an executable clipped instruction', async () => {
  await withWiki([task('A.md', { next_action: 'x'.repeat(700) })], async wiki => {
    const result = await wiki.nextActions(undefined, undefined, 1, 512, { prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
    expect(result.items[0]).toMatchObject({ path: 'A.md', actionOmitted: true,
      readAction: { endpointId: 'notes.read', arguments: { path: 'A.md' } } });
    expect(result.items[0]).not.toHaveProperty('action');
  });
});

test.each([512, 800, 1200, 7000, 16000])('packing retains an ordered prefix at %i characters in either format', async maxChars => {
  const notes = Array.from({ length: 20 }, (_, i) => task(`Task-${String(i).padStart(2, '0')}.md`, {
    next_action: `Verify claim ${i}`, title: 'Long title '.repeat(200), task_context: '@lab',
  }));
  await withWiki(notes, async wiki => {
    for (const prettyPrint of [false, true]) {
      const result = await wiki.nextActions(undefined, '@lab', 20, maxChars, { prettyPrint });
      expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
      expect(result.total).toBe(20);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.map((item: any) => item.path)).toEqual(notes.slice(0, result.items.length).map(note => note.path));
    }
  });
});
