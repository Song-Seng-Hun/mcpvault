import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-maintenance-candidates-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields = '', body = 'Current reusable knowledge.') {
  const raw = `---\nllm_wiki_type: knowledge\nupdated_at: 2020-01-01T00:00:00.000Z\n${fields}\n---\n${body}`;
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  return raw;
}
const reports = ['summary', 'unused'] as const;
const report = (kind: typeof reports[number], maxChars = 6000) => kind === 'summary'
  ? service.summaryCandidates(undefined, 10, maxChars)
  : service.unusedKnowledge(undefined, 30, 10, maxChars);

test.each(reports)('%s candidates exclude hidden and other-scope notes from items and totals', async kind => {
  await seed('Visible.md');
  for (const state of ['hidden', 'quarantined', 'removed']) await seed(`${state}.md`, `moderation_status: ${state}`, 'Never expose this text.');
  await seed('_scopes/agents/other/Secret.md', '', 'Private content');
  const result: any = await report(kind);
  expect(result.items.map((item: any) => item.path)).toEqual(['Visible.md']);
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toMatch(/hidden\.md|quarantined\.md|removed\.md|Secret\.md|Never expose|Private content/);
});

test.each(reports)('%s candidates budget the entire envelope and retain a usable small read', async kind => {
  const original = await seed('Long.md', `title: ${'Very long title '.repeat(200)}`, 'Useful body. '.repeat(90));
  for (const maxChars of [512, 600, 850, 1024, 1600]) {
    const result: any = await report(kind, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.total).toBe(1);
    const first = result.items?.[0];
    expect(first?.nextAction || result.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Long.md', maxChars: 3000 } });
    expect(first?.revision || result.revision).toBe(createHash('sha256').update(original).digest('hex'));
  }
  expect(await readFile(join(vault, 'Long.md'), 'utf8')).toBe(original);
});

test.each(reports)('%s candidates recheck a newly hidden scan winner', async kind => {
  await seed('Racing.md');
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    await seed('Racing.md', 'moderation_status: hidden', 'Suppressed after scanning.');
    return result;
  });
  const result: any = await report(kind);
  expect(result.items).toEqual([]);
  expect(result.total).toBe(0);
  expect(JSON.stringify(result)).not.toMatch(/Racing|Suppressed/);
});

test('summary candidates derive a replacement from the current body, not the stale summary', async () => {
  await seed('Stale.md', `summary: Obsolete unsafe guidance\nsummary_of_content_sha256: ${'0'.repeat(64)}`, '# Current\n\nCorrected present-day guidance.');
  const result: any = await report('summary');
  expect(result.items[0]).toMatchObject({ reason: 'stale_summary', summaryFresh: false, summaryCandidate: 'Corrected present-day guidance.' });
  expect(JSON.stringify(result)).not.toContain('Obsolete unsafe guidance');
});

test.each(['summary', 'resurface'])('%s candidate context shares heading/fence-aware paragraphs with normal reads', async kind => {
  const raw = await seed('Context.md', `summary: OLD\nsummary_of_content_sha256: ${'0'.repeat(64)}`,
    '~~~md\nEXAMPLE\n~~~\nTitle\n===\nREAL-PROSE');
  const result: any = kind === 'summary' ? await report('summary') : await service.resurfaceKnowledge(undefined, 10, 6000);
  const item = result.items[0];
  expect(item.summaryCandidate ?? item.excerpt).toBe('REAL-PROSE');
  expect(item.contentSource).toBe('body_excerpt');
  const line = raw.split('\n').indexOf('REAL-PROSE') + 1;
  expect(item.excerptRange).toEqual({ startLine: line, endLine: line });
  expect(item.nextAction.arguments.expectedRevision).toBe(item.revision);
  expect(item.revision).toBe(createHash('sha256').update(raw).digest('hex'));
});

test.each(['summary', 'resurface'])('%s candidate does not replace missing prose with the raw code-only body', async kind => {
  await seed('Example.md', '', '# Only a title\n~~~md\nDO-NOT-SUMMARIZE-EXAMPLE\n~~~');
  const result: any = kind === 'summary' ? await report('summary') : await service.resurfaceKnowledge(undefined, 10, 6000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].summaryCandidate ?? result.items[0].excerpt).toBe('');
  expect(result.items[0].contentSource).toBe('none');
  expect(result.items[0].excerptRange).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('DO-NOT-SUMMARIZE-EXAMPLE');
});

