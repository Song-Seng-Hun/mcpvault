import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

async function withWiki(notes: any[], action: (wiki: LlmWikiService) => Promise<void>) {
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  try { await action(new LlmWikiService(fs, access, new ReferenceService(fs, access))); }
  finally { inventory.mockRestore(); }
}
const incomplete = (count: number) => Array.from({ length: count }, (_, i) => ({
  path: `Task-${i}.md`, revision: 'a'.repeat(64), frontmatter: {
    note_kind: 'task', task_status: 'open', next_action: 'Execute concrete work', depends_on: ['[[Missing]]'],
  },
}));

test.each([1024, 1600, 7000])('flow budgets include final indentation at %i characters', async maxChars => {
  await withWiki(incomplete(8), async wiki => {
    const result = await wiki.flowHealth(undefined, 3, 7, 14, 20, maxChars, { prettyPrint: true });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
  });
});

test('compacted incomplete prerequisite lists disclose their own omitted rows', async () => {
  await withWiki(incomplete(8), async wiki => {
    const result = await wiki.flowHealth(undefined, 3, 7, 14, 20, 7000);
    expect(result.truncated).toBe(true);
    const collection = result.dependencyPlan.incompletePrerequisites;
    expect(collection.items.length).toBeLessThan(collection.total);
    expect(collection.truncated).toBe(true);
  });
});

test('minimum-budget truncation supplies a bounded same-request retry', async () => {
  await withWiki(incomplete(8), async wiki => {
    const result = await wiki.flowHealth(undefined, 5, 9, 17, 20, 1024, { prettyPrint: true });
    expect(result.truncated).toBe(true);
    expect(result.nextAction).toMatchObject({ endpointId: 'wiki.flow_health', reuseOriginalArguments: true,
      overrides: { maxChars: 16000, limit: 1, prettyPrint: false } });
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1024);
  });
});

test('a preview reports the full chain length separately from its four returned nodes', async () => {
  const notes = incomplete(30).map((note, i) => ({ ...note, frontmatter: { ...note.frontmatter,
    depends_on: i ? [`[[Task-${i - 1}]]`] : [],
  } }));
  await withWiki(notes, async wiki => {
    const result = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
    expect(result.dependencyPlan.deepestDependencyChain).toHaveLength(4);
    expect(result.dependencyPlan.deepestDependencyChainTotal).toBe(30);
    expect(result.dependencyPlan.deepestDependencyChainTruncated).toBe(true);
  });
});

test.each([false, true])('large scalars never overflow the final format (pretty=%s)', async prettyPrint => {
  const notes = incomplete(3).map(note => ({ ...note, frontmatter: { ...note.frontmatter,
    title: 'large😀'.repeat(10000), due_at: 'x'.repeat(10000),
  } }));
  await withWiki(notes, async wiki => {
    for (const maxChars of [1024, 1600, 7000, 16000]) {
      const result = await wiki.flowHealth(undefined, 3, 7, 14, 1, maxChars, { prettyPrint });
      expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
      expect(result.flow.totalWork).toBe(3);
      if (maxChars === 16000 && !prettyPrint) expect(result.nextAction).toBeUndefined();
    }
  });
});
