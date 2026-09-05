import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { packOrganizationQueue } from './organization-queue-packet.js';

const methods = ['inbox', 'inboxPlan', 'reviewQueue'] as const;
async function fixture(method: typeof methods[number], run: (wiki: LlmWikiService, fs: FileSystemService, first: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-queue-budget-', vault = await mkdtemp(join(base, prefix));
  const folder = method === 'reviewQueue' ? 'Knowledge' : 'Inbox';
  try {
    for (const [name, year] of [['A', 2000], ['Z', 2020]] as const) {
      const path = join(vault, folder, `${name}.md`);
      await mkdir(dirname(path), { recursive: true });
      const fm = { note_kind: 'atomic', title: name === 'A' ? '가'.repeat(20000) : 'Short',
        ...(method === 'reviewQueue' ? { llm_wiki_type: 'knowledge', lifecycle: 'review', review_at: `${year}-01-01` }
          : { lifecycle: 'inbox', captured_at: `${year}-01-01` }) };
      await writeFile(path, `---\n${stringify(fm)}---\n# Evidence\nRead current context before editing.\n`);
    }
    const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), fs, `${folder}/A.md`);
  } finally {
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

for (const method of methods) {
  test.each([false, true])(`${method} keeps its long first item with a verified locator in 512 characters (pretty=%s)`, async prettyPrint => {
    await fixture(method, async (wiki, fs, first) => {
      const result = method === 'reviewQueue'
        ? await wiki.reviewQueue(undefined, 10, 512, 3, { prettyPrint })
        : await wiki[method](undefined, 10, 512, { prettyPrint });
      expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
      expect(result.items[0]).toMatchObject({ path: first, revision: (await fs.readNote(first)).revision,
        readAction: { endpointId: 'notes.read', arguments: { path: first } } });
      expect(result.total).toBe(2);
      expect(result.detailsOmitted).toBe(true);
    });
  });
}

test('review reasons and cascade depth survive a useful compact review queue', async () => {
  await fixture('reviewQueue', async wiki => {
    const result = await wiki.reviewQueue(undefined, 10, 7000, 5);
    expect(result.items[0]).toMatchObject({ path: 'Knowledge/A.md', reviewReasons: ['overdue'] });
    expect(result.cascade.maxDepth).toBe(5);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(7000);
  });
});

test.each(['wiki.inbox', 'wiki.review_queue', 'mcp.get_wiki_inbox_plan'])('long head identities at %s return same-request retries without skipping', endpointId => {
  const ceiling = endpointId === 'mcp.get_wiki_inbox_plan' ? 16000 : 12000;
  const result = { items: [{ path: 'a'.repeat(800) + '.md', revision: 'a'.repeat(64) }, { path: 'Z.md' }], total: 2, truncated: false };
  const packed = packOrganizationQueue(result, endpointId, 512, ceiling, true);
  expect(JSON.stringify(packed, null, 2).length).toBeLessThanOrEqual(512);
  expect(packed.items).toEqual([]);
  expect(packed.nextAction).toEqual({ endpointId, reuseOriginalArguments: true,
    overrides: { maxChars: ceiling, limit: 1, prettyPrint: false } });
  expect(packOrganizationQueue(result, endpointId, ceiling, ceiling).items[0]!.path).toBe(result.items[0]!.path);
  expect(() => packOrganizationQueue({ ...result, items: [{ path: 'x'.repeat(17000) }] }, endpointId, ceiling, ceiling)).toThrow(/ceiling.*no items skipped/i);
});

test('packing preserves ranked prefixes, bounds final formats and never invents a zero workload', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ path: `T${i}.md`, revision: 'a'.repeat(64), title: '가\\\"'.repeat(2000),
    reviewReasons: ['overdue'], reviewScore: 30 - i }));
  for (const maxChars of [512, 1200, 7000, 12000]) for (const prettyPrint of [false, true]) {
    const value = packOrganizationQueue({ items, total: 300, truncated: true }, 'wiki.review_queue', maxChars, 12000, prettyPrint);
    expect(JSON.stringify(value, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
    expect(value.total).toBe(300);
    expect(value.items.length).toBeGreaterThan(0);
    expect(value.items.map(row => row.path)).toEqual(items.slice(0, value.items.length).map(row => row.path));
  }
  const empty = packOrganizationQueue({ items: [], total: 0, truncated: false, purpose: 'x'.repeat(20000) }, 'wiki.inbox', 512, 12000, true);
  expect(empty).toMatchObject({ items: [], total: 0, detailsOmitted: true });
  expect(JSON.stringify(empty, null, 2).length).toBeLessThanOrEqual(512);
});

test('Inbox planning does not lose classification because the user-facing queue was compacted', async () => {
  await fixture('inboxPlan', async wiki => {
    const result = await wiki.inboxPlan(undefined, 10, 7000);
    expect(result.items[0]).toMatchObject({ path: 'Inbox/A.md', noteKind: 'atomic',
      suggested: { disposition: 'knowledge', destination: 'Knowledge/' } });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(7000);
  });
});