test.each(['summary', 'resurface'])('%s compact inspect action retains the selected source revision', async kind => {
  await seed('Long.md', `title: ${'Title '.repeat(200)}`, 'Useful prose '.repeat(300));
  const result: any = kind === 'summary' ? await report('summary', 512) : await service.resurfaceKnowledge(undefined, 10, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.items[0].candidateTruncated).toBe(true);
  expect(result.items[0].nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Long.md', expectedRevision: result.items[0].revision } });
});

test.each(['summary', 'resurface'])('%s uses a verified stored summary without claiming it came from a body range', async kind => {
  const body = '# Current\n' + 'Body '.repeat(500);
  const basis = createHash('sha256').update(body).digest('hex');
  await seed('Fresh.md', `summary: Authored compact overview\nsummary_of_content_sha256: ${basis}`, body);
  const result: any = kind === 'summary' ? await report('summary') : await service.resurfaceKnowledge(undefined, 10, 6000);
  expect(result.items[0].summaryCandidate ?? result.items[0].summary).toBe('Authored compact overview');
  expect(result.items[0].contentSource).toBe('stored_summary');
  expect(result.items[0].excerptRange).toBeUndefined();
  expect(result.items[0].summaryFresh).toBe(true);
});

test.each(reports)('%s candidates include envelope overhead at exact budget boundaries', async kind => {
  await seed('Boundary.md', '', 'Paragraph '.repeat(20));
  const full: any = await report(kind, 16000);
  const itemLength = JSON.stringify(full.items).length;
  for (let budget = Math.max(512, itemLength); budget < Math.max(512, itemLength) + 80; budget += 7) {
    expect(JSON.stringify(await report(kind, budget)).length).toBeLessThanOrEqual(budget);
  }
});

test('unused report excludes recent, snoozed and retired notes without fresh reads or backlinks', async () => {
  await seed('Old.md');
  await seed('Recent.md', 'created_at: 2020-01-01');
  await writeFile(join(vault, 'Recent.md'), '---\nllm_wiki_type: knowledge\nupdated_at: 2099-01-01\n---\nRecent');
  await seed('Snoozed.md', 'review_snoozed_until: 2099-01-01');
  await seed('Archived.md', 'lifecycle: archived');
  const lookup = vi.spyOn(fs, 'readNoteMetadata');
  const backlinks = vi.spyOn(fs, 'getBacklinks');
  const result: any = await report('unused');
  expect(result.items.map((item: any) => item.path)).toEqual(['Old.md']);
  expect(lookup.mock.calls.flatMap(([paths]) => paths)).not.toEqual(expect.arrayContaining(['Recent.md']));
  expect(lookup.mock.calls.flatMap(([paths]) => paths)).not.toContain('Snoozed.md');
  expect(lookup.mock.calls.flatMap(([paths]) => paths)).not.toContain('Archived.md');
  expect(backlinks).toHaveBeenCalledTimes(1);
});

test('unused winner is revalidated after backlink work', async () => {
  await seed('Old.md');
  const backlinks = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    await seed('Old.md', 'moderation_status: hidden');
    return backlinks(...args);
  });
  expect(await report('unused')).toMatchObject({ items: [], total: 0 });
});

test('summary winner is revalidated after scanning other notes', async () => {
  await seed('A.md');
  await seed('Z.md', '', '');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async path => {
    if (path === 'Z.md') await seed('A.md', 'moderation_status: removed');
    return read(path);
  });
  expect(await report('summary')).toMatchObject({ items: [], total: 0 });
});

test.each(reports)('%s report preserves authorized private-scope reads and excludes neighboring identities', async kind => {
  const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await seed('_scopes/agents/worker/Old.md');
  await seed('_scopes/agents/other/Secret.md');
  await seed('_scopes/models/other/Secret.md');
  const result: any = kind === 'summary'
    ? await service.summaryCandidates(principal)
    : await service.unusedKnowledge(principal);
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    path: 'scope://agent/worker/Old.md',
    nextAction: { endpointId: 'notes.read', arguments: { path: 'scope://agent/worker/Old.md' } },
  });
  expect(JSON.stringify(result)).not.toContain('Secret');
});

test('unused report omits a winner deleted before backlink lookup instead of failing the report', async () => {
  await seed('Deleted.md');
  const backlinks = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    await rm(join(vault, 'Deleted.md'));
    return backlinks(...args);
  });
  await expect(report('unused')).resolves.toMatchObject({ items: [], total: 0 });
});

test('unused report preserves lookup failures when the winner is still current', async () => {
  await seed('Current.md');
  vi.spyOn(fs, 'getBacklinks').mockRejectedValue(new Error('Backlink service unavailable'));
  await expect(report('unused')).rejects.toThrow('Backlink service unavailable');
});

