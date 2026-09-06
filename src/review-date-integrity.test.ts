import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultMetadataIndex } from './vault-index.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-review-dates-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => {
  const target = await realpath(vault), base = await realpath(tmpdir()), path = relative(base, target);
  if (!path || path.startsWith('..') || isAbsolute(path) || !basename(target).startsWith('mcpvault-review-dates-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(fields: Record<string, unknown>, path = 'Note.md') {
  const raw = '---\n' + stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', ...fields }) + '---\n# Evidence';
  await writeFile(join(vault, path), raw); return raw;
}
const queue = () => wiki.reviewQueue(undefined, 20, 12000) as Promise<any>;

test.each(['on_any_edit', 'on_link_change'])('hidden %s notes do not block unrelated review work', async review_policy => {
  await seed({ lifecycle: 'review', moderation_status: 'hidden', review_policy }, 'Hidden.md');
  await seed({ lifecycle: 'review' });
  const result = await queue();
  expect(result.total).toBe(1);
  expect(result.items.map((item: any) => item.path)).toEqual(['Note.md']);
  expect(result.cascade.scanned).toBe(1);
});

test.each(['hidden', 'snooze', 'new-snooze', 'unhidden', 'non-knowledge'])('current Markdown overrides stale indexed %s before review admission', async change => {
  await seed({ lifecycle: 'review', ...(change === 'snooze' && { review_snoozed_until: '2999-01-01' }),
    ...(change === 'unhidden' && { moderation_status: 'hidden' }) });
  const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
  const index = new VaultMetadataIndex(vault, filter, frontmatter);
  // Model a delayed/unavailable OS watcher, not fake metadata or source reads.
  const watcher = vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
  const fs = new FileSystemService(vault, filter, frontmatter, undefined, index), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  try {
    const before = (await fs.queryNotes({})).notes[0]!;
    const raw = await seed({ lifecycle: 'review',
      ...(change === 'hidden' && { moderation_status: 'hidden' }),
      ...(change === 'snooze' && { review_snoozed_until: ['2999-01-01'] }),
      ...(change === 'new-snooze' && { review_snoozed_until: '2999-01-01' }),
      ...(change === 'non-knowledge' && { llm_wiki_type: 'source' }) });
    expect((await fs.queryNotes({})).notes[0]!.revision).toBe(before.revision);
    const result = await queue();
    expect(result.total).toBe(['snooze', 'unhidden'].includes(change) ? 1 : 0);
    expect(result.cascade.scanned).toBe(['hidden', 'non-knowledge'].includes(change) ? 0 : 1);
    if (change === 'snooze') {
      expect(result.items[0].reviewReasons).toContain('invalid_review_snoozed_until');
      expect(result.items[0].revision).toBe((await fs.readNote('Note.md')).revision);
    }
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  } finally { watcher.mockRestore(); await index.close(); }
});

for (const field of ['review_at', 'retention_at', 'preserve_until', 'last_reviewed_at']) {
  test.each(['2024-02-30', ['2000-01-01'], null, '', 'January 1, 2000'].map(value => [value]))(`${field} exposes repair without inventing elapsed dates from %j`, async value => {
    const raw = await seed({ [field]: value, ...(field === 'preserve_until' && { retention_at: '2000-01-01' }) });
    const result = await queue();
    expect(result.total).toBe(1);
    expect(result.items[0].reviewReasons).toContain(`invalid_${field}`);
    expect(result.items[0].overdue).toBe(false);
    expect(result.items[0].retentionDue).not.toBe(true);
    expect(result.items[0].reviewReasons).not.toContain('never_reviewed');
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  });
}

test.each(['2999-02-30', ['2999-01-01'], 'January 1, 2999', null, ''].map(value => [value]))('malformed snooze %j cannot hide a repair candidate', async value => {
  await seed({ review_snoozed_until: value });
  const result = await queue();
  expect(result.total).toBe(1);
  expect(result.items[0].reviewReasons).toContain('invalid_review_snoozed_until');
});

test('valid snooze, review offsets and preservation retain their semantics', async () => {
  await seed({ lifecycle: 'review', review_snoozed_until: '2999-01-01T00:00:00+09:00' });
  expect((await queue()).total).toBe(0);
  await seed({ review_at: '2000-02-29T23:00:00-08:00', retention_at: '2000-01-01', preserve_until: '2999-01-01' });
  const item = (await queue()).items[0];
  expect(item.overdue).toBe(true);
  expect(item.retentionDue).not.toBe(true);
  await seed({ retention_at: '2000-01-01', preserve_until: '2001-01-01' });
  expect((await queue()).items[0].retentionDue).toBe(true);
  await seed({ retention_at: '2000-01-01', legal_hold: true });
  expect((await queue()).total).toBe(0);
});

test('never-reviewed classification requires absent history and a valid authored file date', async () => {
  await seed({ updated_at: '2000-01-01' });
  expect((await queue()).items[0].reviewReasons).toContain('never_reviewed');
  await seed({ updated_at: '2000-01-01', last_reviewed_at: 'bad' });
  expect((await queue()).items[0].reviewReasons).toEqual(['invalid_last_reviewed_at']);
  await seed({ updated_at: ['2000-01-01'] });
  expect((await queue()).total).toBe(0);
});

test('actual MCP review queue is bounded and excludes moderated candidates and counts', async () => {
  const raw = await seed({ review_at: '2024-02-30' });
  await seed({ lifecycle: 'review', title: 'HIDDEN-REVIEW', moderation_status: 'hidden' }, 'Hidden.md');
  const server = createServer(vault, { version: 'review-date-test' });
  const client = new Client({ name: 'review-date-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const maxChars of [512, 1024, 12000]) {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.review_queue', arguments: { maxChars, prettyPrint: true } } });
      expect(result.isError).not.toBe(true);
      const text = (result.content as any)[0].text as string;
      expect(text.length).toBeLessThanOrEqual(maxChars);
      expect(text).not.toContain('Hidden.md');
      expect(text).not.toContain('HIDDEN-REVIEW');
      const packet = JSON.parse(text);
      expect(packet.total).toBe(1);
      if (maxChars === 12000) {
        expect(packet.items[0].reviewReasons).toContain('invalid_review_at');
        expect(packet.cascade.scanned).toBe(1);
      }
    }
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});
