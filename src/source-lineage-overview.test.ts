import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let root: string;
let fs: FileSystemService;
let wiki: LlmWikiService;

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function source(path: string, content: string, frontmatter: Record<string, unknown> = {}) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\n${Object.entries({
    llm_wiki_type: 'source', immutable: true, content_sha256: digest(content),
    source_work_id: 'overview-work', source_edition_id: path,
    ...frontmatter,
  }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${content}`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-source-lineage-'));
  fs = new FileSystemService(root);
  wiki = new LlmWikiService(fs, new ScopeAccessPolicy(), new ReferenceService(fs, new ScopeAccessPolicy()));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

test('overview filters hidden sources before selection and bounds full source reads', async () => {
  await source('_sources/hidden.md', 'SECRET', { moderation_status: 'hidden', source_edition_id: 'hidden', supersedes_source: 'hidden-private-target' });
  for (let i = 0; i < 12; i++) await source(`_sources/${i.toString().padStart(2, '0')}.md`, `Edition ${i}`, { source_edition_id: `edition-${i}` });
  const reads = vi.spyOn(fs, 'readNote');

  const result = await wiki.sourceLineage(undefined, undefined, 20, 20000);

  expect(JSON.stringify(result)).not.toContain('hidden.md');
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
  expect(result.works[0]?.editions[0]).toMatchObject({ integrity: 'intact' });
  expect(result.works[0]?.editions).toEqual(expect.arrayContaining([expect.objectContaining({ integrity: 'not_checked' })]));
});

test('overview marks bounded counts as samples and never exposes unchecked raw lineage values', async () => {
  for (let i = 0; i < 25; i++) await source(`_sources/${i.toString().padStart(2, '0')}.md`, `Edition ${i}`, {
    source_edition_id: `edition-${i}`,
    source_version: 'v'.repeat(10000),
    published_at: 'p'.repeat(10000),
    supersedes_source: 's'.repeat(10000),
  });

  const result = await wiki.sourceLineage(undefined, undefined, 20, 1024, true);

  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1024);
  expect(result.totals).toMatchObject({ sourceSnapshots: expect.any(Number), works: expect.any(Number) });
  expect((result as any).countsAreSampled || (result as any).sampled || result.truncated).toBeTruthy();
  expect(JSON.stringify(result)).not.toContain('v'.repeat(1000));
  expect(JSON.stringify(result)).not.toContain('p'.repeat(1000));
  expect(JSON.stringify(result)).not.toContain('s'.repeat(1000));
});

test('overview keeps the response within the requested pretty-print budget', async () => {
  for (let i = 0; i < 8; i++) await source(`_sources/${i}.md`, `Edition ${i}`, {
    source_edition_id: `edition-${i}`,
    title: `Title ${i}`,
  });

  const result = await wiki.sourceLineage(undefined, undefined, 20, 1200, true);

  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1200);
  expect(result.mode).toBe('bounded_source_work_edition_lineage');
});

test('overview rejects a body whose revision no longer matches fresh metadata', async () => {
  await source('_sources/changed.md', 'Edition');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (path, maxBytes) => {
    const note = await read(path, maxBytes);
    return { ...note, revision: '0'.repeat(64) };
  });

  await expect(wiki.sourceLineage()).rejects.toThrow(/^Source lineage changed or is unavailable$/);
});

test('overview exposes observed counts and a guarded selected action after budget trimming', async () => {
  for (let i = 0; i < 8; i++) await source(`_sources/${i}.md`, `Edition ${i}`, { source_edition_id: `edition-${i}` });

  const result = await wiki.sourceLineage(undefined, undefined, 20, 1024);

  expect(result.totals.sampled).toBe(true);
  expect(result.works[0]?.editionCount).toBe(8);
  expect(result.works[0]?.returnedEditionCount).toBeLessThanOrEqual(8);
  expect(result.nextAction?.endpointId).toBe('wiki.source_lineage');
  expect(result.nextAction?.arguments.maxChars).toBeGreaterThanOrEqual(2000);
  expect(result.nextAction?.arguments.maxChars).toBeLessThanOrEqual(12000);
});

test('overview can continue a capped scan after the returned path', async () => {
  for (let i = 0; i < 60; i++) await source(`_sources/${i.toString().padStart(2, '0')}.md`, `Edition ${i}`, { source_edition_id: `edition-${i}` });
  const first = await wiki.sourceLineage(undefined, 'no-such-family', 20, 8000);
  const continuation = await (wiki.sourceLineage as any)(undefined, 'no-such-family', 20, 8000, false, first.nextAction?.arguments?.afterPath);

  expect(first.truncated).toBe(true);
  expect(first.nextAction?.arguments.afterPath).toBeTruthy();
  expect(continuation.truncated).toBe(false);
});
test('trimmed overview counts match delivered editions and continuation preserves current revision', async () => {
  for (let i = 0; i < 8; i++) await source(`_sources/${i}.md`, `Edition ${i}`);
  const r = await wiki.sourceLineage(undefined, undefined, 20, 1800);
  for (const w of r.works) expect(w.returnedEditionCount).toBe(w.editions.length);
  expect(r.nextAction.arguments.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
});
test('overview keeps a cross-work scan continuation and sanitizes hidden-path failures', async () => {
  for (let i = 0; i < 21; i++) await source(`_sources/${i.toString().padStart(2, '0')}.md`, `Edition ${i}`, { source_work_id: `work-${i}` });
  const r = await wiki.sourceLineage(undefined, undefined, 20, 20000);
  expect(r.scanContinuation.arguments.afterPath).toBe('_sources/19.md');
  await source('SecretHidden.md', 'hidden', { moderation_status: 'hidden' });
  const revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => { if (args[0] === 'SecretHidden.md') throw Error('ENOENT SecretHidden.md'); return revision(...args); });
  await expect(wiki.sourceLineage(undefined, 'unmatched')).rejects.toThrow(/^Source lineage changed or is unavailable$/);
});