test.each(reports)('%s report supplies a larger bounded report action when even the exact path cannot fit', async kind => {
  const path = Array.from({ length: 7 }, (_, i) => `${i}-${'long-name'.repeat(5)}`).join('/') + '/Note.md';
  await seed(path);
  const result: any = await report(kind, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result).toMatchObject({ items: [], total: 1, truncated: true,
    nextAction: { endpointId: kind === 'summary' ? 'wiki.summary_candidates' : 'wiki.unused_knowledge',
      arguments: { limit: 1, maxChars: 16000 } } });
  const expanded: any = kind === 'summary'
    ? await service.summaryCandidates(undefined, 1, 16000)
    : await service.unusedKnowledge(undefined, result.nextAction.arguments.olderThanDays, 1, 16000);
  expect(expanded.items[0]).toMatchObject({ path, nextAction: { endpointId: 'notes.read', arguments: { path } } });
});

test('unused report does not count hidden backlink authors', async () => {
  await seed('Visible.md');
  await seed('Hidden.md', 'moderation_status: hidden', '[[Visible]]');
  const result: any = await report('unused');
  expect(result.items[0]).toMatchObject({ incomingLinks: 0, suggestedAction: 'review_then_archive_or_supersede' });
});

test('summary report propagates body read failure for a still-existing note', async () => {
  await seed('Unreadable.md');
  vi.spyOn(fs, 'readNote').mockRejectedValue(new Error('storage unavailable'));
  await expect(report('summary')).rejects.toThrow('storage unavailable');
});

test('strict fresh metadata reads preserve storage errors but tolerate missing notes', async () => {
  await seed('Unreadable.md');
  const io = (fs as any).vaultIo;
  vi.spyOn(io, 'readUtf8').mockRejectedValue(Object.assign(new Error('storage unavailable'), { code: 'EIO' }));
  await expect(fs.readNoteMetadata(['Unreadable.md'], () => true, { fresh: true, strict: true })).rejects.toThrow('storage unavailable');
  vi.restoreAllMocks();
  await expect(fs.readNoteMetadata(['Missing.md'], () => true, { fresh: true, strict: true })).resolves.toEqual([]);
});

test.each(reports)('%s report offers a retry when every retained winner becomes stale but lower candidates remain', async kind => {
  await seed('A.md');
  await seed('B.md');
  const read = fs.readNoteMetadata.bind(fs);
  let calls = 0;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (paths, access, options) => {
    if (paths.length === 1 && paths[0] === 'A.md' && (kind === 'summary' || calls++ > 0)) {
      await seed('A.md', 'moderation_status: hidden');
    }
    return read(paths, access, options);
  });
  const result: any = kind === 'summary' ? await service.summaryCandidates(undefined, 1) : await service.unusedKnowledge(undefined, 30, 1);
  expect(result).toMatchObject({ items: [], total: 1, truncated: true, nextAction: {
    endpointId: kind === 'summary' ? 'wiki.summary_candidates' : 'wiki.unused_knowledge', arguments: { limit: 1 } } });
});

test('indexed backlinks check each matching author once and exclude newly hidden authors even before index refresh', async () => {
  await seed('Target.md');
  await seed('Source.md', '', '[[Target]] and [[Target]]');
  await seed('Hidden.md', 'moderation_status: quarantined', '[[Target]]');
  await seed('Unrelated.md');
  await seed('_scopes/agents/other/Private.md', '', '[[Target]]');
  const access = new ScopeAccessPolicy();
  const graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  const indexed = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph);
  const canAccess = (path: string) => access.canAccessPhysicalPath(path);
  try {
    const reads = vi.spyOn(indexed, 'readNoteMetadata');
    expect(await indexed.getBacklinks('Target.md', 1, canAccess)).toMatchObject({
      total: 2, truncated: true, backlinks: [expect.objectContaining({ path: 'Source.md' })],
    });
    expect(reads.mock.calls.filter(([paths]) => paths.includes('Source.md'))).toHaveLength(1);
    expect(reads.mock.calls.flatMap(([paths]) => paths)).not.toContain('Unrelated.md');
    expect(reads.mock.calls.flatMap(([paths]) => paths)).not.toContain('_scopes/agents/other/Private.md');
    vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
    await seed('Source.md', 'moderation_status: hidden', '[[Target]] and [[Target]]');
    expect(await indexed.getBacklinks('Target.md', 1, canAccess)).toMatchObject({ total: 0, backlinks: [], truncated: false });
  } finally { graph.close(); }
});
